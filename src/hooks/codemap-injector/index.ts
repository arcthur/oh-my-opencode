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
import type { SessionInjectionState } from "../../features/codemap-injector/types"
import type { CodemapInjectorConfig } from "../../features/cartography/types"
import { DEFAULT_CODEMAP_INJECTOR_CONFIG } from "../../features/cartography/types"
import { extractCodemapSummary } from "../../features/cartography/generator"
import type { EventInput, MessageInput, ToolExecuteInput, ToolExecuteOutput } from "../../shared/hook-types"
import { log } from "../../shared"

// ============================================================================
// Types
// ============================================================================

interface CodemapInjectorSessionState extends SessionInjectionState {
  /** Whether root atlas should be injected on next relevant read */
  pendingRootAtlas: boolean

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

  function estimateTokens(text: string): number {
    return Math.ceil(text.length / 4)
  }

  /**
   * Get or create session state
   */
  function getSessionState(sessionID: string): CodemapInjectorSessionState {
    if (!sessionStates.has(sessionID)) {
      sessionStates.set(sessionID, {
        injectedDirs: new Set(),
        rootAtlasInjected: false,
        tokensInjected: 0,
        lastInjection: 0,
        pendingRootAtlas: false,
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
   * Format root atlas for injection
   */
  function formatRootAtlasContext(atlas: string): string {
    // Truncate if needed
    const lines = atlas.split("\n")
    const maxLines = 50

    if (lines.length > maxLines) {
      const truncated = lines.slice(0, maxLines).join("\n")
      return `\n\n[Project Atlas]\n${truncated}\n\n[Truncated: ${lines.length - maxLines} lines omitted]`
    }

    return `\n\n[Project Atlas]\n${atlas}`
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

    // Check budget
    if (state.tokensInjected >= config.budget) {
      return
    }

    // Inject root atlas once for architecture/refactoring queries
    if (state.pendingRootAtlas && !state.rootAtlasInjected) {
      const atlas = cache.getRootAtlas()
      if (atlas) {
        const atlasContext = formatRootAtlasContext(atlas)
        const atlasTokens = estimateTokens(atlasContext)

        if (state.tokensInjected + atlasTokens <= config.budget) {
          output.output += atlasContext
          state.tokensInjected += atlasTokens
          state.lastInjection = Date.now()
        }
      }

      state.rootAtlasInjected = true
      state.pendingRootAtlas = false
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
        const tokens = estimateTokens(context)
        if (state.tokensInjected + tokens <= config.budget) {
          output.output += context
          state.injectedDirs.add(injectedDir)
          state.tokensInjected += tokens
          state.lastInjection = Date.now()
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
        output.output += `\n\n${getCartographySuggestion(relativeDir)}`
        state.suggestedDirs.add(relativeDir)
      }
    }
  }

  /**
   * Handle user prompt - inject root atlas for architecture questions
   */
  const userPromptSubmit = async (input: MessageInput) => {
    if (!config.enabled) return

    const state = getSessionState(input.sessionID)

    // If we've already injected the atlas, don't queue it again
    if (state.rootAtlasInjected) return

    const messageText = input.message?.content ?? ""
    if (!messageText) return

    const trigger = detectQueryType(messageText)
    state.pendingRootAtlas = trigger.injectRootAtlas
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
