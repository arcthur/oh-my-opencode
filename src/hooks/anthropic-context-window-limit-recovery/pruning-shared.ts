import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { MESSAGE_STORAGE } from "../../features/hook-message-injector"

/**
 * Common types for pruning strategy implementations
 */
export interface ToolPart {
  type: string
  callID?: string
  tool?: string
  state?: {
    input?: unknown
    output?: string
    status?: string
  }
}

export interface MessagePart {
  type: string
  parts?: ToolPart[]
}

/**
 * Get the message storage directory for a session
 */
export function getMessageDir(sessionID: string): string | null {
  if (!existsSync(MESSAGE_STORAGE)) return null

  const directPath = join(MESSAGE_STORAGE, sessionID)
  if (existsSync(directPath)) return directPath

  for (const dir of readdirSync(MESSAGE_STORAGE)) {
    const sessionPath = join(MESSAGE_STORAGE, dir, sessionID)
    if (existsSync(sessionPath)) return sessionPath
  }

  return null
}

/**
 * Read all messages for a session
 */
export function readMessages(sessionID: string): MessagePart[] {
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
 * Find tool output by callID
 */
export function findToolOutput(messages: MessagePart[], callID: string): string | null {
  for (const msg of messages) {
    if (!msg.parts) continue

    for (const part of msg.parts) {
      if (part.type === "tool" && part.callID === callID && part.state?.output) {
        return part.state.output
      }
    }
  }

  return null
}

/**
 * Find tool input by callID
 */
export function findToolInput(messages: MessagePart[], callID: string): unknown | null {
  for (const msg of messages) {
    if (!msg.parts) continue

    for (const part of msg.parts) {
      if (part.type === "tool" && part.callID === callID && part.state?.input) {
        return part.state.input
      }
    }
  }

  return null
}
