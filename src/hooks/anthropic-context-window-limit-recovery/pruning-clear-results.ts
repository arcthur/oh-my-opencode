import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import type { PruningState } from "./pruning-types"
import { estimateTokens } from "./pruning-types"
import { log } from "../../shared/logger"
import { MESSAGE_STORAGE } from "../../features/hook-message-injector"

export interface ClearResultsConfig {
  enabled: boolean
  /** Number of recent turns to preserve (default: 5) */
  keep_recent_turns: number
}

interface ToolPart {
  type: string
  callID?: string
  tool?: string
  state?: {
    input?: unknown
    output?: string
    status?: string
  }
}

interface MessagePart {
  type: string
  parts?: ToolPart[]
}

interface TurnInfo {
  turn: number
  callID: string
  tool: string
  outputSize: number
}

function getMessageDir(sessionID: string): string | null {
  if (!existsSync(MESSAGE_STORAGE)) return null

  const directPath = join(MESSAGE_STORAGE, sessionID)
  if (existsSync(directPath)) return directPath

  for (const dir of readdirSync(MESSAGE_STORAGE)) {
    const sessionPath = join(MESSAGE_STORAGE, dir, sessionID)
    if (existsSync(sessionPath)) return sessionPath
  }

  return null
}

function readMessages(sessionID: string): MessagePart[] {
  const messageDir = getMessageDir(sessionID)
  if (!messageDir) return []

  const messages: MessagePart[] = []

  try {
    const files = readdirSync(messageDir).filter(f => f.endsWith(".json"))
    for (const file of files) {
      const content = readFileSync(join(messageDir, file), "utf-8")
      const data = JSON.parse(content)
      if (data.parts) {
        messages.push(data)
      }
    }
  } catch {
    return []
  }

  return messages
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
  protectedTools: Set<string>
): number {
  if (!config.enabled) return 0

  const messages = readMessages(sessionID)
  const keepRecentTurns = config.keep_recent_turns || 5

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
      if (protectedTools.has(part.tool)) continue

      // Skip already pruned
      if (state.toolIdsToPrune.has(part.callID)) continue

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

  let prunedCount = 0
  let tokensSaved = 0

  for (const info of toolInfos) {
    // Only prune tools from turns older than cutoff
    if (info.turn >= cutoffTurn) continue

    state.toolIdsToPrune.add(info.callID)
    prunedCount++
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
