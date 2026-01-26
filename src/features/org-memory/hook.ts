import type { PluginInput } from "@opencode-ai/plugin"
import type { OrgMemoryConfig } from "./types"
import type {
  ToolExecuteInput,
  ToolExecuteOutput,
  EventInput,
  MessageInput,
} from "../../shared/hook-types"
import type { ContextCollector } from "../context-injector/collector"
import { DEFAULT_CONFIG } from "./types"
import { getOrgMemorySummary, addCustomRule, addProtectedPath, addArchitecturalDecision } from "./storage"
import { log } from "../../shared/logger"

/**
 * Creates a hook that injects org/project memory into sessions
 * and captures project-level "remember" requests.
 */
export function createOrgMemoryHook(
  ctx: PluginInput,
  userConfig?: Partial<OrgMemoryConfig>,
  deps?: { collector?: ContextCollector }
) {
  const config: OrgMemoryConfig = { ...DEFAULT_CONFIG, ...userConfig }
  const collector = deps?.collector

  // Patterns to detect project-level memory requests
  const PROJECT_REMEMBER_PATTERNS = [
    // "remember for this project that X"
    /\bremember\s+(?:for\s+(?:this\s+)?project|project-wide)\s+(?:that\s+)?(.+)/i,
    // "project rule: X"
    /\bproject\s+rule\s*:\s*(.+)/i,
    // "team convention: X"
    /\b(?:team|org)\s+convention\s*:\s*(.+)/i,
    // "never modify X" -> protected path
    /\bnever\s+(?:modify|change|edit|touch)\s+(.+)/i,
    // "always use X for Y in this project"
    /\balways\s+use\s+(.+)\s+(?:for|in)\s+(?:this\s+)?project/i,
  ]

  // Pattern for protected paths
  const PROTECTED_PATH_PATTERN = /\bnever\s+(?:modify|change|edit|touch)\s+(.+)/i

  // Patterns to detect architectural decisions from user messages
  const ADR_USER_PATTERNS: Array<{ pattern: RegExp; extractor: (match: RegExpMatchArray) => { title: string; rationale: string } | null }> = [
    {
      // "let's use X for Y"
      pattern: /\blet'?s?\s+use\s+(\S+(?:\s+\S+)?)\s+(?:for|to\s+handle)\s+(.+)/i,
      extractor: (m) => ({ title: `Use ${m[1]}`, rationale: `For ${m[2].replace(/[.,!?]+$/, "")}` }),
    },
    {
      // "we should use X because Y"
      pattern: /\bwe\s+should\s+use\s+(\S+(?:\s+\S+)?)\s+(?:because|since)\s+(.+)/i,
      extractor: (m) => ({ title: `Use ${m[1]}`, rationale: m[2].replace(/[.,!?]+$/, "") }),
    },
    {
      // "decided: use X for Y" or "decided to use X"
      pattern: /\bdecided\s*:\s*(?:use\s+)?(.+)/i,
      extractor: (m) => {
        const content = m[1].replace(/[.,!?]+$/, "").trim()
        if (content.length < 10) return null
        return { title: content, rationale: "User decision" }
      },
    },
    {
      // "ADR: X"
      pattern: /\bADR\s*:\s*(.+)/i,
      extractor: (m) => {
        const content = m[1].replace(/[.,!?]+$/, "").trim()
        if (content.length < 10) return null
        return { title: content, rationale: "Explicit ADR" }
      },
    },
    {
      // "architecture decision: X"
      pattern: /\b(?:architecture|architectural)\s+decision\s*:\s*(.+)/i,
      extractor: (m) => {
        const content = m[1].replace(/[.,!?]+$/, "").trim()
        if (content.length < 10) return null
        return { title: content, rationale: "Explicit architecture decision" }
      },
    },
  ]

  /**
   * Register org memory context with the collector (once per session)
   */
  const toolExecuteBefore = async (
    input: ToolExecuteInput,
    _output: unknown
  ) => {
    if (!config.enabled || !config.auto_inject || !collector) return

    const memorySummary = getOrgMemorySummary(ctx.directory, config)
    if (!memorySummary) return

    collector.register(input.sessionID, {
      id: "org-memory-context",
      source: "org-memory",
      priority: "normal",
      content: memorySummary,
      oncePerSession: true,
      estimatedTokens: Math.ceil(memorySummary.length / 4),
      metadata: {
        project: ctx.directory.split("/").pop(),
      },
    })

    log("[org-memory] registered context for injection", { sessionID: input.sessionID })
  }

  const toolExecuteAfter = async (
    _input: ToolExecuteInput,
    _output: ToolExecuteOutput
  ) => {
    // No longer needed - injection moved to toolExecuteBefore via collector
  }

  const userPromptSubmit = async (input: MessageInput) => {
    if (!config.enabled) return

    const content = input.message.content

    // Check for protected path pattern first
    const protectedMatch = content.match(PROTECTED_PATH_PATTERN)
    if (protectedMatch && protectedMatch[1]) {
      const path = protectedMatch[1].trim()
      // Extract just the path, remove trailing punctuation
      const cleanPath = path.replace(/[.,!?;:]+$/, "").trim()
      if (cleanPath.length > 0) {
        addProtectedPath(ctx.directory, cleanPath)
        log("[org-memory] added protected path", { path: cleanPath })
        return
      }
    }

    // Check for project-level remember patterns
    for (const pattern of PROJECT_REMEMBER_PATTERNS) {
      const match = content.match(pattern)
      if (match && match[1]) {
        const rule = match[1].trim()
        if (rule.length > 5) {
          addCustomRule(ctx.directory, rule)
          log("[org-memory] captured project rule", { rule: rule.substring(0, 50) })
        }
        break
      }
    }

    // Check for architectural decision patterns
    for (const { pattern, extractor } of ADR_USER_PATTERNS) {
      const match = content.match(pattern)
      if (match) {
        const decision = extractor(match)
        if (decision && decision.title.length >= 10 && decision.title.length <= 200) {
          addArchitecturalDecision(ctx.directory, decision)
        }
        break
      }
    }
  }

  const eventHandler = async ({ event }: EventInput) => {
    const props = event.properties as Record<string, unknown> | undefined

    // Session lifecycle cleanup is handled by SessionStateCoordinator
    // (clearSession on delete, resetOncePerSession on compaction)

    // Extract ADRs from compaction summary
    if (event.type === "session.summarized") {
      const summary = props?.summary as string | undefined
      if (summary) {
        const decisions = extractDecisionsFromSummary(summary)
        for (const decision of decisions) {
          addArchitecturalDecision(ctx.directory, decision)
        }
      }
    }
  }

  /**
   * Extract architectural decisions from compaction summary
   * Looks for "Key Decisions & Rationale" section
   */
  function extractDecisionsFromSummary(summary: string): Array<{ title: string; rationale: string }> {
    // Look for "Key Decisions" section with various numbering formats
    const sectionMatch = summary.match(/##\s*(?:\d+\.\s*)?(?:Key\s+)?Decisions?\s*(?:&|and)?\s*Rationale?[\s\S]*?(?=##|$)/i)
    if (!sectionMatch) return []

    const section = sectionMatch[0]
    const decisions: Array<{ title: string; rationale: string }> = []

    // Extract bullet points
    const bulletPattern = /[-*]\s*(?:\*\*)?([^*:\n]+)(?:\*\*)?\s*[:\-]?\s*(.+)/g
    let match

    while ((match = bulletPattern.exec(section)) !== null) {
      const title = match[1].trim()
      const rationale = match[2].trim().replace(/[.,!?]+$/, "")

      // Validate
      if (title.length >= 5 && title.length <= 200 && rationale.length >= 5) {
        decisions.push({ title, rationale })
      }
    }

    if (decisions.length > 0) {
      log("[org-memory] extracted ADRs from summary", { count: decisions.length })
    }

    return decisions
  }

  return {
    "tool.execute.before": toolExecuteBefore,
    "tool.execute.after": toolExecuteAfter,
    "user.prompt.submit": userPromptSubmit,
    event: eventHandler,
  }
}
