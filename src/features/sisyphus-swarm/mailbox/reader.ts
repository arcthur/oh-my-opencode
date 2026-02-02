import { existsSync, readFileSync, readdirSync } from "fs"
import { join } from "path"
import { z } from "zod"
import type { OhMyOpenCodeConfig } from "../../../config/schema"
import { getTeamDir } from "../../sisyphus-tasks/storage"
import { ProtocolMessageSchema, type ProtocolMessage } from "./types"

/**
 * Envelope wrapping a protocol message with metadata
 */
export const InboxMessageSchema = z.object({
  id: z.string(),
  from: z.string(),
  timestamp: z.number(),
  read: z.boolean(),
  payload: ProtocolMessageSchema,
})

export type InboxMessage = z.infer<typeof InboxMessageSchema>

/**
 * Inbox metadata structure
 */
export const InboxMetaSchema = z.object({
  agentId: z.string(),
  createdAt: z.number().optional(),
  lastRead: z.number().optional(),
})

export type InboxMeta = z.infer<typeof InboxMetaSchema>

/**
 * Aggregated inbox structure (convenience view over directory-based storage)
 */
export const InboxSchema = z.object({
  agentId: z.string(),
  lastRead: z.number().optional(),
  messages: z.array(InboxMessageSchema),
})

export type Inbox = z.infer<typeof InboxSchema>

/**
 * Get inbox directory path for an agent
 */
function getInboxDir(
  teamName: string,
  agentId: string,
  config: Partial<OhMyOpenCodeConfig>
): string {
  const teamDir = getTeamDir(teamName, config)
  return join(teamDir, "inboxes", agentId)
}

/**
 * Get inbox meta file path
 */
function getInboxMetaPath(
  teamName: string,
  agentId: string,
  config: Partial<OhMyOpenCodeConfig>
): string {
  return join(getInboxDir(teamName, agentId, config), "_meta.json")
}

/**
 * Read inbox metadata
 */
export function readInboxMeta(
  teamName: string,
  agentId: string,
  config: Partial<OhMyOpenCodeConfig>
): InboxMeta | null {
  const metaPath = getInboxMetaPath(teamName, agentId, config)

  if (!existsSync(metaPath)) {
    return null
  }

  try {
    const content = readFileSync(metaPath, "utf-8")
    const parsed = JSON.parse(content)
    const result = InboxMetaSchema.safeParse(parsed)

    if (!result.success) {
      return null
    }

    return result.data
  } catch {
    return null
  }
}

/**
 * Read the raw inbox (builds aggregated Inbox view from directory)
 */
export function readInboxRaw(
  teamName: string,
  agentId: string,
  config: Partial<OhMyOpenCodeConfig>
): Inbox | null {
  const inboxDir = getInboxDir(teamName, agentId, config)

  if (!existsSync(inboxDir)) {
    return null
  }

  const meta = readInboxMeta(teamName, agentId, config)
  const messages = readInbox(teamName, agentId, config)

  return {
    agentId,
    lastRead: meta?.lastRead,
    messages,
  }
}

/**
 * Read all messages from an agent's inbox directory
 */
export function readInbox(
  teamName: string,
  agentId: string,
  config: Partial<OhMyOpenCodeConfig>
): InboxMessage[] {
  const inboxDir = getInboxDir(teamName, agentId, config)

  if (!existsSync(inboxDir)) {
    return []
  }

  const messages: InboxMessage[] = []

  try {
    const files = readdirSync(inboxDir).filter(
      (f) => f.endsWith(".json") && !f.startsWith("_")
    )

    for (const file of files) {
      const filePath = join(inboxDir, file)
      try {
        const content = readFileSync(filePath, "utf-8")
        const parsed = JSON.parse(content)
        const result = InboxMessageSchema.safeParse(parsed)

        if (result.success) {
          messages.push(result.data)
        }
      } catch {
        // Skip invalid message files
      }
    }
  } catch (error) {
    console.error(`[swarm] Failed to read inbox for ${agentId}:`, error)
    return []
  }

  // Sort by timestamp (oldest first)
  return messages.sort((a, b) => a.timestamp - b.timestamp)
}

/**
 * Read only unread messages from an agent's inbox
 */
export function readUnread(
  teamName: string,
  agentId: string,
  config: Partial<OhMyOpenCodeConfig>
): InboxMessage[] {
  const messages = readInbox(teamName, agentId, config)
  return messages.filter((m) => !m.read)
}

/**
 * Read messages of a specific type
 */
export function readByType<T extends ProtocolMessage["type"]>(
  teamName: string,
  agentId: string,
  messageType: T,
  config: Partial<OhMyOpenCodeConfig>
): InboxMessage[] {
  const messages = readInbox(teamName, agentId, config)
  return messages.filter((m) => m.payload.type === messageType)
}

/**
 * Read unread messages of a specific type
 */
export function readUnreadByType<T extends ProtocolMessage["type"]>(
  teamName: string,
  agentId: string,
  messageType: T,
  config: Partial<OhMyOpenCodeConfig>
): InboxMessage[] {
  const messages = readUnread(teamName, agentId, config)
  return messages.filter((m) => m.payload.type === messageType)
}

/**
 * Get the last read timestamp for an inbox
 */
export function getLastReadTimestamp(
  teamName: string,
  agentId: string,
  config: Partial<OhMyOpenCodeConfig>
): number | null {
  const meta = readInboxMeta(teamName, agentId, config)
  return meta?.lastRead ?? null
}

/**
 * Check if there are any unread messages
 */
export function hasUnread(
  teamName: string,
  agentId: string,
  config: Partial<OhMyOpenCodeConfig>
): boolean {
  const unread = readUnread(teamName, agentId, config)
  return unread.length > 0
}

/**
 * Count unread messages
 */
export function countUnread(
  teamName: string,
  agentId: string,
  config: Partial<OhMyOpenCodeConfig>
): number {
  return readUnread(teamName, agentId, config).length
}

/**
 * Find a specific message by ID
 */
export function findMessage(
  teamName: string,
  agentId: string,
  messageId: string,
  config: Partial<OhMyOpenCodeConfig>
): InboxMessage | null {
  const inboxDir = getInboxDir(teamName, agentId, config)
  const messagePath = join(inboxDir, `${messageId}.json`)

  if (!existsSync(messagePath)) {
    return null
  }

  try {
    const content = readFileSync(messagePath, "utf-8")
    const parsed = JSON.parse(content)
    const result = InboxMessageSchema.safeParse(parsed)

    if (result.success) {
      return result.data
    }
  } catch {
    // Ignore errors
  }

  return null
}
