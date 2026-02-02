import { existsSync, readdirSync, unlinkSync, writeFileSync } from "fs"
import { dirname, join } from "path"
import { randomUUID } from "crypto"
import type { OhMyOpenCodeConfig } from "../../../config/schema"
import { getTeamDir, ensureDir, writeJsonAtomic } from "../../sisyphus-tasks/storage"
import type { ProtocolMessage } from "./types"
import type { InboxMessage } from "./reader"

/**
 * Get inbox directory path for an agent
 * Now uses per-message files instead of single inbox file
 */
export function getInboxDir(
  teamName: string,
  agentId: string,
  config: Partial<OhMyOpenCodeConfig>
): string {
  const teamDir = getTeamDir(teamName, config)
  return join(teamDir, "inboxes", agentId)
}

/**
 * Get inbox meta file path (for lastRead tracking)
 */
function getInboxMetaPath(
  teamName: string,
  agentId: string,
  config: Partial<OhMyOpenCodeConfig>
): string {
  return join(getInboxDir(teamName, agentId, config), "_meta.json")
}

/**
 * Get message file path
 */
function getMessagePath(
  teamName: string,
  agentId: string,
  messageId: string,
  config: Partial<OhMyOpenCodeConfig>
): string {
  return join(getInboxDir(teamName, agentId, config), `${messageId}.json`)
}

/**
 * Generate a unique message ID
 */
export function generateMessageId(): string {
  return `msg_${randomUUID().slice(0, 12)}`
}

/**
 * Create an inbox directory for an agent
 */
export function createInbox(
  teamName: string,
  agentId: string,
  config: Partial<OhMyOpenCodeConfig>
): void {
  const inboxDir = getInboxDir(teamName, agentId, config)
  ensureDir(inboxDir)

  // Create meta file
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
 * Ensure an inbox exists for an agent, creating if necessary
 */
export function ensureInbox(
  teamName: string,
  agentId: string,
  config: Partial<OhMyOpenCodeConfig>
): void {
  const inboxDir = getInboxDir(teamName, agentId, config)
  if (!existsSync(inboxDir)) {
    createInbox(teamName, agentId, config)
  }
}

/**
 * Send a message to a specific agent's inbox
 *
 * This is now a simple file creation - no read-modify-write cycle.
 * Safe for concurrent senders.
 */
export function sendMessage(
  teamName: string,
  fromAgentId: string,
  toAgentId: string,
  message: ProtocolMessage,
  config: Partial<OhMyOpenCodeConfig>
): string {
  ensureInbox(teamName, toAgentId, config)

  const messageId = generateMessageId()
  const inboxMessage: InboxMessage = {
    id: messageId,
    from: fromAgentId,
    timestamp: Date.now(),
    read: false,
    payload: message,
  }

  const messagePath = getMessagePath(teamName, toAgentId, messageId, config)
  writeJsonAtomic(messagePath, inboxMessage)

  return messageId
}

/**
 * Get all agent inbox directories in a team
 */
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
 * Broadcast a message to all team members (except sender)
 */
export function broadcast(
  teamName: string,
  fromAgentId: string,
  message: ProtocolMessage,
  config: Partial<OhMyOpenCodeConfig>,
  options?: { includeSelf?: boolean }
): string[] {
  const agentIds = getTeamAgentIds(teamName, config)
  const messageIds: string[] = []

  for (const agentId of agentIds) {
    if (agentId === fromAgentId && !options?.includeSelf) {
      continue
    }

    const id = sendMessage(teamName, fromAgentId, agentId, message, config)
    messageIds.push(id)
  }

  return messageIds
}

/**
 * Mark specific messages as read in an agent's inbox
 */
export function markAsRead(
  teamName: string,
  agentId: string,
  messageIds: string[],
  config: Partial<OhMyOpenCodeConfig>
): void {
  const inboxDir = getInboxDir(teamName, agentId, config)
  if (!existsSync(inboxDir)) {
    return
  }

  for (const messageId of messageIds) {
    const messagePath = getMessagePath(teamName, agentId, messageId, config)
    if (!existsSync(messagePath)) {
      continue
    }

    try {
      const content = require("fs").readFileSync(messagePath, "utf-8")
      const message: InboxMessage = JSON.parse(content)
      if (!message.read) {
        message.read = true
        writeJsonAtomic(messagePath, message)
      }
    } catch {
      // Ignore errors for individual messages
    }
  }

  // Update meta lastRead
  const metaPath = getInboxMetaPath(teamName, agentId, config)
  if (existsSync(metaPath)) {
    try {
      const content = require("fs").readFileSync(metaPath, "utf-8")
      const meta = JSON.parse(content)
      meta.lastRead = Date.now()
      writeJsonAtomic(metaPath, meta)
    } catch {
      // Ignore meta update errors
    }
  }
}

/**
 * Mark all messages as read in an agent's inbox
 */
export function markAllAsRead(
  teamName: string,
  agentId: string,
  config: Partial<OhMyOpenCodeConfig>
): void {
  const inboxDir = getInboxDir(teamName, agentId, config)
  if (!existsSync(inboxDir)) {
    return
  }

  const files = readdirSync(inboxDir).filter(
    (f) => f.endsWith(".json") && !f.startsWith("_")
  )

  markAsRead(
    teamName,
    agentId,
    files.map((f) => f.replace(".json", "")),
    config
  )
}

/**
 * Delete specific messages from an agent's inbox
 */
export function deleteMessages(
  teamName: string,
  agentId: string,
  messageIds: string[],
  config: Partial<OhMyOpenCodeConfig>
): void {
  for (const messageId of messageIds) {
    const messagePath = getMessagePath(teamName, agentId, messageId, config)
    if (existsSync(messagePath)) {
      try {
        unlinkSync(messagePath)
      } catch {
        // Ignore delete errors
      }
    }
  }
}

/**
 * Clear all messages from an agent's inbox
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

  const files = readdirSync(inboxDir).filter(
    (f) => f.endsWith(".json") && !f.startsWith("_")
  )

  for (const file of files) {
    try {
      unlinkSync(join(inboxDir, file))
    } catch {
      // Ignore delete errors
    }
  }
}

/**
 * Prune old read messages, keeping only recent ones
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

  const maxAge = options?.maxAge ?? 24 * 60 * 60 * 1000 // 24 hours default
  const now = Date.now()
  let pruned = 0

  const files = readdirSync(inboxDir).filter(
    (f) => f.endsWith(".json") && !f.startsWith("_")
  )

  for (const file of files) {
    const messagePath = join(inboxDir, file)
    try {
      const content = require("fs").readFileSync(messagePath, "utf-8")
      const message: InboxMessage = JSON.parse(content)

      // Delete old read messages
      if (message.read && now - message.timestamp > maxAge) {
        unlinkSync(messagePath)
        pruned++
      }
    } catch {
      // Ignore errors for individual messages
    }
  }

  return pruned
}
