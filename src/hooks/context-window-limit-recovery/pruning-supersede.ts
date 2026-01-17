import type { PruningState, FileOperation } from "./pruning-types"
import { estimateTokens } from "./pruning-types"
import { markToolForPruning } from "./pruning-types"
import { log } from "../../shared/logger"
import { readMessages, findToolInput } from "./pruning-shared"

export interface SupersedeWritesConfig {
  enabled: boolean
  aggressive: boolean
}

function extractFilePath(toolName: string, input: unknown): string | null {
  if (!input || typeof input !== "object") return null
  
  const inputObj = input as Record<string, unknown>
  
  const normalizedTool = toolName.toLowerCase()
  if (normalizedTool !== "write" && normalizedTool !== "edit" && normalizedTool !== "read") {
    return null
  }

  const candidates = ["filePath", "file_path", "path", "file"]
  for (const key of candidates) {
    if (typeof inputObj[key] === "string") {
      return inputObj[key] as string
    }
  }
  
  return null
}

export function executeSupersedeWrites(
  sessionID: string,
  state: PruningState,
  config: SupersedeWritesConfig,
  protectedTools: Set<string>,
  turnProtectionTurns: number = 0
): number {
  if (!config.enabled) return 0

  const messages = readMessages(sessionID)
  const writes: FileOperation[] = []
  const readsByFile = new Map<string, number[]>()
  const anyReadTurns: number[] = []
  
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
      if (protectedTools.has(part.tool) || protectedTools.has(toolName)) continue
      
      if (state.toolPruneActions.get(part.callID)?.pruneInput === true) {
        // Supersede-writes only targets inputs; if input already pruned, skip.
        continue
      }
      
      const filePath = extractFilePath(toolName, part.state?.input)
      if (!filePath) continue
      
      if (toolName === "write" || toolName === "edit") {
        writes.push({
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
      } else if (toolName === "read") {
        anyReadTurns.push(currentTurn)
        if (!readsByFile.has(filePath)) {
          readsByFile.set(filePath, [])
        }
        readsByFile.get(filePath)!.push(currentTurn)
      }
    }
  }

  state.currentTurn = currentTurn

  const minPrunableTurn = Math.max(0, currentTurn - Math.max(0, turnProtectionTurns))

  let prunedCount = 0
  let tokensSaved = 0
  
  for (const write of writes) {
    if (write.turn > minPrunableTurn) continue

    const superseded = config.aggressive
      ? anyReadTurns.some((readTurn) => readTurn > write.turn)
      : (readsByFile.get(write.filePath) ?? []).some((readTurn) => readTurn > write.turn)

    if (!superseded) continue

    const alreadyInputPruned = state.toolPruneActions.get(write.callID)?.pruneInput === true
    markToolForPruning(state, write.callID, {
      pruneInput: true,
      reason: "supersede_writes",
    })
    if (!alreadyInputPruned) prunedCount++

    const input = findToolInput(messages, write.callID)
    if (input) {
      tokensSaved += estimateTokens(JSON.stringify(input))
    }
    
    log("[pruning-supersede] pruned superseded write", {
      tool: write.tool,
      callID: write.callID,
      turn: write.turn,
      filePath: write.filePath,
      mode: config.aggressive ? "aggressive" : "conservative",
    })
  }
  
  log("[pruning-supersede] complete", {
    prunedCount,
    tokensSaved,
    filesTracked: readsByFile.size,
    mode: config.aggressive ? "aggressive" : "conservative",
  })
  
  return prunedCount
}
