/**
 * Session Handoff Hook
 *
 * Integrates session handoff with the plugin lifecycle:
 * - On session end: extract and save handoff
 * - On session start: inject relevant handoffs
 */

import { isAbsolute, relative } from "node:path"
import type { SessionHandoffConfig } from "./types"
import { createHandoffPackage, buildExtractionContext, type ExtractorDependencies } from "./extractor"
import { generateInjectionContent, resolveSessionReference, type ResolveSessionReferenceOptions } from "./injector"
import { saveHandoff, cleanupExpired, shouldRunCleanup, findHandoffBySessionId, saveEmbeddings } from "./storage"
import { log } from "../../shared/logger"
import type { RegisterContextOptions } from "../context-injector/types"
import { buildEmbeddingIndexEntries, generateEmbeddingVectors } from "./embeddings"
import type { SessionReferenceConfig } from "../../config/schema"

// ============================================================================
// Session State Tracking
// ============================================================================

interface SessionState {
  projectPath: string
  startTime: number
  messages: Array<{ role: "user" | "assistant"; content: string; timestamp: number }>
  toolCalls: Array<{ tool: string; args: Record<string, unknown>; result: string; success: boolean }>
  fileChanges: Set<string>
  injected: boolean
  /** Whether handoff has been extracted for this session */
  extracted: boolean
}

const sessionStates = new Map<string, SessionState>()

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
}

// ============================================================================
// Hook Creation
// ============================================================================

/**
 * Create session handoff hooks
 */
export function createSessionHandoffHook(ctx: SessionHandoffHookContext) {
  const { config, cwd, callLLM, collector, embed, sessionReferenceConfig } = ctx

  const deps: ExtractorDependencies = { callLLM }

  /**
   * Get or create session state
   */
  function getState(sessionId: string): SessionState {
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

    // Generate and inject content
    const content = generateInjectionContent(cwd, config, initialPrompt)
    if (!content) return

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
    log("[session-handoff] Injected context", { sessionId, contentLength: content.length })
  }

  /**
   * Track message for extraction
   */
  function trackMessage(sessionId: string, role: "user" | "assistant", content: string): void {
    if (!config.enabled || !config.auto_extract) return

    const state = getState(sessionId)
    state.messages.push({
      role,
      content,
      timestamp: Date.now(),
    })
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
    if (!config.enabled || !config.auto_extract) return

    const state = getState(sessionId)
    state.toolCalls.push({ tool, args, result, success })

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

    // Mark as extracted to prevent duplicate attempts
    state.extracted = true

    // Capture state for extraction (don't delete - session may continue)
    const capturedState = {
      projectPath: state.projectPath,
      startTime: state.startTime,
      messages: [...state.messages],
      toolCalls: [...state.toolCalls],
      fileChanges: [...state.fileChanges],
    }

    await performExtraction(sessionId, capturedState, "idle")
  }

  /**
   * Handle session deleted - clean up and extract if not already done
   * Called on session.deleted event. Always deletes state.
   */
  async function handleSessionDeleted(sessionId: string): Promise<void> {
    const state = sessionStates.get(sessionId)
    if (!state) return

    // If not yet extracted, try now
    if (!state.extracted && config.enabled && config.auto_extract) {
      // Check thresholds
      const shouldExtract =
        state.messages.length >= config.min_messages_for_extract &&
        state.fileChanges.size >= config.min_file_changes_for_extract &&
        !findHandoffBySessionId(sessionId)

      if (shouldExtract) {
        const capturedState = {
          projectPath: state.projectPath,
          startTime: state.startTime,
          messages: [...state.messages],
          toolCalls: [...state.toolCalls],
          fileChanges: [...state.fileChanges],
        }

        // Clean up state first
        sessionStates.delete(sessionId)

        await performExtraction(sessionId, capturedState, "deleted")
        return
      }
    }

    // Just clean up
    sessionStates.delete(sessionId)
  }

  /**
   * Perform the actual extraction
   */
  async function performExtraction(
    sessionId: string,
    capturedState: {
      projectPath: string
      startTime: number
      messages: Array<{ role: "user" | "assistant"; content: string; timestamp: number }>
      toolCalls: Array<{ tool: string; args: Record<string, unknown>; result: string; success: boolean }>
      fileChanges: string[]
    },
    trigger: "idle" | "deleted"
  ): Promise<void> {
    const doExtraction = async () => {
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
          }
        }

        saveHandoff(pkg)

        log("[session-handoff] Created handoff", {
          sessionId,
          handoffId: pkg.id,
          decisions: pkg.payload.decisions.length,
          artifacts: pkg.payload.artifacts.length,
          antiPatterns: pkg.payload.antiPatterns.length,
          embeddings: pkg.embeddingIndex?.length ?? 0,
          trigger,
          async: config.async_extraction,
        })
      } catch (error) {
        log("[session-handoff] Failed to create handoff", {
          sessionId,
          error: String(error),
          trigger,
          async: config.async_extraction,
        })
      }
    }

    if (config.async_extraction) {
      // Non-blocking: fire and forget
      doExtraction().catch(() => {
        // Error already logged inside doExtraction
      })
    } else {
      // Blocking: wait for completion
      await doExtraction()
    }
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
  // Hook Handlers
  // ============================================================================

  return {
    name: "session-handoff",

    /**
     * Handle user prompt submission
     */
    "user.prompt.submit": async (input: { sessionID: string; parts?: Array<{ type: string; text?: string }> }) => {
      const { sessionID, parts } = input

      // Extract text from parts
      const promptText = parts
        ?.filter((p) => p.type === "text" && p.text)
        .map((p) => p.text)
        .join("\n") || ""

      // On first message, inject handoffs
      const state = getState(sessionID)
      if (!state.injected) {
        await handleSessionStart(sessionID, promptText)
      }

      // Track the message
      if (promptText) {
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
        }
      }

      if (event.type === "message.updated") {
        const info = props?.info as { sessionID?: string; role?: string; content?: string } | undefined
        if (info?.sessionID && info?.role === "assistant" && info?.content) {
          trackMessage(info.sessionID, "assistant", info.content)
        }
      }
    },

    /**
     * Track tool execution
     */
    "tool.execute.after": async (
      input: { tool: string; sessionID: string },
      output: { output: string; args?: unknown; metadata?: { success?: boolean } }
    ) => {
      const args = output.args as Record<string, unknown> | undefined
      const success = output.metadata?.success ?? !output.output.toLowerCase().includes("error")

      trackToolCall(
        input.sessionID,
        input.tool,
        args || {},
        output.output.slice(0, 1000), // Truncate result
        success
      )
    },

    // Expose internal functions for testing and manual use
    _internal: {
      handleSessionStart,
      handleSessionIdle,
      handleSessionDeleted,
      trackMessage,
      trackToolCall,
      parseSessionReferences,
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
}
