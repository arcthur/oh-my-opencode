/**
 * Session Handoff Extractor
 *
 * Uses LLM to extract structured knowledge from session messages.
 */

import { z } from "zod"
import type {
  HandoffPackage,
  HandoffPayload,
  HandoffMetadata,
  ExtractionContext,
  SessionHandoffConfig,
  Decision,
  Artifact,
  AntiPattern,
} from "./types"
import { generateHandoffId } from "./storage"
import { log } from "../../shared/logger"

// ============================================================================
// Extraction Prompt
// ============================================================================

const HANDOFF_EXTRACTION_PROMPT = `You are extracting transferable knowledge from a completed coding session.

Focus ONLY on information valuable to FUTURE sessions working on RELATED tasks.

## Extraction Guidelines

### Decisions (max ${10})
Extract technical decisions with clear rationale.
- Focus on "why" over "what" - code can be re-read, reasoning cannot
- Include rejected alternatives to prevent re-exploration
- Tag with category: architecture | implementation | tooling | convention

### Artifacts (max ${20})
List files created/modified with their purpose.
- Include line ranges for significant changes
- Note new dependencies introduced
- Skip trivial changes (typo fixes, formatting)

### Anti-Patterns (critical)
Document approaches that FAILED.
- Include error signatures when available
- Explain why the approach didn't work
- This prevents future sessions from repeating failures

### Domain Context
Capture non-obvious insights about the codebase:
- Component relationships not evident from imports
- Naming conventions and patterns
- Gotchas and quirks
- Performance considerations discovered

## Output Format

Return a JSON object with these fields:
- decisions: array of Decision objects
- artifacts: array of Artifact objects
- antiPatterns: array of AntiPattern objects
- domainContext: array of strings
- remainingTasks: array of strings (optional)

## Exclusions

Do NOT include:
- Debugging attempts that were just exploration
- Typo fixes and formatting changes
- Generic programming knowledge
- Information obvious from reading the files`

// ============================================================================
// Payload Schema
// ============================================================================

const DecisionSchema = z.object({
  what: z.string(),
  chosen: z.string(),
  why: z.string(),
  rejected: z.array(z.object({
    approach: z.string(),
    reason: z.string(),
  })).optional(),
  relatedFiles: z.array(z.string()).optional(),
  category: z.enum(["architecture", "implementation", "tooling", "convention"]).optional(),
})

const ArtifactSchema = z.object({
  path: z.string(),
  changeType: z.enum(["created", "modified", "deleted"]),
  summary: z.string(),
  lineRanges: z.array(z.object({
    start: z.number(),
    end: z.number(),
    description: z.string(),
  })).optional(),
  dependencies: z.array(z.string()).optional(),
})

const AntiPatternSchema = z.object({
  approach: z.string(),
  reason: z.string(),
  errorSignature: z.string().optional(),
  context: z.string().optional(),
})

const PayloadSchema = z.object({
  decisions: z.array(DecisionSchema),
  artifacts: z.array(ArtifactSchema),
  antiPatterns: z.array(AntiPatternSchema),
  domainContext: z.array(z.string()),
  remainingTasks: z.array(z.string()).optional(),
})

// ============================================================================
// Context Building
// ============================================================================

/**
 * Build extraction context from session data
 */
export function buildExtractionContext(
  sessionId: string,
  projectPath: string,
  messages: Array<{ role: "user" | "assistant"; content: string; timestamp?: number }>,
  toolCalls: Array<{ tool: string; args: Record<string, unknown>; result: string; success: boolean }>,
  fileChanges: string[],
  startTime: number,
  endTime: number
): ExtractionContext {
  // Filter to meaningful messages (skip very short ones)
  const meaningfulMessages = messages.filter((m) => m.content.length > 50)

  // Limit total content size for extraction
  const truncatedMessages = truncateMessages(meaningfulMessages, 50000)

  // Filter to significant tool calls (skip reads, focus on writes)
  const significantTools = new Set(["edit", "write", "bash", "delegate_task"])
  const significantToolCalls = toolCalls.filter((tc) => significantTools.has(tc.tool.toLowerCase()))

  return {
    sessionId,
    projectPath,
    messages: truncatedMessages,
    toolCalls: significantToolCalls.slice(0, 50), // Limit tool calls
    fileChanges: [...new Set(fileChanges)], // Dedupe
    startTime,
    endTime,
  }
}

/**
 * Truncate messages to fit within token limit
 */
function truncateMessages(
  messages: Array<{ role: "user" | "assistant"; content: string; timestamp?: number }>,
  maxChars: number
): Array<{ role: "user" | "assistant"; content: string; timestamp?: number }> {
  let totalChars = 0
  const result: typeof messages = []

  // Prioritize recent messages
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    const msgChars = msg.content.length

    if (totalChars + msgChars > maxChars) {
      // Truncate this message
      const remaining = maxChars - totalChars
      if (remaining > 500) {
        result.unshift({
          ...msg,
          content: msg.content.slice(0, remaining) + "\n[truncated]",
        })
      }
      break
    }

    result.unshift(msg)
    totalChars += msgChars
  }

  return result
}

// ============================================================================
// Extraction
// ============================================================================

export interface ExtractorDependencies {
  /** LLM call function */
  callLLM: (prompt: string, systemPrompt: string, model: string) => Promise<string>
}

/**
 * Extract handoff payload from session context
 */
export async function extractPayload(
  context: ExtractionContext,
  config: SessionHandoffConfig,
  deps: ExtractorDependencies
): Promise<HandoffPayload> {
  const { extractor } = config

  // Build context for LLM
  const contextText = formatContextForExtraction(context)

  const systemPrompt = HANDOFF_EXTRACTION_PROMPT

  const userPrompt = `## Session Context

**Project**: ${context.projectPath}
**Duration**: ${Math.round((context.endTime - context.startTime) / 1000 / 60)} minutes
**Files Changed**: ${context.fileChanges.join(", ") || "none"}

### Conversation Summary

${contextText}

### Tool Calls Summary

${formatToolCalls(context.toolCalls)}

---

Extract the structured knowledge from this session. Return valid JSON only.`

  try {
    const response = await deps.callLLM(userPrompt, systemPrompt, extractor.model)

    // Parse JSON from response
    const jsonMatch = response.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      throw new Error("No JSON found in response")
    }

    const parsed = JSON.parse(jsonMatch[0])
    const validated = PayloadSchema.parse(parsed)

    // Apply limits
    return {
      decisions: validated.decisions.slice(0, extractor.max_decisions),
      artifacts: validated.artifacts.slice(0, extractor.max_artifacts),
      antiPatterns: validated.antiPatterns.slice(0, 10),
      domainContext: validated.domainContext.slice(0, 10),
      remainingTasks: validated.remainingTasks,
    }
  } catch (error) {
    log("[session-handoff] Extraction failed, using fallback", {
      error: String(error),
    })

    // Fallback: extract basic info from tool calls
    return createFallbackPayload(context)
  }
}

/**
 * Format context for LLM extraction
 */
function formatContextForExtraction(context: ExtractionContext): string {
  const lines: string[] = []

  for (const msg of context.messages) {
    const role = msg.role === "user" ? "User" : "Assistant"
    // Truncate individual messages
    const content = msg.content.length > 2000
      ? msg.content.slice(0, 2000) + "..."
      : msg.content
    lines.push(`**${role}**: ${content}`)
    lines.push("")
  }

  return lines.join("\n")
}

/**
 * Format tool calls for extraction
 */
function formatToolCalls(
  toolCalls: Array<{ tool: string; args: Record<string, unknown>; result: string; success: boolean }>
): string {
  if (toolCalls.length === 0) return "No significant tool calls."

  return toolCalls.map((tc) => {
    const status = tc.success ? "success" : "failed"
    const argsSummary = Object.keys(tc.args).slice(0, 3).join(", ")
    return `- ${tc.tool}(${argsSummary}): ${status}`
  }).join("\n")
}

/**
 * Create fallback payload from context when LLM extraction fails
 */
function createFallbackPayload(context: ExtractionContext): HandoffPayload {
  // Extract artifacts from file changes
  const artifacts: Artifact[] = context.fileChanges.map((path) => ({
    path,
    changeType: "modified" as const,
    summary: "Modified during session",
  }))

  // Extract anti-patterns from failed tool calls
  const antiPatterns: AntiPattern[] = context.toolCalls
    .filter((tc) => !tc.success)
    .slice(0, 5)
    .map((tc) => ({
      approach: `${tc.tool} with ${JSON.stringify(tc.args).slice(0, 100)}`,
      reason: "Failed during execution",
      errorSignature: tc.result.slice(0, 200),
    }))

  return {
    decisions: [],
    artifacts: artifacts.slice(0, 20),
    antiPatterns,
    domainContext: [],
  }
}

// ============================================================================
// Package Creation
// ============================================================================

/**
 * Create a full handoff package
 */
export async function createHandoffPackage(
  context: ExtractionContext,
  config: SessionHandoffConfig,
  deps: ExtractorDependencies,
  originalGoal?: string
): Promise<HandoffPackage> {
  const payload = await extractPayload(context, config, deps)

  const now = Date.now()
  const expiryMs = config.expiry_days * 24 * 60 * 60 * 1000

  // Determine outcome based on payload
  const outcome: "completed" | "partial" | "blocked" =
    payload.remainingTasks && payload.remainingTasks.length > 0
      ? "partial"
      : payload.antiPatterns.length > payload.decisions.length
        ? "blocked"
        : "completed"

  const metadata: HandoffMetadata = {
    originalGoal: originalGoal || extractGoalFromMessages(context.messages),
    durationMs: context.endTime - context.startTime,
    projectPath: context.projectPath,
    keyFiles: context.fileChanges.slice(0, 10),
    outcome,
  }

  return {
    id: generateHandoffId(),
    sourceSessionId: context.sessionId,
    createdAt: now,
    expiresAt: now + expiryMs,
    metadata,
    payload,
  }
}

/**
 * Extract goal from first user message
 */
function extractGoalFromMessages(
  messages: Array<{ role: "user" | "assistant"; content: string }>
): string {
  const firstUserMsg = messages.find((m) => m.role === "user")
  if (!firstUserMsg) return "Unknown goal"

  // Take first line or first 200 chars
  const firstLine = firstUserMsg.content.split("\n")[0]
  return firstLine.length > 200 ? firstLine.slice(0, 197) + "..." : firstLine
}
