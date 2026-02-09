import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { MESSAGE_STORAGE, PART_STORAGE } from "../../../features/hook-message-injector"
import { log } from "../../../shared/logger"
import type { DynamicPruningConfig, RecoveryRequest } from "../types"

const TRUNCATION_MESSAGE =
  "[TOOL RESULT TRUNCATED - Dynamic context pruning removed this historical output to recover context headroom. Re-run the tool if full output is still needed.]"

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
    input?: unknown
    output?: string
    time?: {
      start?: number
      end?: number
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
  signature: string
  messageIndex: number
  outputChars: number
  partPath: string
}

export interface DynamicPruningResult {
  applied: boolean
  deduplicatedCount: number
  stalePrunedCount: number
  estimatedCharsSaved: number
  estimatedTokensSaved: number
}

interface PruningExecutionResult {
  count: number
  savedChars: number
  prunedPartPaths: Set<string>
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

function sortObject(value: unknown): unknown {
  if (value === null || value === undefined) {
    return value
  }

  if (Array.isArray(value)) {
    return value.map((item) => sortObject(item))
  }

  if (typeof value !== "object") {
    return value
  }

  const sorted: Record<string, unknown> = {}
  const source = value as Record<string, unknown>
  const keys = Object.keys(source).sort()
  for (const key of keys) {
    sorted[key] = sortObject(source[key])
  }
  return sorted
}

function createToolSignature(toolName: string, input: unknown): string {
  try {
    return `${toolName}::${JSON.stringify(sortObject(input))}`
  } catch {
    return `${toolName}::[unserializable-input]`
  }
}

function collectToolCandidates(
  messageEntries: MessageEntry[],
  protectedTools: Set<string>
): ToolOutputCandidate[] {
  const candidates: ToolOutputCandidate[] = []

  for (let index = 0; index < messageEntries.length; index += 1) {
    const messageID = messageEntries[index]?.messageID
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

        const callID = parsed.callID
        const toolName = parsed.tool
        const output = parsed.state?.output

        if (!callID || !toolName || typeof output !== "string" || output.length === 0) {
          continue
        }

        if (parsed.truncated === true) {
          continue
        }

        if (protectedTools.has(toolName)) {
          continue
        }

        candidates.push({
          toolName,
          signature: createToolSignature(toolName, parsed.state?.input),
          messageIndex: index,
          outputChars: output.length,
          partPath,
        })
      } catch {
        continue
      }
    }
  }

  return candidates
}

function isProtectedByRecentMessages(
  messageIndex: number,
  totalMessages: number,
  protectedMessageCount: number
): boolean {
  if (protectedMessageCount <= 0) {
    return false
  }

  const startIndex = Math.max(0, totalMessages - protectedMessageCount)
  return messageIndex >= startIndex
}

function truncatePartOutput(partPath: string): { applied: boolean; savedChars: number } {
  try {
    const parsed = JSON.parse(readFileSync(partPath, "utf-8")) as StoredToolPart
    const output = parsed.state?.output

    if (parsed.type !== "tool" || typeof output !== "string" || output.length === 0) {
      return { applied: false, savedChars: 0 }
    }

    if (parsed.truncated === true) {
      return { applied: false, savedChars: 0 }
    }

    parsed.truncated = true
    parsed.state = parsed.state ?? {}
    parsed.state.output = TRUNCATION_MESSAGE
    parsed.state.time = parsed.state.time ?? {}
    parsed.state.time.compacted = Date.now()
    parsed.originalSize = output.length

    writeFileSync(partPath, JSON.stringify(parsed, null, 2))
    return { applied: true, savedChars: output.length }
  } catch {
    return { applied: false, savedChars: 0 }
  }
}

function runDeduplication(
  candidates: ToolOutputCandidate[],
  totalMessages: number,
  config: DynamicPruningConfig
): PruningExecutionResult {
  if (!config.strategies.deduplication.enabled) {
    return { count: 0, savedChars: 0, prunedPartPaths: new Set() }
  }

  const grouped = new Map<string, ToolOutputCandidate[]>()
  for (const candidate of candidates) {
    const bucket = grouped.get(candidate.signature)
    if (bucket) {
      bucket.push(candidate)
    } else {
      grouped.set(candidate.signature, [candidate])
    }
  }

  let count = 0
  let savedChars = 0
  const prunedPartPaths = new Set<string>()

  const protectedMessages = config.turnProtection.enabled ? config.turnProtection.turns : 0

  for (const calls of grouped.values()) {
    if (calls.length <= 1) {
      continue
    }

    const sortedCalls = [...calls].sort((a, b) => {
      if (a.messageIndex !== b.messageIndex) {
        return a.messageIndex - b.messageIndex
      }
      return a.partPath.localeCompare(b.partPath)
    })

    const callsToPrune = sortedCalls.slice(0, -1)
    for (const candidate of callsToPrune) {
      if (
        isProtectedByRecentMessages(
          candidate.messageIndex,
          totalMessages,
          protectedMessages
        )
      ) {
        continue
      }

      const truncated = truncatePartOutput(candidate.partPath)
      if (!truncated.applied) {
        continue
      }

      prunedPartPaths.add(candidate.partPath)
      count += 1
      savedChars += truncated.savedChars
    }
  }

  return { count, savedChars, prunedPartPaths }
}

function runStaleOutputPruning(
  candidates: ToolOutputCandidate[],
  totalMessages: number,
  alreadyPruned: Set<string>,
  config: DynamicPruningConfig
): PruningExecutionResult {
  const strategy = config.strategies.staleToolOutputs
  if (!strategy.enabled) {
    return { count: 0, savedChars: 0, prunedPartPaths: new Set() }
  }

  const protectedMessagesByTurns = config.turnProtection.enabled ? config.turnProtection.turns : 0
  const protectedMessages = Math.max(protectedMessagesByTurns, strategy.keepRecentTurns)

  let count = 0
  let savedChars = 0
  const prunedPartPaths = new Set<string>()

  const sortedCandidates = [...candidates].sort((a, b) => {
    if (a.messageIndex !== b.messageIndex) {
      return a.messageIndex - b.messageIndex
    }
    return b.outputChars - a.outputChars
  })

  for (const candidate of sortedCandidates) {
    if (count >= strategy.maxOutputs) {
      break
    }

    if (alreadyPruned.has(candidate.partPath)) {
      continue
    }

    if (candidate.outputChars < strategy.minOutputChars) {
      continue
    }

    if (
      isProtectedByRecentMessages(
        candidate.messageIndex,
        totalMessages,
        protectedMessages
      )
    ) {
      continue
    }

    const truncated = truncatePartOutput(candidate.partPath)
    if (!truncated.applied) {
      continue
    }

    prunedPartPaths.add(candidate.partPath)
    count += 1
    savedChars += truncated.savedChars
  }

  return { count, savedChars, prunedPartPaths }
}

export function runDynamicContextPruning(
  sessionID: string,
  config: DynamicPruningConfig
): DynamicPruningResult {
  if (!config.enabled) {
    return {
      applied: false,
      deduplicatedCount: 0,
      stalePrunedCount: 0,
      estimatedCharsSaved: 0,
      estimatedTokensSaved: 0,
    }
  }

  const messageEntries = readMessageEntries(sessionID)
  if (messageEntries.length === 0) {
    return {
      applied: false,
      deduplicatedCount: 0,
      stalePrunedCount: 0,
      estimatedCharsSaved: 0,
      estimatedTokensSaved: 0,
    }
  }

  const protectedTools = new Set(config.protectedTools)
  const candidates = collectToolCandidates(messageEntries, protectedTools)

  const dedupResult = runDeduplication(candidates, messageEntries.length, config)
  const staleResult = runStaleOutputPruning(
    candidates,
    messageEntries.length,
    dedupResult.prunedPartPaths,
    config
  )

  const estimatedCharsSaved = dedupResult.savedChars + staleResult.savedChars
  const estimatedTokensSaved = Math.floor(
    estimatedCharsSaved / Math.max(1, config.charsPerToken)
  )
  const applied = dedupResult.count > 0 || staleResult.count > 0

  if (applied) {
    log("[context-window-governor] dynamic pruning applied", {
      sessionID,
      deduplicatedCount: dedupResult.count,
      stalePrunedCount: staleResult.count,
      estimatedCharsSaved,
      estimatedTokensSaved,
    })
  }

  return {
    applied,
    deduplicatedCount: dedupResult.count,
    stalePrunedCount: staleResult.count,
    estimatedCharsSaved,
    estimatedTokensSaved,
  }
}

export function shouldSkipRecoverySummarize(
  request: RecoveryRequest,
  config: DynamicPruningConfig,
  pruningResult: DynamicPruningResult
): boolean {
  if (!config.enabled || !config.skipSummarizeIfRecovered) {
    return false
  }

  if (!pruningResult.applied || pruningResult.estimatedTokensSaved <= 0) {
    return false
  }

  if (
    typeof request.currentTokens !== "number" ||
    typeof request.maxTokens !== "number" ||
    request.currentTokens <= 0 ||
    request.maxTokens <= 0
  ) {
    return false
  }

  const projectedTokens = Math.max(0, request.currentTokens - pruningResult.estimatedTokensSaved)
  const targetTokens = Math.floor(request.maxTokens * config.recoveryTargetRatio)

  return projectedTokens <= targetTokens
}
