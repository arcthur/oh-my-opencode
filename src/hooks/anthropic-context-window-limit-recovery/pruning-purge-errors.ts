import type { PruningState, ErroredToolCall } from "./pruning-types"
import { estimateTokens } from "./pruning-types"
import { markToolForPruning } from "./pruning-types"
import { log } from "../../shared/logger"
import { readMessages } from "./pruning-shared"

export interface PurgeErrorsConfig {
  enabled: boolean
  turns: number
}

interface ErrorCandidate {
  callID: string
  tool: string
  turn: number
  input: unknown
}

export function executePurgeErrors(
  sessionID: string,
  state: PruningState,
  config: PurgeErrorsConfig,
  protectedTools: Set<string>,
  turnProtectionTurns: number = 0
): number {
  if (!config.enabled) return 0

  const messages = readMessages(sessionID)

  // Single pass: collect error candidates and count turns simultaneously
  const candidates: ErrorCandidate[] = []
  let currentTurn = 0

  for (const msg of messages) {
    if (!msg.parts) continue

    for (const part of msg.parts) {
      if (part.type === "step-start") {
        currentTurn++
        continue
      }

      if (part.type !== "tool" || !part.callID || !part.tool) continue

      if (protectedTools.has(part.tool.toLowerCase())) continue

      const existing = state.toolPruneActions.get(part.callID)
      if (existing?.pruneInput === true && existing?.pruneOutput === true) continue

      if (part.state?.status !== "error") continue

      candidates.push({
        callID: part.callID,
        tool: part.tool,
        turn: currentTurn,
        input: part.state.input,
      })
    }
  }

  state.currentTurn = currentTurn

  const minPrunableTurn = Math.max(0, currentTurn - Math.max(0, turnProtectionTurns))

  // Now filter candidates based on turnAge (requires knowing final currentTurn)
  let prunedCount = 0
  let tokensSaved = 0

  for (const candidate of candidates) {
    if (candidate.turn > minPrunableTurn) continue
    const turnAge = currentTurn - candidate.turn

    if (turnAge >= config.turns) {
      const alreadyPruned =
        state.toolPruneActions.get(candidate.callID)?.pruneInput === true &&
        state.toolPruneActions.get(candidate.callID)?.pruneOutput === true

      markToolForPruning(state, candidate.callID, {
        pruneInput: true,
        pruneOutput: true,
        reason: "purge_errors",
      })

      if (!alreadyPruned) prunedCount++

      if (candidate.input) {
        tokensSaved += estimateTokens(JSON.stringify(candidate.input))
      }

      const errorInfo: ErroredToolCall = {
        callID: candidate.callID,
        toolName: candidate.tool,
        turn: candidate.turn,
        errorAge: turnAge,
      }

      state.erroredTools.set(candidate.callID, errorInfo)

      log("[pruning-purge-errors] pruned old error", {
        tool: candidate.tool,
        callID: candidate.callID,
        turn: candidate.turn,
        errorAge: turnAge,
        threshold: config.turns,
      })
    }
  }

  log("[pruning-purge-errors] complete", {
    prunedCount,
    tokensSaved,
    currentTurn,
    threshold: config.turns,
  })

  return prunedCount
}
