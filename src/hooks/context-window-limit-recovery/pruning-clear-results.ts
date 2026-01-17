import type { PruningState } from "./pruning-types"
import { estimateTokens } from "./pruning-types"
import { markToolForPruning } from "./pruning-types"
import { log } from "../../shared/logger"
import { readMessages } from "./pruning-shared"

export interface ClearResultsConfig {
  enabled: boolean
  /** Number of recent turns to preserve (default: 5) */
  keep_recent_turns: number
}

interface TurnInfo {
  turn: number
  callID: string
  tool: string
  outputSize: number
}

/**
 * Clear tool results from older turns, keeping only recent N turns with full output.
 * This is one of the safest forms of compaction - once a tool has been called deep
 * in the message history, the agent doesn't need to see the raw result again.
 *
 * Reference: https://jxnl.co/writing/2025/08/30/context-engineering-compaction/
 */
export function executeClearResults(
  sessionID: string,
  state: PruningState,
  config: ClearResultsConfig,
  protectedTools: Set<string>,
  turnProtectionTurns: number = 0
): number {
  if (!config.enabled) return 0

  const messages = readMessages(sessionID)
  const keepRecentTurns = Math.max(
    config.keep_recent_turns || 5,
    Math.max(0, turnProtectionTurns)
  )

  // First pass: count turns and collect tool info
  const toolInfos: TurnInfo[] = []
  let currentTurn = 0

  for (const msg of messages) {
    if (!msg.parts) continue

    for (const part of msg.parts) {
      if (part.type === "step-start") {
        currentTurn++
        continue
      }

      if (part.type !== "tool" || !part.callID || !part.tool) continue

      // Skip protected tools
      if (protectedTools.has(part.tool.toLowerCase())) continue

      // Skip already output-pruned
      if (state.toolPruneActions.get(part.callID)?.pruneOutput === true) continue

      // Skip tools without output
      if (!part.state?.output) continue

      // Skip already pruned results
      if (part.state.output.includes("[Content pruned")) continue

      toolInfos.push({
        turn: currentTurn,
        callID: part.callID,
        tool: part.tool,
        outputSize: estimateTokens(part.state.output),
      })
    }
  }

  state.currentTurn = currentTurn

  // Determine cutoff turn (prune everything before this turn)
  const cutoffTurn = Math.max(0, currentTurn - keepRecentTurns)

  if (cutoffTurn === 0) {
    log("[pruning-clear-results] not enough turns to prune", {
      currentTurn,
      keepRecentTurns,
    })
    return 0
  }

  // Filter to only tools from older turns, then sort by size descending
  // This maximizes token savings per pruning operation
  const toPrune = toolInfos
    .filter(info => info.turn < cutoffTurn)
    .sort((a, b) => b.outputSize - a.outputSize)

  let prunedCount = 0
  let tokensSaved = 0

  for (const info of toPrune) {
    const alreadyOutputPruned = state.toolPruneActions.get(info.callID)?.pruneOutput === true
    markToolForPruning(state, info.callID, {
      pruneOutput: true,
      reason: "clear_tool_results",
    })
    if (!alreadyOutputPruned) prunedCount++
    tokensSaved += info.outputSize

    log("[pruning-clear-results] marked for pruning", {
      tool: info.tool,
      callID: info.callID,
      turn: info.turn,
      cutoffTurn,
      outputSize: info.outputSize,
    })
  }

  log("[pruning-clear-results] complete", {
    prunedCount,
    tokensSaved,
    currentTurn,
    cutoffTurn,
    keepRecentTurns,
  })

  return prunedCount
}
