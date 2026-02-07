import type { PluginInput } from "@opencode-ai/plugin"
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { join } from "node:path"
import { homedir } from "node:os"
import type { RepoOverviewConfig } from "./types"
import { DEFAULT_CONFIG } from "./types"
import { generateRepoOverview, formatRepoOverview } from "./generator"
import { log } from "../../shared/logger"
import { contextBudgetArbiter } from "../../features/context-budget"

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

interface CacheEntry {
  overview: string
  timestamp: number
  projectDir: string
}

const CACHE_DIR = join(homedir(), ".opencode", "cache", "repo-overview")

function ensureCacheDir(): void {
  if (!existsSync(CACHE_DIR)) {
    mkdirSync(CACHE_DIR, { recursive: true })
  }
}

function getCacheKey(projectDir: string): string {
  // Create a safe filename from project path
  return Buffer.from(projectDir).toString("base64url")
}

function getCachedOverview(projectDir: string, config: RepoOverviewConfig): string | null {
  try {
    ensureCacheDir()
    const cacheFile = join(CACHE_DIR, `${getCacheKey(projectDir)}.json`)

    if (!existsSync(cacheFile)) return null

    const data: CacheEntry = JSON.parse(readFileSync(cacheFile, "utf-8"))

    // Check if cache is still valid
    if (Date.now() - data.timestamp > config.cache_duration_ms) {
      return null
    }

    if (data.projectDir !== projectDir) {
      return null
    }

    return data.overview
  } catch {
    return null
  }
}

function setCachedOverview(projectDir: string, overview: string): void {
  try {
    ensureCacheDir()
    const cacheFile = join(CACHE_DIR, `${getCacheKey(projectDir)}.json`)

    const data: CacheEntry = {
      overview,
      timestamp: Date.now(),
      projectDir,
    }

    writeFileSync(cacheFile, JSON.stringify(data, null, 2), "utf-8")
  } catch (error) {
    log("[repo-overview] failed to cache overview", { error: String(error) })
  }
}

export function createRepoOverviewInjectorHook(ctx: PluginInput, userConfig?: Partial<RepoOverviewConfig>) {
  const config: RepoOverviewConfig = { ...DEFAULT_CONFIG, ...userConfig }
  const injectedSessions = new Set<string>()
  const sessionToolCalls = new Map<string, number>()

  async function injectOverview(sessionID: string, output: ToolExecuteOutput): Promise<void> {
    if (!config.enabled || !config.auto_generate) return
    if (injectedSessions.has(sessionID)) return

    const projectDir = ctx.directory

    // Try to get cached overview
    let overviewText = getCachedOverview(projectDir, config)

    if (!overviewText) {
      log("[repo-overview] generating new overview", { projectDir })
      const overview = generateRepoOverview(projectDir, config.max_tree_depth)
      overviewText = formatRepoOverview(overview)
      setCachedOverview(projectDir, overviewText)
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
    if (count >= config.min_tool_calls) {
      await injectOverview(input.sessionID, output)
    }
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
