/**
 * Session Handoff Hook
 *
 * Integrates session handoff with the plugin lifecycle:
 * - On session end: extract and save handoff
 * - On session start: inject relevant handoffs
 * - /handoff commands: handled via chat.message (self-contained)
 */

import { isAbsolute, relative } from "node:path"
import type {
  SessionHandoffConfig,
  ActiveHandoffRequest,
  SessionRuntimeState,
  HandoffIndexEntry,
  RecoveryPattern,
  HandoffMetrics,
} from "./types"
import { DEFAULT_HANDOFF_METRICS } from "./types"
import { createHandoffPackage, buildExtractionContext, type ExtractorDependencies } from "./extractor"
import {
  resolveSessionReference,
  selectHandoffsForInjection,
  type ResolveSessionReferenceOptions,
  type InjectorScoringConfig,
} from "./injector"
import { renderMultipleHandoffsForInjection } from "./renderer"
import {
  saveHandoff,
  cleanupExpired,
  shouldRunCleanup,
  findHandoffBySessionId,
  saveEmbeddings,
  loadIndex,
  loadHandoff,
  deleteHandoff,
  findHandoffsForProject,
  updateHandoffMetrics,
} from "./storage"
import { log } from "../../shared/logger"
import type { RegisterContextOptions } from "../context-injector/types"
import { buildEmbeddingIndexEntries, generateEmbeddingVectors } from "./embeddings"
import type { SessionReferenceConfig } from "../../config/schema"
import { executeActiveHandoff, buildQuickHandoff } from "./launcher"
import { parseHandoffCommand, isManagementCommand, type ParsedHandoffCommand, type ManagementSubcommand } from "./command-parser"
import {
  RecoveryPatternDetector,
  addOrMergePattern,
  type ToolExecution,
} from "./recovery-detector"
import {
  CitationTracker,
  determineSessionOutcome,
  isArchitecturalHandoff,
  checkL3Promotion,
} from "./citation-tracker"

// ============================================================================
// Constants
// ============================================================================

const HANDOFF_RESULT_TAG_OPEN = "<session-handoff-result>"
const HANDOFF_RESULT_TAG_CLOSE = "</session-handoff-result>"

const MAX_TRACKED_MESSAGES = 200
const MAX_TRACKED_TOOL_CALLS = 200
const MAX_MESSAGE_CHARS = 4000

// ============================================================================
// Session State Tracking
// ============================================================================

const sessionStates = new Map<string, SessionRuntimeState>()

/**
 * Extended session state with recovery patterns
 */
interface ExtendedSessionState extends SessionRuntimeState {
  /** Recovery patterns detected during session */
  recoveryPatterns: RecoveryPattern[]
  /** IDs of handoffs injected into this session */
  injectedHandoffIds: string[]
}

const extendedSessionStates = new Map<string, ExtendedSessionState>()

/**
 * Recovery pattern detectors per session
 */
const recoveryDetectors = new Map<string, RecoveryPatternDetector>()

/**
 * In-flight extraction tasks per session (to prevent duplicate work)
 */
const extractionTasks = new Map<string, Promise<boolean>>()

// ============================================================================
// Hook Context
// ============================================================================

export interface SessionHandoffHookContext {
  config: SessionHandoffConfig
  sessionReferenceConfig?: SessionReferenceConfig
  cwd: string
  /** LLM call function for extraction */
  callLLM: (prompt: string, systemPrompt: string, model: string) => Promise<string>
  /** Embedding function for semantic search (optional) */
  embed?: (texts: string[]) => Promise<number[][]>
  /** Context collector for injection */
  collector?: {
    register: (sessionId: string, entry: RegisterContextOptions) => void
  }
  /** Scoring configuration for injection (optional) */
  scoringConfig?: InjectorScoringConfig
  /** Enable recovery pattern detection (default: true) */
  enableRecoveryPatterns?: boolean
  /** Enable citation tracking (default: true) */
  enableCitationTracking?: boolean
}

// ============================================================================
// Hook Creation
// ============================================================================

/**
 * Create session handoff hooks
 */
export function createSessionHandoffHook(ctx: SessionHandoffHookContext) {
  const {
    config,
    cwd,
    callLLM,
    collector,
    embed,
    sessionReferenceConfig,
    scoringConfig,
    enableRecoveryPatterns = true,
    enableCitationTracking = true,
  } = ctx

  const deps: ExtractorDependencies = { callLLM }

  // Citation tracker for updating handoff metrics
  const citationTracker = enableCitationTracking
    ? new CitationTracker(
        // Update metrics callback
        async (handoffId, updater) => {
          try {
            await updateHandoffMetrics(handoffId, updater)
          } catch (e) {
            log("[session-handoff] Failed to update metrics", { handoffId, error: String(e) })
          }
        },
        // L3 promotion callback
        async (handoffId, reason) => {
          log("[session-handoff] L3 promotion candidate", { handoffId, reason })
          // L3 promotion is handled in storage.ts updateHandoffMetrics
        }
      )
    : null

  /**
   * Get or create session state
   */
  function getState(sessionId: string): SessionRuntimeState {
    if (!sessionStates.has(sessionId)) {
      sessionStates.set(sessionId, {
        projectPath: cwd,
        startTime: Date.now(),
        messages: [],
        toolCalls: [],
        fileChanges: new Set(),
        injected: false,
        extracted: false,
      })
    }
    return sessionStates.get(sessionId)!
  }

  /**
   * Get or create extended session state (with recovery patterns)
   */
  function getExtendedState(sessionId: string): ExtendedSessionState {
    if (!extendedSessionStates.has(sessionId)) {
      const baseState = getState(sessionId)
      extendedSessionStates.set(sessionId, {
        ...baseState,
        recoveryPatterns: [],
        injectedHandoffIds: [],
      })
    }
    return extendedSessionStates.get(sessionId)!
  }

  /**
   * Get or create recovery detector for session
   */
  function getRecoveryDetector(sessionId: string): RecoveryPatternDetector {
    if (!recoveryDetectors.has(sessionId)) {
      recoveryDetectors.set(sessionId, new RecoveryPatternDetector())
    }
    return recoveryDetectors.get(sessionId)!
  }

  /**
   * Handle session start - inject relevant handoffs
   */
  async function handleSessionStart(sessionId: string, initialPrompt?: string): Promise<void> {
    if (!config.enabled || !config.auto_inject) return

    const state = getState(sessionId)
    if (state.injected) return

    // Run cleanup if needed
    if (shouldRunCleanup()) {
      try {
        cleanupExpired(config)
      } catch (e) {
        log("[session-handoff] Cleanup failed", { error: String(e) })
      }
    }

    // Select handoffs for injection (with scoring if enabled)
    const selectedHandoffs = selectHandoffsForInjection(
      cwd,
      config,
      initialPrompt,
      scoringConfig
    )

    if (selectedHandoffs.length === 0) {
      state.injected = true
      return
    }

    // Track injected handoff IDs for citation tracking
    const extState = getExtendedState(sessionId)
    extState.injectedHandoffIds = selectedHandoffs.map((h) => h.id)

    // Notify citation tracker
    if (citationTracker && extState.injectedHandoffIds.length > 0) {
      await citationTracker.onHandoffsInjected(sessionId, extState.injectedHandoffIds)
    }

    // Format content using unified renderer
    const content = renderMultipleHandoffsForInjection(selectedHandoffs, cwd)
    if (!content) {
      state.injected = true
      return
    }

    if (collector) {
      collector.register(sessionId, {
        id: "session-handoff-context",
        source: "session-handoff",
        content,
        priority: "normal",
        oncePerSession: true,
      })
    }

    state.injected = true
    log("[session-handoff] Injected context", {
      sessionId,
      contentLength: content.length,
      handoffCount: selectedHandoffs.length,
      handoffIds: selectedHandoffs.map((h) => h.id.slice(0, 15)),
    })
  }

  /**
   * Track message for extraction
   *
   * For assistant messages from message.updated events (streaming), updates the last
   * assistant message if it exists and was recent (within 30s), rather than adding duplicates.
   */
  function trackMessage(sessionId: string, role: "user" | "assistant", content: string, isUpdate = false): void {
    if (!config.enabled) return

    const state = getState(sessionId)
    const now = Date.now()
    const normalizedContent =
      content.length > MAX_MESSAGE_CHARS ? content.slice(0, MAX_MESSAGE_CHARS) + "..." : content

    // For assistant message updates, check if we should update the last message
    // instead of adding a new one (handles streaming updates)
    if (isUpdate && role === "assistant" && state.messages.length > 0) {
      const lastMsg = state.messages[state.messages.length - 1]
      // If last message is assistant and within 30s, update it instead of adding
      if (lastMsg.role === "assistant" && now - lastMsg.timestamp < 30000) {
        lastMsg.content = normalizedContent
        lastMsg.timestamp = now
        return
      }
    }

    state.messages.push({
      role,
      content: normalizedContent,
      timestamp: now,
    })

    while (state.messages.length > MAX_TRACKED_MESSAGES) {
      state.messages.shift()
    }
  }

  /**
   * Track tool call for extraction
   */
  function trackToolCall(
    sessionId: string,
    tool: string,
    args: Record<string, unknown>,
    result: string,
    success: boolean
  ): void {
    if (!config.enabled) return

    const state = getState(sessionId)
    state.toolCalls.push({ tool, args, result, success })
    while (state.toolCalls.length > MAX_TRACKED_TOOL_CALLS) {
      state.toolCalls.shift()
    }

    // Track file changes
    const toolName = tool.toLowerCase()
    const filePathRaw = (args.file_path ?? args.filePath ?? args.path ?? args.file) as unknown

    if ((toolName === "edit" || toolName === "write" || toolName === "multiedit") && typeof filePathRaw === "string") {
      const normalized = isAbsolute(filePathRaw) ? relative(cwd, filePathRaw) : filePathRaw
      if (normalized && normalized.trim()) {
        state.fileChanges.add(normalized)
      }
    }
  }

  /**
   * Handle session idle - attempt to extract handoff
   * Called on session.idle event. Does not delete state (session may continue).
   */
  async function handleSessionIdle(sessionId: string): Promise<void> {
    if (!config.enabled || !config.auto_extract) return

    const state = sessionStates.get(sessionId)
    if (!state) return

    // Skip if already extracted
    if (state.extracted) return

    const extractionInFlight = extractionTasks.has(sessionId)

    // Check minimum message requirement
    if (state.messages.length < config.min_messages_for_extract) {
      log("[session-handoff] Skipping extraction on idle - too few messages", {
        sessionId,
        messageCount: state.messages.length,
        required: config.min_messages_for_extract,
      })
      return
    }

    // Check minimum file change requirement (prevents chat-only sessions from generating handoffs)
    const fileChangeCount = state.fileChanges.size
    if (fileChangeCount < config.min_file_changes_for_extract) {
      log("[session-handoff] Skipping extraction on idle - too few file changes", {
        sessionId,
        fileChangeCount,
        required: config.min_file_changes_for_extract,
      })
      return
    }

    // Check if handoff already exists for this session
    const existing = findHandoffBySessionId(sessionId)
    if (existing) {
      log("[session-handoff] Handoff already exists", { sessionId, handoffId: existing.id })
      state.extracted = true
      return
    }

    // Get extended state for recovery patterns
    const extState = extendedSessionStates.get(sessionId)

    // Capture state for extraction (don't delete - session may continue)
    const capturedState = {
      projectPath: state.projectPath,
      startTime: state.startTime,
      messages: [...state.messages],
      toolCalls: [...state.toolCalls],
      fileChanges: [...state.fileChanges],
      recoveryPatterns: extState?.recoveryPatterns ?? [],
    }

    if (config.async_extraction) {
      if (!extractionInFlight) {
        const task = performExtraction(sessionId, capturedState, "idle")
        extractionTasks.set(sessionId, task)
        task
          .then((success) => {
            if (success) {
              state.extracted = true
            }
          })
          .finally(() => {
            extractionTasks.delete(sessionId)
          })
      }
    } else {
      const success = await performExtraction(sessionId, capturedState, "idle")
      state.extracted = success
    }

    // Cache intermediate outcome for citation tracking (not final settlement)
    // Final settlement happens in handleSessionDeleted
    if (citationTracker && extState?.injectedHandoffIds.length) {
      const outcome = determineSessionOutcome(
        state.messages,
        [...state.fileChanges],
        Date.now() - state.startTime
      )
      // Only record intermediate outcome, don't settle yet
      // Session may continue after idle
      citationTracker.recordIntermediateOutcome(sessionId, outcome)
      log("[session-handoff] Cached intermediate citation outcome", {
        sessionId,
        outcome,
        injectedCount: extState.injectedHandoffIds.length,
      })
    }
  }

  /**
   * Clean up all session-related state
   */
  function cleanupSessionState(sessionId: string): void {
    sessionStates.delete(sessionId)
    extendedSessionStates.delete(sessionId)
    recoveryDetectors.delete(sessionId)
    extractionTasks.delete(sessionId)
  }

  /**
   * Handle session deleted - clean up and extract if not already done
   * Called on session.deleted event. Always deletes state.
   */
  async function handleSessionDeleted(sessionId: string): Promise<void> {
    const state = sessionStates.get(sessionId)
    if (!state) {
      // Ensure cleanup even if base state is missing
      cleanupSessionState(sessionId)
      return
    }

    // Final settlement of citation tracking on session deletion
    // This is the authoritative point where we update handoff metrics
    const extStateForCitations = extendedSessionStates.get(sessionId)
    if (
      citationTracker &&
      extStateForCitations?.injectedHandoffIds.length &&
      citationTracker.hasPendingCitation(sessionId)
    ) {
      // Compute final outcome (may override cached intermediate outcome)
      const finalOutcome = determineSessionOutcome(
        state.messages,
        [...state.fileChanges],
        Date.now() - state.startTime
      )
      // Use onSessionSettled for final settlement (updates citationCount + authorityScore)
      await citationTracker.onSessionSettled(sessionId, finalOutcome)
      log("[session-handoff] Settled citation tracking", {
        sessionId,
        outcome: finalOutcome,
        injectedCount: extStateForCitations.injectedHandoffIds.length,
      })
    }

    // If extraction is still running, await it before deciding whether to retry
    const pendingExtraction = extractionTasks.get(sessionId)
    if (pendingExtraction) {
      try {
        await pendingExtraction
      } finally {
        extractionTasks.delete(sessionId)
      }
    }

    // If no handoff exists yet, try extraction now
    if (config.enabled && config.auto_extract && !findHandoffBySessionId(sessionId)) {
      // Check thresholds
      const shouldExtract =
        state.messages.length >= config.min_messages_for_extract &&
        state.fileChanges.size >= config.min_file_changes_for_extract &&
        !findHandoffBySessionId(sessionId)

      if (shouldExtract) {
        // Get extended state for recovery patterns
        const extState = extendedSessionStates.get(sessionId)

        const capturedState = {
          projectPath: state.projectPath,
          startTime: state.startTime,
          messages: [...state.messages],
          toolCalls: [...state.toolCalls],
          fileChanges: [...state.fileChanges],
          recoveryPatterns: extState?.recoveryPatterns ?? [],
        }

        // Clean up all state first
        cleanupSessionState(sessionId)

        await performExtraction(sessionId, capturedState, "deleted")
        return
      }
    }

    // Just clean up
    cleanupSessionState(sessionId)
  }

  /**
   * Perform the actual extraction
   * @returns true if extraction succeeded
   */
  async function performExtraction(
    sessionId: string,
    capturedState: {
      projectPath: string
      startTime: number
      messages: Array<{ role: "user" | "assistant"; content: string; timestamp: number }>
      toolCalls: Array<{ tool: string; args: Record<string, unknown>; result: string; success: boolean }>
      fileChanges: string[]
      recoveryPatterns?: RecoveryPattern[]
    },
    trigger: "idle" | "deleted"
  ): Promise<boolean> {
    const doExtraction = async (): Promise<boolean> => {
      try {
        const context = buildExtractionContext(
          sessionId,
          capturedState.projectPath,
          capturedState.messages,
          capturedState.toolCalls,
          capturedState.fileChanges,
          capturedState.startTime,
          Date.now()
        )

        const pkg = await createHandoffPackage(context, config, deps)

        // Add recovery patterns if available
        if (capturedState.recoveryPatterns && capturedState.recoveryPatterns.length > 0) {
          // Keep most recent patterns to protect prompt budget
          pkg.payload.recoveryPatterns = capturedState.recoveryPatterns.slice(-10)
          log("[session-handoff] Added recovery patterns to handoff", {
            sessionId,
            patternCount: pkg.payload.recoveryPatterns.length,
          })
        }

        // Initialize metrics
        pkg.metrics = {
          ...DEFAULT_HANDOFF_METRICS,
          isArchitectural: isArchitecturalHandoff(pkg),
        }

        if (config.extractor.generate_embeddings && embed) {
          try {
            const entries = buildEmbeddingIndexEntries(pkg)
            if (entries.length > 0) {
              const vectors = await generateEmbeddingVectors(entries, embed)
              saveEmbeddings(pkg.id, vectors)
              pkg.embeddingIndex = entries
            }
          } catch (e) {
            log("[session-handoff] Failed to generate embeddings", {
              sessionId,
              error: String(e),
            })
            // Continue without embeddings - not a fatal error
          }
        }

        saveHandoff(pkg)

        log("[session-handoff] Created handoff", {
          sessionId,
          handoffId: pkg.id,
          decisions: pkg.payload.decisions.length,
          artifacts: pkg.payload.artifacts.length,
          antiPatterns: pkg.payload.antiPatterns.length,
          recoveryPatterns: pkg.payload.recoveryPatterns?.length ?? 0,
          isArchitectural: pkg.metrics?.isArchitectural,
          embeddings: pkg.embeddingIndex?.length ?? 0,
          trigger,
          async: config.async_extraction,
        })

        return true
      } catch (error) {
        log("[session-handoff] Failed to create handoff", {
          sessionId,
          error: String(error),
          trigger,
          async: config.async_extraction,
        })
        return false
      }
    }

    return doExtraction()
  }

  /**
   * Parse and resolve @session references in text
   *
   * Supported formats:
   *   @session:abc123              - Full session ID
   *   @session:~1                  - Relative reference
   *   @session:latest              - Alias for ~1
   *   @session:handoff:ho_xxx      - Direct handoff reference
   *   @session:abc:decisions       - With section query
   *   @session:abc:"search term"   - With semantic query (quoted)
   */
  async function parseSessionReferences(
    text: string,
    options?: ResolveSessionReferenceOptions
  ): Promise<Array<{ original: string; content: string }>> {
    // Match @session: followed by content until whitespace, but handle quoted strings
    // This pattern captures the full reference including any quoted query
    const pattern = /@session:(?:[^\s"']+|"[^"]*"|'[^']*')+/g
    const results: Array<{ original: string; content: string }> = []
    let match

    while ((match = pattern.exec(text)) !== null) {
      const original = match[0]
      const refPart = original.slice("@session:".length)

      // Parse the reference into identifier and query
      const { identifier, query } = parseRefPart(refPart)

      const content = await resolveSessionReference(cwd, identifier, query, options)
      if (content) {
        results.push({ original, content })
      }
    }

    return results
  }

  /**
   * Parse reference part into identifier and optional query
   */
  function parseRefPart(refPart: string): {
    identifier: string
    query?: { type: "section"; section: string } | { type: "semantic"; query: string }
  } {
    // Section query keywords
    const sectionKeywords = ["decisions", "artifacts", "antiPatterns", "context"]

    // Check for quoted semantic query at the end
    const quotedMatch = refPart.match(/^(.+?):("[^"]+"|'[^']+')$/)
    if (quotedMatch) {
      const quote = quotedMatch[2]
      return {
        identifier: quotedMatch[1],
        query: { type: "semantic", query: quote.slice(1, -1) },
      }
    }

    // Check for section query at the end
    for (const section of sectionKeywords) {
      if (refPart.endsWith(`:${section}`)) {
        return {
          identifier: refPart.slice(0, -(section.length + 1)),
          query: { type: "section", section },
        }
      }
    }

    // Special case: handoff:xxx format
    if (refPart.startsWith("handoff:")) {
      return { identifier: refPart }
    }

    // Check if last segment could be unquoted semantic query (not a known format)
    const colonIdx = refPart.lastIndexOf(":")
    if (colonIdx > 0) {
      const lastPart = refPart.slice(colonIdx + 1)
      const firstPart = refPart.slice(0, colonIdx)

      // If firstPart looks like a valid identifier and lastPart isn't a handoff id pattern
      if (!lastPart.startsWith("ho_") && !lastPart.match(/^~\d+$/)) {
        // Treat as unquoted semantic query
        return {
          identifier: firstPart,
          query: { type: "semantic", query: lastPart },
        }
      }
    }

    // No query, entire refPart is the identifier
    return { identifier: refPart }
  }

  // ============================================================================
  // /handoff Command Handling (Self-Contained)
  // ============================================================================

  /**
   * Execute management subcommand
   */
  function executeManagementCommand(subcommand: ManagementSubcommand, args: string): string {
    switch (subcommand) {
      case "list": {
        const handoffs = findHandoffsForProject(cwd).slice(0, 20)
        if (handoffs.length === 0) {
          return `## Session Handoffs

No handoffs found. Create one with \`/handoff <goal>\`.`
        }

        const rows = handoffs.map((h) => {
          const age = formatAge(Date.now() - h.createdAt)
          const goal = truncate(h.originalGoal, 40)
          const project = truncate(h.projectPath.split("/").pop() || h.projectPath, 20)
          return `| \`${h.id.slice(0, 15)}...\` | ${goal} | ${project} | ${age} | ${h.decisionCount}d/${h.artifactCount}a |`
        })

        return `## Session Handoffs

| ID | Goal | Project | Age | D/A |
|----|------|---------|-----|-----|
${rows.join("\n")}

*Use \`/handoff show <id>\` to see details, \`/handoff delete <id>\` to remove.*`
      }

      case "show": {
        const id = args.trim()
        if (!id) {
          return `## Error

Usage: \`/handoff show <id>\`

Use \`/handoff list\` to see available handoffs.`
        }

        // Support partial ID matching
        const index = loadIndex()
        const entry = index.handoffs.find((h) => h.id.startsWith(id) || h.id === id)
        if (!entry) {
          return `## Error

Handoff not found: \`${id}\`

Use \`/handoff list\` to see available handoffs.`
        }

        const pkg = loadHandoff(entry.id)
        if (!pkg) {
          return `## Error

Failed to load handoff: \`${entry.id}\``
        }

        const sections: string[] = [
          `## Handoff: ${pkg.id}`,
          "",
        ]

        // Warn if viewing a handoff from a different project
        if (entry.projectPath !== cwd) {
          sections.push(`> ⚠️ This handoff is from a different project: \`${entry.projectPath}\``)
          sections.push("")
        }

        sections.push(
          `**Goal**: ${pkg.metadata.originalGoal}`,
          `**Project**: ${pkg.metadata.projectPath}`,
          `**Created**: ${new Date(pkg.createdAt).toLocaleString()}`,
          `**Expires**: ${new Date(pkg.expiresAt).toLocaleString()}`,
          `**Outcome**: ${pkg.metadata.outcome}`,
          "",
        )

        if (pkg.payload.decisions.length > 0) {
          sections.push("### Decisions")
          for (const d of pkg.payload.decisions) {
            sections.push(`- **${d.what}**: ${d.chosen}`)
            sections.push(`  *Why*: ${d.why}`)
          }
          sections.push("")
        }

        if (pkg.payload.artifacts.length > 0) {
          sections.push("### Artifacts")
          for (const a of pkg.payload.artifacts) {
            sections.push(`- \`${a.path}\` (${a.changeType}): ${a.summary}`)
          }
          sections.push("")
        }

        if (pkg.payload.antiPatterns.length > 0) {
          sections.push("### Anti-patterns (What NOT to do)")
          for (const ap of pkg.payload.antiPatterns) {
            sections.push(`- ❌ ${ap.approach}`)
            sections.push(`  *Reason*: ${ap.reason}`)
          }
        }

        return sections.join("\n")
      }

      case "delete": {
        const id = args.trim()
        if (!id) {
          return `## Error

Usage: \`/handoff delete <id>\`

Use \`/handoff list\` to see available handoffs.`
        }

        // Support partial ID matching
        const index = loadIndex()
        const entry = index.handoffs.find((h) => h.id.startsWith(id) || h.id === id)
        if (!entry) {
          return `## Error

Handoff not found: \`${id}\``
        }

        const success = deleteHandoff(entry.id)
        if (success) {
          const crossProjectNote = entry.projectPath !== cwd
            ? `\n\n> ℹ️ This handoff was from a different project: \`${entry.projectPath}\``
            : ""
          return `## Handoff Deleted

Successfully deleted handoff: \`${entry.id}\`${crossProjectNote}`
        } else {
          return `## Error

Failed to delete handoff: \`${entry.id}\``
        }
      }

      case "cleanup": {
        const removed = cleanupExpired(config)
        return `## Cleanup Complete

Removed ${removed} expired handoff(s).`
      }

      default:
        return `## Error

Unknown subcommand: \`${subcommand}\``
    }
  }

  /**
   * Execute goal-oriented handoff
   */
  async function executeGoalHandoff(sessionID: string, goal: string): Promise<string> {
    const state = sessionStates.get(sessionID)

    if (!state) {
      return `## Handoff Error

No session state found. Please try again after some interaction in this session.`
    }

    const extState = getExtendedState(sessionID)

    // Check if we have enough context for full extraction
    const hasEnoughContext = extState.messages.length >= 3 || extState.fileChanges.size >= 1

    try {
      if (hasEnoughContext) {
        // Full extraction with LLM
        const request: ActiveHandoffRequest = {
          goal,
          sourceSessionId: sessionID,
          projectPath: cwd,
          launchMode: "preview",
        }

        const result = await executeActiveHandoff(request, deps, extState, config)

        log("[session-handoff] active handoff executed", {
          sessionID,
          goal,
          handoffId: result.handoffPackage.id,
          decisionsTransferred: result.decisionsTransferred,
          antiPatternsTransferred: result.antiPatternsTransferred,
        })

        return `## Handoff Created

${result.message}

---

### Handoff Prompt (for new session)

\`\`\`
${result.prompt}
\`\`\`

**Next Steps**: Start a new session and paste the prompt above, or the context has been saved for automatic injection.`
      } else {
        // Quick handoff without LLM extraction
        const { prompt, summary } = buildQuickHandoff(goal, state, sessionID)

        log("[session-handoff] quick handoff executed", {
          sessionID,
          goal,
          fileChanges: state.fileChanges.size,
        })

        return `## Quick Handoff Created

${summary}

*(Quick mode: minimal session context available, not persisted)*

---

### Handoff Prompt (for new session)

\`\`\`
${prompt}
\`\`\`

**Next Steps**: Copy the prompt above and paste it in a new session.`
      }
    } catch (error) {
      log("[session-handoff] handoff command failed", {
        sessionID,
        goal,
        error: String(error),
      })

      return `## Handoff Error

Failed to create handoff: ${String(error)}

Please try again or use \`/handoff list\` to see existing handoffs.`
    }
  }

  /**
   * Handle /handoff command (all variants)
   * Returns formatted result content or null if not a handoff command
   */
  async function handleHandoffCommand(sessionID: string, promptText: string): Promise<string | null> {
    const parsed = parseHandoffCommand(promptText)
    if (!parsed) {
      return null
    }

    if (isManagementCommand(parsed)) {
      return executeManagementCommand(parsed.subcommand, parsed.args)
    }

    return executeGoalHandoff(sessionID, parsed.goal)
  }

  // ============================================================================
  // Utility Functions
  // ============================================================================

  function formatAge(ms: number): string {
    const minutes = Math.floor(ms / 60000)
    if (minutes < 60) return `${minutes}m`
    const hours = Math.floor(minutes / 60)
    if (hours < 24) return `${hours}h`
    const days = Math.floor(hours / 24)
    return `${days}d`
  }

  function truncate(str: string, maxLen: number): string {
    if (str.length <= maxLen) return str
    return str.slice(0, maxLen - 3) + "..."
  }

  // ============================================================================
  // Hook Handlers
  // ============================================================================

  return {
    name: "session-handoff",

    /**
     * Handle /handoff commands via chat.message
     *
     * This is the primary handler for /handoff commands.
     * Modifies output.parts to replace the command with formatted results,
     * which the model will then output to the user.
     */
    "chat.message": async (
      input: { sessionID: string; messageID?: string },
      output: { parts: Array<{ type: string; text?: string }> }
    ): Promise<void> => {
      // Extract prompt text from parts
      const promptText = output.parts
        .filter((p) => p.type === "text" && p.text)
        .map((p) => p.text)
        .join("\n")

      // Skip if already processed (contains our result tag)
      if (promptText.includes(HANDOFF_RESULT_TAG_OPEN)) {
        return
      }

      // Check for /handoff command
      const result = await handleHandoffCommand(input.sessionID, promptText)
      if (!result) {
        return
      }

      // Find the text part to replace
      const idx = output.parts.findIndex((p) => p.type === "text" && p.text)
      if (idx < 0) {
        return
      }

      // Replace with tagged result that instructs model to output it
      const taggedContent = `${HANDOFF_RESULT_TAG_OPEN}
${result}

---
*Please present the above result to the user exactly as shown.*
${HANDOFF_RESULT_TAG_CLOSE}`

      output.parts[idx].text = taggedContent

      log("[session-handoff] Processed /handoff command via chat.message", {
        sessionID: input.sessionID,
      })
    },

    /**
     * Handle user prompt submission
     *
     * Handles:
     * - Session start injection
     * - Message tracking
     * - @session reference resolution
     *
     * Note: /handoff commands are handled in chat.message, not here.
     */
    "user.prompt.submit": async (input: {
      sessionID: string
      parts?: Array<{ type: string; text?: string }>
      message?: { content: string }
    }) => {
      const { sessionID, parts, message } = input

      // Extract text from parts or message.content (support both formats)
      const promptText = parts
        ?.filter((p) => p.type === "text" && p.text)
        .map((p) => p.text)
        .join("\n") || message?.content || ""

      // On first message, inject handoffs
      const state = getState(sessionID)
      if (!state.injected) {
        // Avoid injecting on management commands (e.g., first prompt is "/handoff list")
        if (!promptText.trim().startsWith("/handoff")) {
          await handleSessionStart(sessionID, promptText)
        }
      }

      // Track the message (skip /handoff commands - they're system commands)
      if (promptText && !promptText.trim().startsWith("/handoff")) {
        trackMessage(sessionID, "user", promptText)
      }

      // Parse and resolve @session references in prompt
      const sessionRefEnabled = sessionReferenceConfig?.enabled !== false

      if (sessionRefEnabled && promptText && /@session:/.test(promptText)) {
        const maxResults = sessionReferenceConfig?.resolve_options?.max_results ?? 5
        const minRelevance = sessionReferenceConfig?.resolve_options?.min_relevance ?? 0.3

        const references = await parseSessionReferences(promptText, {
          embeddings: embed
            ? {
                embed,
                maxResults,
                minRelevance,
                generateIfMissing: true,
              }
            : undefined,
        })
        if (references.length > 0 && collector) {
          // Inject resolved reference content
          const refContent = references.map((r) =>
            `## Referenced Session Context\n\n*From: ${r.original}*\n\n${r.content}`
          ).join("\n\n---\n\n")

          collector.register(sessionID, {
            id: `session-ref-${Date.now()}`,
            source: "session-handoff",
            content: refContent,
            priority: "high", // High priority for explicit references
          })

          log("[session-handoff] Resolved @session references", {
            sessionID,
            count: references.length,
            refs: references.map((r) => r.original),
          })
        }
      }
    },

    /**
     * Handle events
     */
    event: async (input: { event: { type: string; properties?: unknown } }) => {
      const { event } = input
      const props = event.properties as Record<string, unknown> | undefined

      // session.idle - agent has finished and is waiting for user input
      // This is the primary trigger for handoff extraction
      if (event.type === "session.idle") {
        const sessionID = props?.sessionID as string | undefined
        if (sessionID) {
          await handleSessionIdle(sessionID)
        }
      }

      // session.deleted - session is being cleaned up
      // Fallback trigger and cleanup
      if (event.type === "session.deleted") {
        const sessionInfo = props?.info as { id?: string } | undefined
        if (sessionInfo?.id) {
          await handleSessionDeleted(sessionInfo.id)
        }
      }

      if (event.type === "session.compacted") {
        const sessionID = (props?.sessionID ??
          (props?.info as { id?: string } | undefined)?.id) as string | undefined
        if (sessionID) {
          const state = sessionStates.get(sessionID)
          if (state) {
            state.injected = false
          }
          // Reset recovery detector buffer on compaction
          const detector = recoveryDetectors.get(sessionID)
          if (detector) {
            detector.reset()
          }
        }
      }

      if (event.type === "message.updated") {
        const info = props?.info as { sessionID?: string; role?: string; content?: string } | undefined
        if (info?.sessionID && info?.role === "assistant" && info?.content) {
          // Pass isUpdate=true to handle streaming updates without duplicating messages
          trackMessage(info.sessionID, "assistant", info.content, true)
        }
      }
    },

    /**
     * Track tool execution
     */
    "tool.execute.after": async (
      input: { tool: string; sessionID: string },
      output: { output: string; args?: unknown; metadata?: { success?: boolean; args?: unknown } }
    ) => {
      // Extract args from metadata.args (preferred) or output.args (fallback)
      // This matches the pattern used in src/index.ts governance hooks
      const rawArgs = (output.metadata as { args?: unknown } | undefined)?.args ?? output.args
      const args = rawArgs && typeof rawArgs === "object" && !Array.isArray(rawArgs)
        ? (rawArgs as Record<string, unknown>)
        : undefined
      const success = output.metadata?.success ?? !output.output.toLowerCase().includes("error")

      trackToolCall(
        input.sessionID,
        input.tool,
        args || {},
        output.output.slice(0, 1000), // Truncate result
        success
      )

      // Recovery pattern detection
      if (enableRecoveryPatterns && config.enabled) {
        const detector = getRecoveryDetector(input.sessionID)
        const execution: ToolExecution = {
          tool: input.tool,
          args: args || {},
          success,
          error: success ? undefined : output.output.slice(0, 500),
          result: success ? output.output.slice(0, 200) : undefined,
          timestamp: Date.now(),
        }

        const pattern = detector.onToolExecuted(execution)
        if (pattern) {
          const extState = getExtendedState(input.sessionID)
          extState.recoveryPatterns = addOrMergePattern(extState.recoveryPatterns, pattern)

          log("[session-handoff] Detected recovery pattern", {
            sessionId: input.sessionID,
            patternId: pattern.id,
            failureCount: pattern.failureSequence.length,
            errorCategory: pattern.contextSignature.errorCategory,
            toolChain: pattern.contextSignature.toolChain,
          })
        }
      }
    },

    // Expose internal functions for testing and manual use
    _internal: {
      handleSessionStart,
      handleSessionIdle,
      handleSessionDeleted,
      trackMessage,
      trackToolCall,
      parseSessionReferences,
      parseHandoffCommand,
      handleHandoffCommand,
      getState: (sessionId: string) => sessionStates.get(sessionId),
      clearState: (sessionId: string) => sessionStates.delete(sessionId),
    },
  }
}

// ============================================================================
// Cleanup
// ============================================================================

/**
 * Clear all session states (for testing)
 */
export function clearAllSessionStates(): void {
  sessionStates.clear()
  extendedSessionStates.clear()
  recoveryDetectors.clear()
  extractionTasks.clear()
}
