import type { PruningState, ErroredToolCall } from "./pruning-types"
import { estimateTokens } from "./pruning-types"
import { log } from "../../shared/logger"
import { readMessages } from "./pruning-shared"

export interface PurgeErrorsConfig {
  enabled: boolean
  turns: number
  protectedTools?: string[]
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
  protectedTools: Set<string>
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

      if (protectedTools.has(part.tool)) continue

      if (config.protectedTools?.includes(part.tool)) continue

      if (state.toolIdsToPrune.has(part.callID)) continue

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

  // Now filter candidates based on turnAge (requires knowing final currentTurn)
  let prunedCount = 0
  let tokensSaved = 0

  for (const candidate of candidates) {
    const turnAge = currentTurn - candidate.turn

    if (turnAge >= config.turns) {
      state.toolIdsToPrune.add(candidate.callID)
      prunedCount++

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
