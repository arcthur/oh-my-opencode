import type { PluginInput } from "@opencode-ai/plugin"
import { dirname, resolve } from "node:path"
import type {
  RepoOverviewConfig,
  RepoOverviewCoordinationConfig,
} from "./types"
import { DEFAULT_CONFIG, DEFAULT_COORDINATION_CONFIG } from "./types"
import { generateRepoOverview, formatRepoOverview } from "./generator"
import { log } from "../../shared/logger"
import { contextBudgetArbiter } from "../../features/context-view"
import { createCodemapCache } from "../../features/codemap-injector"
import {
  getCachedRepoOverview,
  setCachedRepoOverview,
} from "../../shared/repo-overview-cache"

interface ToolExecuteInput {
  tool: string
  sessionID: string
  callID: string
}

interface ToolExecuteOutput {
  title: string
  output: string
  metadata: unknown
}

interface EventInput {
  event: {
    type: string
    properties?: unknown
  }
}

export function createRepoOverviewInjectorHook(
  ctx: PluginInput,
  userConfig?: Partial<RepoOverviewConfig>,
  coordinationConfig?: Partial<RepoOverviewCoordinationConfig>
) {
  const config: RepoOverviewConfig = { ...DEFAULT_CONFIG, ...userConfig }
  const coordination: RepoOverviewCoordinationConfig = {
    ...DEFAULT_COORDINATION_CONFIG,
    ...coordinationConfig,
  }
  const codemapCache = createCodemapCache(ctx.directory)
  const injectedSessions = new Set<string>()
  const sessionToolCalls = new Map<string, number>()

  function hasCodemapCoverageForRead(output: ToolExecuteOutput): boolean {
    const filePath = output.title
    if (!filePath) return false

    const resolvedPath = filePath.startsWith("/")
      ? filePath
      : resolve(ctx.directory, filePath)

    if (!resolvedPath.startsWith(ctx.directory)) {
      return false
    }

    const dir = dirname(resolvedPath)
    return Boolean(codemapCache.findForDirectory(dir))
  }

  async function injectOverview(sessionID: string, output: ToolExecuteOutput): Promise<void> {
    if (!config.enabled || !config.auto_generate) return
    if (injectedSessions.has(sessionID)) return

    const projectDir = ctx.directory

    // Try to get cached overview
    let overviewText = getCachedRepoOverview(projectDir, config.cache_duration_ms)

    if (!overviewText) {
      log("[repo-overview] generating new overview", { projectDir })
      const overview = generateRepoOverview(projectDir, config.max_tree_depth)
      overviewText = formatRepoOverview(overview)
      setCachedRepoOverview(projectDir, overviewText)
    } else {
      log("[repo-overview] using cached overview", { projectDir })
    }

    const injection = `\n\n[Repository Overview - Bootstrapped Context]\n${overviewText}\n[End Repository Overview]`
    const decision = contextBudgetArbiter.decide({
      sessionID,
      source: "repo-overview-injector",
      channel: "tool-output",
      id: "repo-overview",
      priority: "normal",
      content: injection,
    })
    if (!decision.accepted) {
      return
    }

    // Inject as context
    output.output += decision.finalContent
    injectedSessions.add(sessionID)

    log("[repo-overview] injected overview for session", { sessionID })
  }

  const toolExecuteAfter = async (
    input: ToolExecuteInput,
    output: ToolExecuteOutput
  ) => {
    if (injectedSessions.has(input.sessionID)) return

    // Track tool call count for this session
    const count = (sessionToolCalls.get(input.sessionID) || 0) + 1
    sessionToolCalls.set(input.sessionID, count)

    // Only inject after reaching min_tool_calls threshold
    if (count < config.min_tool_calls) {
      return
    }

    if (
      coordination.suppress_read_injection_when_codemap_enabled
      && input.tool.trim().toLowerCase() === "read"
      && hasCodemapCoverageForRead(output)
    ) {
      log("[repo-overview] deferred read injection due to codemap coordination", {
        sessionID: input.sessionID,
        callID: input.callID,
      })
      return
    }

    await injectOverview(input.sessionID, output)
  }

  const eventHandler = async ({ event }: EventInput) => {
    const props = event.properties as Record<string, unknown> | undefined

    // Clear session state on session deletion
    if (event.type === "session.deleted") {
      const sessionInfo = props?.info as { id?: string } | undefined
      if (sessionInfo?.id) {
        injectedSessions.delete(sessionInfo.id)
        sessionToolCalls.delete(sessionInfo.id)
      }
    }

    // Clear session state on compaction (will re-inject on next tool use)
    if (event.type === "session.compacted") {
      const sessionID = (props?.sessionID ??
        (props?.info as { id?: string } | undefined)?.id) as string | undefined
      if (sessionID) {
        injectedSessions.delete(sessionID)
        sessionToolCalls.delete(sessionID)
      }
    }
  }

  return {
    "tool.execute.after": toolExecuteAfter,
    event: eventHandler,
  }
}
