/**
 * Codemap Injector Hook
 *
 * Automatically injects relevant codemap context when files are read.
 * Provides architecture context for architecture-related queries.
 */

import type { PluginInput } from "@opencode-ai/plugin"
import { dirname, relative, resolve } from "node:path"
import {
  CodemapCache,
  createCodemapCache,
  detectQueryType,
  shouldSuggestCartography,
  getCartographySuggestion,
} from "../../features/codemap-injector"
import type { CodemapInjectorConfig } from "../../features/cartography/types"
import { DEFAULT_CODEMAP_INJECTOR_CONFIG } from "../../features/cartography/types"
import { extractCodemapSummary } from "../../features/cartography/generator"
import type { EventInput, MessageInput, ToolExecuteInput, ToolExecuteOutput } from "../../shared/hook-types"
import { log } from "../../shared"
import { contextBudgetArbiter } from "../../features/context-view"

// ============================================================================
// Types
// ============================================================================

interface CodemapInjectorSessionState {
  /** Directories already injected in this session */
  injectedDirs: Set<string>

  /** Whether root project map was injected */
  rootProjectMapInjected: boolean

  /** Whether root project map should be injected on next relevant read */
  pendingRootProjectMap: boolean

  /** Directories we've already suggested cartography for */
  suggestedDirs: Set<string>
}

// ============================================================================
// Hook Factory
// ============================================================================

export function createCodemapInjectorHook(
  ctx: PluginInput,
  userConfig?: Partial<CodemapInjectorConfig>
) {
  const cache = createCodemapCache(ctx.directory)
  const sessionStates = new Map<string, CodemapInjectorSessionState>()
  const config: CodemapInjectorConfig = { ...DEFAULT_CODEMAP_INJECTOR_CONFIG, ...userConfig }

  // Register the codemap-injector source limit so the arbiter respects the
  // user-configured per-hook budget (default 600 tokens).
  contextBudgetArbiter.setBudgetConfig({
    source_limits: { "codemap-injector": config.budget },
  })

  /**
   * Get or create session state
   */
  function getSessionState(sessionID: string): CodemapInjectorSessionState {
    if (!sessionStates.has(sessionID)) {
      sessionStates.set(sessionID, {
        injectedDirs: new Set(),
        rootProjectMapInjected: false,
        pendingRootProjectMap: false,
        suggestedDirs: new Set(),
      })
    }
    return sessionStates.get(sessionID)!
  }

  /**
   * Format codemap context for injection
   */
  function formatCodemapContext(entry: ReturnType<CodemapCache["findForDirectory"]>): string {
    if (!entry) return ""

    const summary = extractCodemapSummary(entry.codemap, config.max_per_codemap)
    const relativePath = relative(ctx.directory, entry.meta.directory) || "."

    return `\n\n[Codemap Context: ${relativePath}]\n${summary}`
  }

  /**
   * Format root project map for injection
   */
  function formatRootProjectMapContext(projectMap: string): string {
    // Truncate if needed
    const lines = projectMap.split("\n")
    const maxLines = 50

    if (lines.length > maxLines) {
      const truncated = lines.slice(0, maxLines).join("\n")
      return `\n\n[Project Map]\n${truncated}\n\n[Truncated: ${lines.length - maxLines} lines omitted]`
    }

    return `\n\n[Project Map]\n${projectMap}`
  }

  /**
   * Handle file read - inject relevant codemap
   */
  const toolExecuteAfter = async (
    input: ToolExecuteInput,
    output: ToolExecuteOutput
  ) => {
    if (!config.enabled) return

    const toolName = input.tool.toLowerCase()
    if (toolName !== "read") return

    const filePath = output.title
    if (!filePath) return

    const resolvedPath = filePath.startsWith("/") ? filePath : resolve(ctx.directory, filePath)
    if (!resolvedPath.startsWith(ctx.directory)) return

    const dir = dirname(resolvedPath)
    const state = getSessionState(input.sessionID)

    // Inject root project map once for architecture/refactoring queries
    // when explicitly enabled to avoid overlap with repo-overview injector.
    if (config.inject_root_project_map && state.pendingRootProjectMap && !state.rootProjectMapInjected) {
      const projectMap = cache.getRootProjectMap()
      if (projectMap) {
        const projectMapContext = formatRootProjectMapContext(projectMap)
        const decision = contextBudgetArbiter.decide({
          sessionID: input.sessionID,
          source: "codemap-injector",
          channel: "tool-output",
          id: "root-project-map",
          priority: "normal",
          content: projectMapContext,
        })
        if (decision.accepted) {
          output.output += decision.finalContent
        }
      }

      state.rootProjectMapInjected = true
      state.pendingRootProjectMap = false
    }

    // Find codemap for this directory
    const entry = cache.findForDirectory(dir)

    if (entry) {
      const injectedDir = relative(ctx.directory, entry.meta.directory) || "."
      if (state.injectedDirs.has(injectedDir)) {
        return
      }

      const context = formatCodemapContext(entry)
      if (context) {
        const decision = contextBudgetArbiter.decide({
          sessionID: input.sessionID,
          source: "codemap-injector",
          channel: "tool-output",
          id: `codemap:${injectedDir}`,
          priority: "normal",
          content: context,
        })
        if (decision.accepted) {
          output.output += decision.finalContent
          state.injectedDirs.add(injectedDir)
          log(`[codemap-injector] Injected context for: ${injectedDir}`)
        }
      }
    }

    // Suggest cartography for frequently accessed directories lacking an exact codemap
    if (config.suggest_cartography) {
      const accessCount = cache.getDirectoryAccessCount(dir)
      const hasDirectoryCodemap = Boolean(entry && entry.meta.directory === dir)
      const relativeDir = relative(ctx.directory, dir) || "."

      if (
        shouldSuggestCartography(hasDirectoryCodemap, accessCount, config.suggest_cartography) &&
        !state.suggestedDirs.has(relativeDir)
      ) {
        const suggestion = `\n\n${getCartographySuggestion(relativeDir)}`
        const decision = contextBudgetArbiter.decide({
          sessionID: input.sessionID,
          source: "codemap-injector",
          channel: "tool-output",
          id: `suggest:${relativeDir}`,
          priority: "low",
          content: suggestion,
        })
        if (decision.accepted) {
          output.output += decision.finalContent
        }
        state.suggestedDirs.add(relativeDir)
      }
    }
  }

  /**
   * Handle user prompt - inject root project map for architecture questions
   */
  const userPromptSubmit = async (input: MessageInput) => {
    if (!config.enabled) return

    const state = getSessionState(input.sessionID)

    // If we've already injected the projectMap, don't queue it again
    if (state.rootProjectMapInjected) return

    const messageText = input.message?.content ?? ""
    if (!messageText) return

    if (!config.inject_root_project_map) {
      state.pendingRootProjectMap = false
      return
    }

    const trigger = detectQueryType(messageText)
    state.pendingRootProjectMap = trigger.injectRootProjectMap
  }

  /**
   * Handle session events
   */
  const eventHandler = async ({ event }: EventInput) => {
    const props = event.properties as Record<string, unknown> | undefined

    // Clear session state on delete
    if (event.type === "session.deleted") {
      const sessionInfo = props?.info as { id?: string } | undefined
      if (sessionInfo?.id) {
        sessionStates.delete(sessionInfo.id)
      }
    }

    // Clear session state on compaction
    if (event.type === "session.compacted") {
      const sessionID = (props?.sessionID ??
        (props?.info as { id?: string } | undefined)?.id) as string | undefined
      if (sessionID) {
        sessionStates.delete(sessionID)
      }
    }
  }

  return {
    "tool.execute.after": toolExecuteAfter,
    "user.prompt.submit": userPromptSubmit,
    event: eventHandler,
  }
}
