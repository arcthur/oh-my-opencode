import type { PruningState, FileOperation } from "./pruning-types"
import { estimateTokens } from "./pruning-types"
import { log } from "../../shared/logger"
import { readMessages, findToolInput } from "./pruning-shared"

export interface SupersedeWritesConfig {
  enabled: boolean
  aggressive: boolean
}

function extractFilePath(toolName: string, input: unknown): string | null {
  if (!input || typeof input !== "object") return null
  
  const inputObj = input as Record<string, unknown>
  
  if (toolName === "write" || toolName === "edit" || toolName === "read") {
    if (typeof inputObj.filePath === "string") {
      return inputObj.filePath
    }
  }
  
  return null
}

export function executeSupersedeWrites(
  sessionID: string,
  state: PruningState,
  config: SupersedeWritesConfig,
  protectedTools: Set<string>
): number {
  if (!config.enabled) return 0

  const messages = readMessages(sessionID)
  const writesByFile = new Map<string, FileOperation[]>()
  const readsByFile = new Map<string, number[]>()
  
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
      
      if (state.toolIdsToPrune.has(part.callID)) continue
      
      const filePath = extractFilePath(part.tool, part.state?.input)
      if (!filePath) continue
      
      if (part.tool === "write" || part.tool === "edit") {
        if (!writesByFile.has(filePath)) {
          writesByFile.set(filePath, [])
        }
        writesByFile.get(filePath)!.push({
          callID: part.callID,
          tool: part.tool,
          filePath,
          turn: currentTurn,
        })
        
        if (!state.fileOperations.has(filePath)) {
          state.fileOperations.set(filePath, [])
        }
        state.fileOperations.get(filePath)!.push({
          callID: part.callID,
          tool: part.tool,
          filePath,
          turn: currentTurn,
        })
      } else if (part.tool === "read") {
        if (!readsByFile.has(filePath)) {
          readsByFile.set(filePath, [])
        }
        readsByFile.get(filePath)!.push(currentTurn)
      }
    }
  }
  
  let prunedCount = 0
  let tokensSaved = 0
  
  for (const [filePath, writes] of writesByFile) {
    const reads = readsByFile.get(filePath) || []
    
    if (config.aggressive) {
      for (const write of writes) {
        const superseded = reads.some(readTurn => readTurn > write.turn)
        if (superseded) {
          state.toolIdsToPrune.add(write.callID)
          prunedCount++
          
          const input = findToolInput(messages, write.callID)
          if (input) {
            tokensSaved += estimateTokens(JSON.stringify(input))
          }
          
          log("[pruning-supersede] pruned superseded write", {
            tool: write.tool,
            callID: write.callID,
            turn: write.turn,
            filePath,
          })
        }
      }
    } else {
      if (writes.length > 1) {
        for (const write of writes.slice(0, -1)) {
          const superseded = reads.some(readTurn => readTurn > write.turn)
          if (superseded) {
            state.toolIdsToPrune.add(write.callID)
            prunedCount++
            
            const input = findToolInput(messages, write.callID)
            if (input) {
              tokensSaved += estimateTokens(JSON.stringify(input))
            }
            
            log("[pruning-supersede] pruned superseded write (conservative)", {
              tool: write.tool,
              callID: write.callID,
              turn: write.turn,
              filePath,
            })
          }
        }
      }
    }
  }
  
  log("[pruning-supersede] complete", {
    prunedCount,
    tokensSaved,
    filesTracked: writesByFile.size,
    mode: config.aggressive ? "aggressive" : "conservative",
  })
  
  return prunedCount
}
