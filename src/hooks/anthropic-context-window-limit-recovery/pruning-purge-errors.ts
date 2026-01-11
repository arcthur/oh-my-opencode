import type { PruningState, ErroredToolCall } from "./pruning-types"
import { estimateTokens } from "./pruning-types"
import { log } from "../../shared/logger"
import { readMessages } from "./pruning-shared"

export interface PurgeErrorsConfig {
  enabled: boolean
  turns: number
  protectedTools?: string[]
}

export function executePurgeErrors(
  sessionID: string,
  state: PruningState,
  config: PurgeErrorsConfig,
  protectedTools: Set<string>
): number {
  if (!config.enabled) return 0

  const messages = readMessages(sessionID)
  
  let currentTurn = 0
  
  for (const msg of messages) {
    if (!msg.parts) continue
    
    for (const part of msg.parts) {
      if (part.type === "step-start") {
        currentTurn++
      }
    }
  }
  
  state.currentTurn = currentTurn
  
  let turnCounter = 0
  let prunedCount = 0
  let tokensSaved = 0
  
  for (const msg of messages) {
    if (!msg.parts) continue
    
    for (const part of msg.parts) {
      if (part.type === "step-start") {
        turnCounter++
        continue
      }
      
      if (part.type !== "tool" || !part.callID || !part.tool) continue
      
      if (protectedTools.has(part.tool)) continue
      
      if (config.protectedTools?.includes(part.tool)) continue
      
      if (state.toolIdsToPrune.has(part.callID)) continue
      
      if (part.state?.status !== "error") continue
      
      const turnAge = currentTurn - turnCounter
      
      if (turnAge >= config.turns) {
        state.toolIdsToPrune.add(part.callID)
        prunedCount++
        
        const input = part.state.input
        if (input) {
          tokensSaved += estimateTokens(JSON.stringify(input))
        }
        
        const errorInfo: ErroredToolCall = {
          callID: part.callID,
          toolName: part.tool,
          turn: turnCounter,
          errorAge: turnAge,
        }
        
        state.erroredTools.set(part.callID, errorInfo)
        
        log("[pruning-purge-errors] pruned old error", {
          tool: part.tool,
          callID: part.callID,
          turn: turnCounter,
          errorAge: turnAge,
          threshold: config.turns,
        })
      }
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
