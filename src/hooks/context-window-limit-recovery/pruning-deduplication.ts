import type { PruningState, ToolCallSignature } from "./pruning-types"
import { estimateTokens } from "./pruning-types"
import { markToolForPruning } from "./pruning-types"
import { log } from "../../shared/logger"
import { readMessages, findToolOutput } from "./pruning-shared"

export interface DeduplicationConfig {
  enabled: boolean
}

export function createToolSignature(toolName: string, input: unknown): string {
  const sortedInput = sortObject(input)
  return `${toolName}::${JSON.stringify(sortedInput)}`
}

function sortObject(obj: unknown): unknown {
  if (obj === null || obj === undefined) return obj
  if (typeof obj !== "object") return obj
  if (Array.isArray(obj)) return obj.map(sortObject)

  const sorted: Record<string, unknown> = {}
  const keys = Object.keys(obj as Record<string, unknown>).sort()
  for (const key of keys) {
    sorted[key] = sortObject((obj as Record<string, unknown>)[key])
  }
  return sorted
}

export function executeDeduplication(
  sessionID: string,
  state: PruningState,
  config: DeduplicationConfig,
  protectedTools: Set<string>,
  turnProtectionTurns: number = 0
): number {
  if (!config.enabled) return 0

  const messages = readMessages(sessionID)
  const signatures = new Map<string, ToolCallSignature[]>()
  
  let currentTurn = 0
  
  for (const msg of messages) {
    if (!msg.parts) continue
    
    for (const part of msg.parts) {
      if (part.type === "step-start") {
        currentTurn++
        continue
      }
      
      if (part.type !== "tool" || !part.callID || !part.tool) continue
      
      const toolName = part.tool.toLowerCase()
      if (protectedTools.has(toolName)) continue

      if (state.toolPruneActions.get(part.callID)?.pruneInput && state.toolPruneActions.get(part.callID)?.pruneOutput) {
        continue
      }
      
      const signature = createToolSignature(toolName, part.state?.input)
      
      if (!signatures.has(signature)) {
        signatures.set(signature, [])
      }
      
      signatures.get(signature)!.push({
        toolName,
        signature,
        callID: part.callID,
        turn: currentTurn,
      })
      
      if (!state.toolSignatures.has(signature)) {
        state.toolSignatures.set(signature, [])
      }
      state.toolSignatures.get(signature)!.push({
        toolName,
        signature,
        callID: part.callID,
        turn: currentTurn,
      })
    }
  }

  state.currentTurn = currentTurn

  const minPrunableTurn = Math.max(0, currentTurn - Math.max(0, turnProtectionTurns))

  let prunedCount = 0
  let tokensSaved = 0
  
  for (const [signature, calls] of signatures) {
    if (calls.length > 1) {
      const toPrune = calls.slice(0, -1)
      
      for (const call of toPrune) {
        if (call.turn > minPrunableTurn) continue
        const alreadyPruned =
          state.toolPruneActions.get(call.callID)?.pruneInput === true &&
          state.toolPruneActions.get(call.callID)?.pruneOutput === true

        markToolForPruning(state, call.callID, {
          pruneInput: true,
          pruneOutput: true,
          reason: "deduplication",
        })

        if (!alreadyPruned) {
          prunedCount++
        }
        
        const output = findToolOutput(messages, call.callID)
        if (output) {
          tokensSaved += estimateTokens(output)
        }
        
        log("[pruning-deduplication] pruned duplicate", {
          tool: call.toolName,
          callID: call.callID,
          turn: call.turn,
          signature: signature.substring(0, 100),
        })
      }
    }
  }
  
  log("[pruning-deduplication] complete", {
    prunedCount,
    tokensSaved,
    uniqueSignatures: signatures.size,
  })
  
  return prunedCount
}
