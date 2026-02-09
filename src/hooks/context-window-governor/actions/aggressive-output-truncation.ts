import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { MESSAGE_STORAGE, PART_STORAGE } from "../../../features/hook-message-injector"
import { log } from "../../../shared/logger"
import type { RecoveryAggressiveOutputTruncationConfig, RecoveryRequest } from "../types"

const AGGRESSIVE_TRUNCATION_MESSAGE =
  "[TOOL RESULT TRUNCATED - Aggressive recovery trimming removed this output to bring context usage below recovery target. Re-run the tool if full output is still needed.]"

interface StoredMessageMeta {
  id?: string
  time?: {
    created?: number
  }
}

interface StoredToolPart {
  type?: string
  callID?: string
  tool?: string
  truncated?: boolean
  state?: {
    output?: string
    time?: {
      compacted?: number
      [key: string]: unknown
    }
    [key: string]: unknown
  }
  [key: string]: unknown
}

interface MessageEntry {
  messageID: string
  createdAt: number
}

interface ToolOutputCandidate {
  toolName: string
  outputChars: number
  messageIndex: number
  partPath: string
}

export interface AggressiveOutputTruncationResult {
  attempted: boolean
  truncatedCount: number
  totalCharsRemoved: number
  targetCharsToRemove: number
  sufficient: boolean
  truncatedTools: Array<{ toolName: string; removedChars: number }>
}

function getMessageDir(sessionID: string): string | null {
  if (!existsSync(MESSAGE_STORAGE)) {
    return null
  }

  const directPath = join(MESSAGE_STORAGE, sessionID)
  if (existsSync(directPath)) {
    return directPath
  }

  for (const dir of readdirSync(MESSAGE_STORAGE)) {
    const sessionPath = join(MESSAGE_STORAGE, dir, sessionID)
    if (existsSync(sessionPath)) {
      return sessionPath
    }
  }

  return null
}

function readMessageEntries(sessionID: string): MessageEntry[] {
  const messageDir = getMessageDir(sessionID)
  if (!messageDir) {
    return []
  }

  const entries: MessageEntry[] = []

  for (const file of readdirSync(messageDir)) {
    if (!file.endsWith(".json")) {
      continue
    }

    const filePath = join(messageDir, file)
    const messageID = file.replace(/\.json$/, "")

    try {
      const parsed = JSON.parse(readFileSync(filePath, "utf-8")) as StoredMessageMeta
      const createdAt = parsed.time?.created ?? 0
      const canonicalMessageID = parsed.id && parsed.id.length > 0 ? parsed.id : messageID
      entries.push({ messageID: canonicalMessageID, createdAt })
    } catch {
      entries.push({ messageID, createdAt: 0 })
    }
  }

  return entries.sort((a, b) => {
    if (a.createdAt !== b.createdAt) {
      return a.createdAt - b.createdAt
    }
    return a.messageID.localeCompare(b.messageID)
  })
}

function collectCandidates(
  entries: MessageEntry[],
  config: RecoveryAggressiveOutputTruncationConfig
): ToolOutputCandidate[] {
  const protectedTools = new Set(config.protectedTools)
  const candidates: ToolOutputCandidate[] = []
  const protectedStartIndex = Math.max(0, entries.length - Math.max(0, config.keepRecentTurns))

  for (let messageIndex = 0; messageIndex < entries.length; messageIndex += 1) {
    if (messageIndex >= protectedStartIndex) {
      continue
    }

    const messageID = entries[messageIndex]?.messageID
    if (!messageID) {
      continue
    }

    const partDir = join(PART_STORAGE, messageID)
    if (!existsSync(partDir)) {
      continue
    }

    for (const file of readdirSync(partDir)) {
      if (!file.endsWith(".json")) {
        continue
      }

      const partPath = join(partDir, file)
      try {
        const parsed = JSON.parse(readFileSync(partPath, "utf-8")) as StoredToolPart
        if (parsed.type !== "tool") {
          continue
        }

        if (parsed.truncated === true) {
          continue
        }

        const toolName = parsed.tool
        if (!toolName || protectedTools.has(toolName)) {
          continue
        }

        const output = parsed.state?.output
        if (typeof output !== "string" || output.length < config.minOutputChars) {
          continue
        }

        candidates.push({
          toolName,
          outputChars: output.length,
          messageIndex,
          partPath,
        })
      } catch {
        continue
      }
    }
  }

  return candidates
}

function truncatePart(partPath: string): { applied: boolean; removedChars: number; toolName?: string } {
  try {
    const parsed = JSON.parse(readFileSync(partPath, "utf-8")) as StoredToolPart

    if (parsed.type !== "tool" || parsed.truncated === true) {
      return { applied: false, removedChars: 0 }
    }

    const output = parsed.state?.output
    if (typeof output !== "string" || output.length === 0) {
      return { applied: false, removedChars: 0 }
    }

    parsed.truncated = true
    parsed.originalSize = output.length
    parsed.state = parsed.state ?? {}
    parsed.state.output = AGGRESSIVE_TRUNCATION_MESSAGE
    parsed.state.time = parsed.state.time ?? {}
    parsed.state.time.compacted = Date.now()

    writeFileSync(partPath, JSON.stringify(parsed, null, 2))
    return {
      applied: true,
      removedChars: output.length,
      toolName: parsed.tool,
    }
  } catch {
    return { applied: false, removedChars: 0 }
  }
}

export function runAggressiveOutputTruncation(
  sessionID: string,
  request: RecoveryRequest,
  config: RecoveryAggressiveOutputTruncationConfig
): AggressiveOutputTruncationResult {
  const currentTokens = request.currentTokens
  const maxTokens = request.maxTokens

  if (
    !config.enabled ||
    typeof currentTokens !== "number" ||
    typeof maxTokens !== "number" ||
    currentTokens <= 0 ||
    maxTokens <= 0
  ) {
    return {
      attempted: false,
      truncatedCount: 0,
      totalCharsRemoved: 0,
      targetCharsToRemove: 0,
      sufficient: false,
      truncatedTools: [],
    }
  }

  const targetTokens = Math.floor(maxTokens * config.targetRatio)
  const tokensToReduce = Math.max(0, currentTokens - targetTokens)
  const targetCharsToRemove = tokensToReduce * Math.max(1, config.charsPerToken)

  if (targetCharsToRemove <= 0) {
    return {
      attempted: false,
      truncatedCount: 0,
      totalCharsRemoved: 0,
      targetCharsToRemove: 0,
      sufficient: true,
      truncatedTools: [],
    }
  }

  const entries = readMessageEntries(sessionID)
  const candidates = collectCandidates(entries, config).sort(
    (a, b) => b.outputChars - a.outputChars
  )

  let truncatedCount = 0
  let totalCharsRemoved = 0
  const truncatedTools: Array<{ toolName: string; removedChars: number }> = []

  for (const candidate of candidates) {
    if (truncatedCount >= config.maxOutputs || totalCharsRemoved >= targetCharsToRemove) {
      break
    }

    const truncated = truncatePart(candidate.partPath)
    if (!truncated.applied) {
      continue
    }

    truncatedCount += 1
    totalCharsRemoved += truncated.removedChars
    truncatedTools.push({
      toolName: truncated.toolName ?? candidate.toolName,
      removedChars: truncated.removedChars,
    })
  }

  const sufficient = totalCharsRemoved >= targetCharsToRemove

  if (truncatedCount > 0) {
    log("[context-window-governor] aggressive output truncation applied", {
      sessionID,
      truncatedCount,
      totalCharsRemoved,
      targetCharsToRemove,
      sufficient,
    })
  }

  return {
    attempted: true,
    truncatedCount,
    totalCharsRemoved,
    targetCharsToRemove,
    sufficient,
    truncatedTools,
  }
}
