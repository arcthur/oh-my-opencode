import type { PluginInput } from "@opencode-ai/plugin"
import type { RuntimeTrackerConfig, RuntimeStats, ToolRuntime } from "./types"
import { DEFAULT_CONFIG } from "./types"
import { appendBudgetedOutput } from "../../features/context-budget"
import { log } from "../../shared/logger"

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

/**
 * Runtime Tracker Hook
 *
 * Tracks tool execution times and injects hints when tools are slow.
 * This helps the agent:
 * 1. Avoid repeating slow operations
 * 2. Choose faster alternatives
 * 3. Set appropriate timeouts
 *
 * Inspired by Factory.ai Droid's runtime tracking feature.
 */
export function createRuntimeTrackerHook(ctx: PluginInput, userConfig?: Partial<RuntimeTrackerConfig>) {
  const config: RuntimeTrackerConfig = { ...DEFAULT_CONFIG, ...userConfig }

  // Per-session runtime stats
  const sessionStats = new Map<string, RuntimeStats>()

  // Track in-progress tool calls
  const pendingCalls = new Map<string, { tool: string; startTime: number }>()

  // Track last hint time per session+tool to implement cooldown
  const lastHintTime = new Map<string, number>()

  function getSessionStats(sessionID: string): RuntimeStats {
    if (!sessionStats.has(sessionID)) {
      sessionStats.set(sessionID, {})
    }
    return sessionStats.get(sessionID)!
  }

  function updateStats(sessionID: string, tool: string, duration: number): void {
    const stats = getSessionStats(sessionID)

    if (!stats[tool]) {
      stats[tool] = {
        tool,
        avgDuration: duration,
        lastDuration: duration,
        callCount: 1,
        recentDurations: [duration],
        lastCalled: Date.now(),
      }
    } else {
      const toolStats = stats[tool]
      toolStats.lastDuration = duration
      toolStats.callCount++
      toolStats.lastCalled = Date.now()

      // Update rolling average
      toolStats.recentDurations.push(duration)
      if (toolStats.recentDurations.length > config.max_recent) {
        toolStats.recentDurations.shift()
      }

      // Calculate new average
      toolStats.avgDuration = Math.round(
        toolStats.recentDurations.reduce((a, b) => a + b, 0) / toolStats.recentDurations.length
      )
    }
  }

  function formatDuration(ms: number): string {
    if (ms < 1000) return `${ms}ms`
    return `${(ms / 1000).toFixed(1)}s`
  }

  function getSlowToolsHint(sessionID: string): string | null {
    const stats = getSessionStats(sessionID)
    const slowTools: ToolRuntime[] = []

    for (const tool of Object.values(stats)) {
      if (tool.avgDuration >= config.threshold_ms && tool.callCount >= 2) {
        slowTools.push(tool)
      }
    }

    if (slowTools.length === 0) return null

    // Sort by average duration descending
    slowTools.sort((a, b) => b.avgDuration - a.avgDuration)

    const hints = slowTools.slice(0, 3).map(t => {
      return `- ${t.tool}: avg ${formatDuration(t.avgDuration)} (${t.callCount} calls)`
    })

    return `[Runtime Notice: Slow tools detected]\n${hints.join("\n")}\n[Consider narrower queries or caching results]`
  }

  const toolExecuteBefore = async (
    input: ToolExecuteInput,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _output: unknown
  ) => {
    if (!config.enabled) return

    pendingCalls.set(input.callID, {
      tool: input.tool,
      startTime: Date.now(),
    })
  }

  const toolExecuteAfter = async (
    input: ToolExecuteInput,
    output: ToolExecuteOutput
  ) => {
    if (!config.enabled) return

    const pending = pendingCalls.get(input.callID)
    if (!pending) return

    const duration = Date.now() - pending.startTime
    pendingCalls.delete(input.callID)

    // Update stats
    updateStats(input.sessionID, input.tool, duration)

    log("[runtime-tracker] tool completed", {
      tool: input.tool,
      duration,
      sessionID: input.sessionID,
    })

    // Inject hint if tool was slow (with cooldown throttling)
    if (config.inject_hints && duration >= config.threshold_ms) {
      const hintKey = `${input.sessionID}:${input.tool}`
      const lastHint = lastHintTime.get(hintKey) || 0
      const now = Date.now()

      // Only inject hint if cooldown has passed
      if (now - lastHint >= config.hint_cooldown_ms) {
        const stats = getSessionStats(input.sessionID)
        const toolStats = stats[input.tool]

        if (toolStats && toolStats.callCount >= 2) {
          appendBudgetedOutput({
            output,
            sessionID: input.sessionID,
            source: "runtime-tracker",
            id: `${input.callID}:runtime-hint-avg`,
            priority: "low",
            content: `\n\n[Runtime: ${formatDuration(duration)} - Tool "${input.tool}" averaged ${formatDuration(toolStats.avgDuration)} over ${toolStats.callCount} calls. Consider optimizing or caching.]`,
          })
        } else {
          appendBudgetedOutput({
            output,
            sessionID: input.sessionID,
            source: "runtime-tracker",
            id: `${input.callID}:runtime-hint-single`,
            priority: "low",
            content: `\n\n[Runtime: ${formatDuration(duration)} - This tool call was slow.]`,
          })
        }

        lastHintTime.set(hintKey, now)
      } else {
        log("[runtime-tracker] hint throttled (cooldown)", {
          tool: input.tool,
          sessionID: input.sessionID,
          cooldownRemaining: config.hint_cooldown_ms - (now - lastHint),
        })
      }
    }
  }

  function clearSessionHintTimes(sessionID: string): void {
    // Clear all hint times for this session
    for (const key of lastHintTime.keys()) {
      if (key.startsWith(`${sessionID}:`)) {
        lastHintTime.delete(key)
      }
    }
  }

  const eventHandler = async ({ event }: EventInput) => {
    const props = event.properties as Record<string, unknown> | undefined

    // Clear session stats on session deletion
    if (event.type === "session.deleted") {
      const sessionInfo = props?.info as { id?: string } | undefined
      if (sessionInfo?.id) {
        sessionStats.delete(sessionInfo.id)
        clearSessionHintTimes(sessionInfo.id)
      }
    }

    // Clear session stats on compaction
    if (event.type === "session.compacted") {
      const sessionID = (props?.sessionID ??
        (props?.info as { id?: string } | undefined)?.id) as string | undefined
      if (sessionID) {
        sessionStats.delete(sessionID)
        clearSessionHintTimes(sessionID)
      }
    }
  }

  return {
    "tool.execute.before": toolExecuteBefore,
    "tool.execute.after": toolExecuteAfter,
    event: eventHandler,
  }
}

export type { RuntimeTrackerConfig, ToolRuntime, RuntimeStats } from "./types"
export { DEFAULT_CONFIG } from "./types"
