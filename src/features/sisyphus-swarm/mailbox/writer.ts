import {
  existsSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  unlinkSync,
} from "fs"
import { join } from "path"
import { randomUUID } from "crypto"
import type { OhMyOpenCodeConfig } from "../../../config/schema"
import { getTeamDir, ensureDir, writeJsonAtomic } from "../../sisyphus-tasks/storage"
import type { EnvelopeAuth, ProtocolMessage } from "./types"
import type { InboxMessage } from "./reader"

/**
 * Get inbox directory path for an agent.
 */
export function getInboxDir(
  teamName: string,
  agentId: string,
  config: Partial<OhMyOpenCodeConfig>
): string {
  const teamDir = getTeamDir(teamName, config)
  return join(teamDir, "inboxes", agentId)
}

export function getInboxPendingDir(
  teamName: string,
  agentId: string,
  config: Partial<OhMyOpenCodeConfig>
): string {
  return join(getInboxDir(teamName, agentId, config), "pending")
}

export function getInboxProcessingDir(
  teamName: string,
  agentId: string,
  config: Partial<OhMyOpenCodeConfig>
): string {
  return join(getInboxDir(teamName, agentId, config), "processing")
}

export function getInboxDoneDir(
  teamName: string,
  agentId: string,
  config: Partial<OhMyOpenCodeConfig>
): string {
  return join(getInboxDir(teamName, agentId, config), "done")
}

function getInboxMetaPath(
  teamName: string,
  agentId: string,
  config: Partial<OhMyOpenCodeConfig>
): string {
  return join(getInboxDir(teamName, agentId, config), "_meta.json")
}

function getStateMessagePath(
  teamName: string,
  agentId: string,
  messageId: string,
  state: "pending" | "processing" | "done",
  config: Partial<OhMyOpenCodeConfig>
): string {
  const base = state === "pending"
    ? getInboxPendingDir(teamName, agentId, config)
    : state === "processing"
      ? getInboxProcessingDir(teamName, agentId, config)
      : getInboxDoneDir(teamName, agentId, config)
  return join(base, `${messageId}.json`)
}

function ensureQueueDirs(
  teamName: string,
  agentId: string,
  config: Partial<OhMyOpenCodeConfig>
): void {
  ensureDir(getInboxPendingDir(teamName, agentId, config))
  ensureDir(getInboxProcessingDir(teamName, agentId, config))
  ensureDir(getInboxDoneDir(teamName, agentId, config))
}

/**
 * Generate a unique message ID.
 */
export function generateMessageId(): string {
  return `msg_${randomUUID().slice(0, 12)}`
}

/**
 * Create an inbox directory for an agent.
 */
export function createInbox(
  teamName: string,
  agentId: string,
  config: Partial<OhMyOpenCodeConfig>
): void {
  const inboxDir = getInboxDir(teamName, agentId, config)
  ensureDir(inboxDir)
  ensureQueueDirs(teamName, agentId, config)

  const metaPath = getInboxMetaPath(teamName, agentId, config)
  if (!existsSync(metaPath)) {
    writeJsonAtomic(metaPath, {
      agentId,
      createdAt: Date.now(),
      lastRead: Date.now(),
    })
  }
}

/**
 * Ensure an inbox exists for an agent, creating if necessary.
 */
export function ensureInbox(
  teamName: string,
  agentId: string,
  config: Partial<OhMyOpenCodeConfig>
): void {
  const inboxDir = getInboxDir(teamName, agentId, config)
  if (!existsSync(inboxDir)) {
    createInbox(teamName, agentId, config)
    return
  }
  ensureQueueDirs(teamName, agentId, config)
}

/**
 * Send a message to a specific agent's pending queue.
 */
export function sendMessage(
  teamName: string,
  fromAgentId: string,
  toAgentId: string,
  message: ProtocolMessage,
  config: Partial<OhMyOpenCodeConfig>,
  options?: { epoch?: number; auth?: EnvelopeAuth }
): string {
  ensureInbox(teamName, toAgentId, config)

  const messageId = generateMessageId()
  const inboxMessage: InboxMessage = {
    id: messageId,
    from: fromAgentId,
    timestamp: Date.now(),
    read: false,
    epoch: options?.epoch,
    auth: options?.auth,
    payload: message,
  }

  writeJsonAtomic(getStateMessagePath(teamName, toAgentId, messageId, "pending", config), inboxMessage)
  return messageId
}

function getTeamAgentIds(
  teamName: string,
  config: Partial<OhMyOpenCodeConfig>
): string[] {
  const teamDir = getTeamDir(teamName, config)
  const inboxesDir = join(teamDir, "inboxes")

  if (!existsSync(inboxesDir)) {
    return []
  }

  return readdirSync(inboxesDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
}

/**
 * Broadcast a message to all team members (except sender by default).
 */
export function broadcast(
  teamName: string,
  fromAgentId: string,
  message: ProtocolMessage,
  config: Partial<OhMyOpenCodeConfig>,
  options?: { includeSelf?: boolean; epoch?: number; auth?: EnvelopeAuth }
): string[] {
  const agentIds = getTeamAgentIds(teamName, config)
  const messageIds: string[] = []

  for (const agentId of agentIds) {
    if (agentId === fromAgentId && !options?.includeSelf) {
      continue
    }

    const id = sendMessage(teamName, fromAgentId, agentId, message, config, {
      epoch: options?.epoch,
      auth: options?.auth,
    })
    messageIds.push(id)
  }

  return messageIds
}

function updateLastReadMeta(
  teamName: string,
  agentId: string,
  config: Partial<OhMyOpenCodeConfig>
): void {
  const metaPath = getInboxMetaPath(teamName, agentId, config)
  if (!existsSync(metaPath)) {
    return
  }

  try {
    const content = readFileSync(metaPath, "utf-8")
    const meta = JSON.parse(content) as Record<string, unknown>
    meta.lastRead = Date.now()
    writeJsonAtomic(metaPath, meta)
  } catch {
    // Ignore meta update errors.
  }
}

function readInboxMessage(filePath: string): InboxMessage | null {
  try {
    const content = readFileSync(filePath, "utf-8")
    return JSON.parse(content) as InboxMessage
  } catch {
    return null
  }
}

function writeDoneMessage(
  teamName: string,
  agentId: string,
  messageId: string,
  message: InboxMessage,
  config: Partial<OhMyOpenCodeConfig>
): void {
  const donePath = getStateMessagePath(teamName, agentId, messageId, "done", config)
  writeJsonAtomic(donePath, { ...message, read: true })
}

/**
 * Claim pending messages by atomically renaming pending -> processing.
 */
export function claimPendingMessages(
  teamName: string,
  agentId: string,
  config: Partial<OhMyOpenCodeConfig>,
  options?: { limit?: number }
): InboxMessage[] {
  ensureInbox(teamName, agentId, config)
  const pendingDir = getInboxPendingDir(teamName, agentId, config)
  const files = readdirSync(pendingDir)
    .filter((name) => name.endsWith(".json"))
    .sort()

  const limit = options?.limit ?? Number.POSITIVE_INFINITY
  const claimed: InboxMessage[] = []

  for (const file of files) {
    if (claimed.length >= limit) {
      break
    }

    const pendingPath = join(pendingDir, file)
    const processingPath = join(getInboxProcessingDir(teamName, agentId, config), file)
    const messageId = file.replace(/\.json$/, "")

    try {
      renameSync(pendingPath, processingPath)
    } catch {
      continue
    }

    const message = readInboxMessage(processingPath)
    if (!message) {
      try {
        unlinkSync(processingPath)
      } catch {
        // Ignore cleanup errors.
      }
      continue
    }

    claimed.push({ ...message, id: message.id || messageId })
  }

  return claimed
}

/**
 * Acknowledge a claimed message (processing -> done or delete).
 */
export function ackProcessedMessage(
  teamName: string,
  agentId: string,
  messageId: string,
  config: Partial<OhMyOpenCodeConfig>,
  options?: { keepDone?: boolean }
): boolean {
  const processingPath = getStateMessagePath(teamName, agentId, messageId, "processing", config)
  const pendingPath = getStateMessagePath(teamName, agentId, messageId, "pending", config)

  if (existsSync(processingPath)) {
    const message = readInboxMessage(processingPath)
    if (options?.keepDone && message) {
      writeDoneMessage(teamName, agentId, messageId, message, config)
    }
    try {
      unlinkSync(processingPath)
    } catch {
      return false
    }
    updateLastReadMeta(teamName, agentId, config)
    return true
  }

  if (existsSync(pendingPath)) {
    try {
      const message = readInboxMessage(pendingPath)
      if (options?.keepDone && message) {
        writeDoneMessage(teamName, agentId, messageId, message, config)
      }
      unlinkSync(pendingPath)
      updateLastReadMeta(teamName, agentId, config)
      return true
    } catch {
      return false
    }
  }

  return false
}

/**
 * Requeue a claimed message (processing -> pending).
 */
export function requeueClaimedMessage(
  teamName: string,
  agentId: string,
  messageId: string,
  config: Partial<OhMyOpenCodeConfig>
): boolean {
  const processingPath = getStateMessagePath(teamName, agentId, messageId, "processing", config)
  const pendingPath = getStateMessagePath(teamName, agentId, messageId, "pending", config)
  if (!existsSync(processingPath)) {
    return false
  }

  try {
    renameSync(processingPath, pendingPath)
    return true
  } catch {
    return false
  }
}

/**
 * Requeue processing messages that exceeded processing timeout.
 */
export function requeueExpiredProcessing(
  teamName: string,
  agentId: string,
  config: Partial<OhMyOpenCodeConfig>,
  options?: { maxAgeMs?: number }
): number {
  const maxAgeMs = options?.maxAgeMs ?? 30_000
  const processingDir = getInboxProcessingDir(teamName, agentId, config)
  if (!existsSync(processingDir)) {
    return 0
  }

  let requeued = 0
  const now = Date.now()
  const files = readdirSync(processingDir).filter((name) => name.endsWith(".json"))
  for (const file of files) {
    const processingPath = join(processingDir, file)
    try {
      const stats = statSync(processingPath)
      if (now - stats.mtimeMs <= maxAgeMs) {
        continue
      }
      const pendingPath = join(getInboxPendingDir(teamName, agentId, config), file)
      renameSync(processingPath, pendingPath)
      requeued++
    } catch {
      // Ignore per-file failures.
    }
  }

  return requeued
}

/**
 * Delete specific messages from an agent's inbox.
 */
export function deleteMessages(
  teamName: string,
  agentId: string,
  messageIds: string[],
  config: Partial<OhMyOpenCodeConfig>
): void {
  for (const messageId of messageIds) {
    const candidates = [
      getStateMessagePath(teamName, agentId, messageId, "pending", config),
      getStateMessagePath(teamName, agentId, messageId, "processing", config),
      getStateMessagePath(teamName, agentId, messageId, "done", config),
    ]

    for (const path of candidates) {
      if (!existsSync(path)) continue
      try {
        unlinkSync(path)
      } catch {
        // Ignore delete errors.
      }
    }
  }
}

/**
 * Clear all messages from an agent's inbox.
 */
export function clearInbox(
  teamName: string,
  agentId: string,
  config: Partial<OhMyOpenCodeConfig>
): void {
  const inboxDir = getInboxDir(teamName, agentId, config)
  if (!existsSync(inboxDir)) {
    return
  }

  const dirs = [
    getInboxPendingDir(teamName, agentId, config),
    getInboxProcessingDir(teamName, agentId, config),
    getInboxDoneDir(teamName, agentId, config),
  ]

  for (const dir of dirs) {
    if (!existsSync(dir)) continue
    const files = readdirSync(dir).filter((f) => f.endsWith(".json"))
    for (const file of files) {
      try {
        unlinkSync(join(dir, file))
      } catch {
        // Ignore delete errors.
      }
    }
  }
}

/**
 * Prune old done messages.
 */
export function pruneOldMessages(
  teamName: string,
  agentId: string,
  config: Partial<OhMyOpenCodeConfig>,
  options?: { maxAge?: number; maxCount?: number }
): number {
  const inboxDir = getInboxDir(teamName, agentId, config)
  if (!existsSync(inboxDir)) {
    return 0
  }

  const maxAge = options?.maxAge ?? 24 * 60 * 60 * 1000
  const now = Date.now()
  let pruned = 0

  const doneDir = getInboxDoneDir(teamName, agentId, config)
  if (existsSync(doneDir)) {
    const doneFiles = readdirSync(doneDir).filter((f) => f.endsWith(".json"))
    for (const file of doneFiles) {
      const messagePath = join(doneDir, file)
      try {
        const message = readInboxMessage(messagePath)
        if (!message) continue
        if (now - message.timestamp > maxAge) {
          unlinkSync(messagePath)
          pruned++
        }
      } catch {
        // Ignore per-file errors.
      }
    }
  }

  return pruned
}
