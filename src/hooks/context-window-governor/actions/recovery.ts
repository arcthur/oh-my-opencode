import type { ParsedTokenLimitError, RecoveryRequest } from "../types"
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { MESSAGE_STORAGE, PART_STORAGE } from "../../../features/hook-message-injector"

interface RecoveryDeps {
  client: {
    session: {
      summarize: (opts: {
        path: { id: string }
        body: { providerID: string; modelID: string; auto: boolean }
        query: { directory: string }
      }) => Promise<unknown>
    }
    tui: {
      showToast: (opts: {
        body: {
          title: string
          message: string
          variant: "warning" | "error" | "success"
          duration: number
        }
      }) => Promise<unknown>
    }
  }
  directory: string
}

interface AssistantIdentity {
  providerID?: string
  modelID?: string
}

interface RecoveryToastOptions {
  toast?: boolean
}

const TOKEN_LIMIT_PATTERNS = [
  /(\d+)\s*tokens?\s*>\s*(\d+)\s*maximum/i,
  /prompt.*?(\d+).*?tokens.*?exceeds.*?(\d+)/i,
  /(\d+).*?tokens.*?limit.*?(\d+)/i,
  /context.*?length.*?(\d+).*?maximum.*?(\d+)/i,
  /max.*?context.*?(\d+).*?but.*?(\d+)/i,
]

const TOKEN_LIMIT_KEYWORDS = [
  "prompt is too long",
  "is too long",
  "context_length_exceeded",
  "max_tokens",
  "token limit",
  "context length",
  "too many tokens",
  "non-empty content",
]

const THINKING_BLOCK_ERROR_PATTERNS = [
  /thinking.*first block/i,
  /first block.*thinking/i,
  /must.*start.*thinking/i,
  /thinking.*redacted_thinking/i,
  /expected.*thinking.*found/i,
  /thinking.*disabled.*cannot.*contain/i,
]

const PLACEHOLDER_TEXT = "[user interrupted]"
const MESSAGE_INDEX_PATTERN = /messages\.(\d+)/i
const THINKING_PART_TYPES = new Set(["thinking", "redacted_thinking", "reasoning"])
const CONTENT_PART_TYPES = new Set(["tool", "tool_use", "tool_result"])

interface StoredMessageMeta {
  id?: string
  time?: {
    created?: number
  }
}

interface StoredPart {
  type?: string
  text?: string
  synthetic?: boolean
  [key: string]: unknown
}

interface MessageState {
  messageID: string
  hasContent: boolean
  hasEmptyTextPart: boolean
  hasThinking: boolean
}

function extractTokens(text: string): { currentTokens: number; maxTokens: number } | null {
  for (const pattern of TOKEN_LIMIT_PATTERNS) {
    const matched = text.match(pattern)
    if (!matched) {
      continue
    }

    const a = parseInt(matched[1], 10)
    const b = parseInt(matched[2], 10)
    if (a > b) {
      return { currentTokens: a, maxTokens: b }
    }
    return { currentTokens: b, maxTokens: a }
  }

  return null
}

function isThinkingBlockError(text: string): boolean {
  return THINKING_BLOCK_ERROR_PATTERNS.some((pattern) => pattern.test(text))
}

function isTokenLimitCandidate(text: string): boolean {
  if (isThinkingBlockError(text)) {
    return false
  }

  const lower = text.toLowerCase()
  if (TOKEN_LIMIT_KEYWORDS.some((keyword) => lower.includes(keyword))) {
    return true
  }

  return TOKEN_LIMIT_PATTERNS.some((pattern) => pattern.test(text))
}

function collectErrorTexts(error: unknown): string[] {
  if (typeof error === "string") {
    return [error]
  }

  if (!error || typeof error !== "object") {
    return []
  }

  const texts: string[] = []
  const pushIfString = (value: unknown): void => {
    if (typeof value === "string" && value.length > 0) {
      texts.push(value)
    }
  }

  if (error instanceof Error) {
    pushIfString(error.message)
  }

  const errObj = error as Record<string, unknown>
  const dataObj = errObj.data as Record<string, unknown> | undefined
  const errorObj = errObj.error as Record<string, unknown> | undefined
  const nestedErrorObj = errorObj?.error as Record<string, unknown> | undefined

  pushIfString(errObj.message)
  pushIfString(errObj.body)
  pushIfString(errObj.details)
  pushIfString(errObj.reason)
  pushIfString(errObj.description)

  pushIfString(dataObj?.responseBody)
  pushIfString(dataObj?.message)
  pushIfString(dataObj?.error)

  pushIfString(errorObj?.message)
  pushIfString(nestedErrorObj?.message)

  if (texts.length === 0) {
    try {
      const serialized = JSON.stringify(errObj)
      pushIfString(serialized)
    } catch {
      return texts
    }
  }

  return texts
}

function extractMessageIndexFromText(text: string): number | undefined {
  const matched = text.match(MESSAGE_INDEX_PATTERN)
  if (!matched) {
    return undefined
  }

  const parsed = parseInt(matched[1], 10)
  return Number.isNaN(parsed) ? undefined : parsed
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

function readOrderedMessageIDs(sessionID: string): string[] {
  const messageDir = getMessageDir(sessionID)
  if (!messageDir) {
    return []
  }

  const entries: Array<{ messageID: string; createdAt: number }> = []
  for (const file of readdirSync(messageDir)) {
    if (!file.endsWith(".json")) {
      continue
    }

    const fallbackID = file.replace(/\.json$/, "")
    const filePath = join(messageDir, file)

    try {
      const parsed = JSON.parse(readFileSync(filePath, "utf-8")) as StoredMessageMeta
      entries.push({
        messageID: parsed.id && parsed.id.length > 0 ? parsed.id : fallbackID,
        createdAt: parsed.time?.created ?? 0,
      })
    } catch {
      entries.push({
        messageID: fallbackID,
        createdAt: 0,
      })
    }
  }

  return entries
    .sort((a, b) => {
      if (a.createdAt !== b.createdAt) {
        return a.createdAt - b.createdAt
      }
      return a.messageID.localeCompare(b.messageID)
    })
    .map((entry) => entry.messageID)
}

function readPartPaths(messageID: string): string[] {
  const partDir = join(PART_STORAGE, messageID)
  if (!existsSync(partDir)) {
    return []
  }

  return readdirSync(partDir)
    .filter((file) => file.endsWith(".json"))
    .map((file) => join(partDir, file))
}

function readPart(partPath: string): StoredPart | null {
  try {
    return JSON.parse(readFileSync(partPath, "utf-8")) as StoredPart
  } catch {
    return null
  }
}

function partHasContent(part: StoredPart): boolean {
  if (!part.type) {
    return false
  }

  if (part.type === "text") {
    return typeof part.text === "string" && part.text.trim().length > 0
  }

  return CONTENT_PART_TYPES.has(part.type)
}

function collectMessageStates(sessionID: string): MessageState[] {
  const messageIDs = readOrderedMessageIDs(sessionID)
  const states: MessageState[] = []

  for (const messageID of messageIDs) {
    const partPaths = readPartPaths(messageID)
    if (partPaths.length === 0) {
      states.push({
        messageID,
        hasContent: false,
        hasEmptyTextPart: false,
        hasThinking: false,
      })
      continue
    }

    let hasContent = false
    let hasEmptyTextPart = false
    let hasThinking = false

    for (const partPath of partPaths) {
      const part = readPart(partPath)
      if (!part) {
        continue
      }

      if (partHasContent(part)) {
        hasContent = true
      }

      if (part.type === "text" && (!part.text || part.text.trim().length === 0)) {
        hasEmptyTextPart = true
      }

      if (part.type && THINKING_PART_TYPES.has(part.type)) {
        hasThinking = true
      }
    }

    states.push({
      messageID,
      hasContent,
      hasEmptyTextPart,
      hasThinking,
    })
  }

  return states
}

function replaceEmptyTextParts(messageID: string): boolean {
  const partPaths = readPartPaths(messageID)
  if (partPaths.length === 0) {
    return false
  }

  let replaced = false
  for (const partPath of partPaths) {
    const part = readPart(partPath)
    if (!part || part.type !== "text") {
      continue
    }

    if (part.text && part.text.trim().length > 0) {
      continue
    }

    const nextPart = {
      ...part,
      text: PLACEHOLDER_TEXT,
      synthetic: true,
    }

    try {
      writeFileSync(partPath, JSON.stringify(nextPart, null, 2))
      replaced = true
    } catch {
      continue
    }
  }

  return replaced
}

function injectTextPart(sessionID: string, messageID: string): boolean {
  try {
    const partDir = join(PART_STORAGE, messageID)
    if (!existsSync(partDir)) {
      mkdirSync(partDir, { recursive: true })
    }

    const partID = `prt_${Date.now().toString(16)}${Math.random().toString(36).slice(2, 8)}`
    const partPath = join(partDir, `${partID}.json`)
    writeFileSync(
      partPath,
      JSON.stringify(
        {
          id: partID,
          sessionID,
          messageID,
          type: "text",
          text: PLACEHOLDER_TEXT,
          synthetic: true,
        },
        null,
        2
      )
    )
    return true
  } catch {
    return false
  }
}

function findEmptyMessageByIndex(sessionID: string, targetIndex: number): string | undefined {
  const states = collectMessageStates(sessionID)
  const indicesToTry = [
    targetIndex,
    targetIndex - 1,
    targetIndex + 1,
    targetIndex - 2,
    targetIndex + 2,
    targetIndex - 3,
    targetIndex - 4,
    targetIndex - 5,
  ]

  for (const index of indicesToTry) {
    if (index < 0 || index >= states.length) {
      continue
    }

    const state = states[index]
    if (state && !state.hasContent) {
      return state.messageID
    }
  }

  return undefined
}

function extractNonEmptyContentMessageIndex(error: unknown): number | undefined {
  const texts = collectErrorTexts(error)
  for (const text of texts) {
    if (!text.toLowerCase().includes("non-empty content")) {
      continue
    }

    const index = extractMessageIndexFromText(text)
    if (typeof index === "number") {
      return index
    }
  }
  return undefined
}

function isNonEmptyContentError(error: unknown): boolean {
  const texts = collectErrorTexts(error)
  return texts.some((text) => text.toLowerCase().includes("non-empty content"))
}

function repairMessageWithPlaceholder(sessionID: string, messageID: string): boolean {
  if (replaceEmptyTextParts(messageID)) {
    return true
  }
  return injectTextPart(sessionID, messageID)
}

function repairNonEmptyContentMessages(sessionID: string, error: unknown): boolean {
  let repaired = false
  const repairedMessageIDs = new Set<string>()

  const targetIndex = extractNonEmptyContentMessageIndex(error)
  if (typeof targetIndex === "number") {
    const targetMessageID = findEmptyMessageByIndex(sessionID, targetIndex)
    if (targetMessageID && repairMessageWithPlaceholder(sessionID, targetMessageID)) {
      repaired = true
      repairedMessageIDs.add(targetMessageID)
    }
  }

  const states = collectMessageStates(sessionID)

  for (const state of states) {
    if (!state.hasEmptyTextPart) {
      continue
    }
    if (repairMessageWithPlaceholder(sessionID, state.messageID)) {
      repaired = true
      repairedMessageIDs.add(state.messageID)
    }
  }

  for (const state of states) {
    if (!(state.hasThinking && !state.hasContent)) {
      continue
    }
    if (injectTextPart(sessionID, state.messageID)) {
      repaired = true
      repairedMessageIDs.add(state.messageID)
    }
  }

  for (const state of states) {
    if (state.hasContent) {
      continue
    }
    if (repairedMessageIDs.has(state.messageID)) {
      continue
    }
    if (repairMessageWithPlaceholder(sessionID, state.messageID)) {
      repaired = true
      repairedMessageIDs.add(state.messageID)
    }
  }

  return repaired
}

export function parseTokenLimitError(error: unknown): ParsedTokenLimitError | null {
  const texts = collectErrorTexts(error)
  if (texts.length === 0) {
    return null
  }

  let sawTokenLimitSignal = false
  for (const text of texts) {
    if (!isTokenLimitCandidate(text)) {
      continue
    }

    sawTokenLimitSignal = true

    const tokens = extractTokens(text)
    if (tokens) {
      return tokens
    }
  }

  if (!sawTokenLimitSignal) {
    return null
  }

  return {
    currentTokens: 0,
    maxTokens: 0,
  }
}

export async function runRecoveryCompaction(
  deps: RecoveryDeps,
  request: RecoveryRequest,
  identity: AssistantIdentity,
  options?: RecoveryToastOptions
): Promise<boolean> {
  const providerID = request.providerID ?? identity.providerID
  const modelID = request.modelID ?? identity.modelID
  const toastEnabled = options?.toast ?? true

  if (!providerID || !modelID) {
    if (toastEnabled) {
      await deps.client.tui
        .showToast({
          body: {
            title: "Recovery Skipped",
            message: "Missing provider or model metadata for recovery summarize.",
            variant: "warning",
            duration: 3000,
          },
        })
        .catch(() => undefined)
    }
    return false
  }

  if (toastEnabled) {
    await deps.client.tui
      .showToast({
        body: {
          title: "Context Limit Hit",
          message: "Recovering session with automatic summarize...",
          variant: "warning",
          duration: 3000,
        },
      })
      .catch(() => undefined)
  }

  const summarizeOnce = async (): Promise<void> => {
    await deps.client.session.summarize({
      path: { id: request.sessionID },
      body: {
        providerID,
        modelID,
        auto: true,
      },
      query: { directory: deps.directory },
    })
  }

  try {
    await summarizeOnce()
  } catch (error) {
    if (!isNonEmptyContentError(error)) {
      throw error
    }

    const repaired = repairNonEmptyContentMessages(request.sessionID, error)
    if (!repaired) {
      throw error
    }

    await summarizeOnce()
  }

  return true
}
