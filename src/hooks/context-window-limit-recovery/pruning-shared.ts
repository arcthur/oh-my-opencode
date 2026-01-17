import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { MESSAGE_STORAGE, PART_STORAGE } from "../../features/hook-message-injector"

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

interface StoredMessageMeta {
  id?: string
  time?: { created?: number }
  [key: string]: unknown
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
    const messageMetas: Array<{ id: string; created: number }> = []
    const files = readdirSync(messageDir).filter((f) => f.endsWith(".json"))

    for (const file of files) {
      try {
        const content = readFileSync(join(messageDir, file), "utf-8")
        const meta = JSON.parse(content) as StoredMessageMeta
        const id = typeof meta.id === "string" ? meta.id : file.replace(/\.json$/, "")
        const created = typeof meta.time?.created === "number" ? meta.time.created : 0
        messageMetas.push({ id, created })
      } catch {
        continue
      }
    }

    messageMetas.sort((a, b) => {
      if (a.created !== b.created) return a.created - b.created
      return a.id.localeCompare(b.id)
    })

    for (const meta of messageMetas) {
      const partDir = join(PART_STORAGE, meta.id)
      const parts: ToolPart[] = []

      if (existsSync(partDir)) {
        try {
          const partFiles = readdirSync(partDir)
            .filter((f) => f.endsWith(".json"))
            .sort()

          for (const partFile of partFiles) {
            try {
              const partContent = readFileSync(join(partDir, partFile), "utf-8")
              const part = JSON.parse(partContent) as ToolPart
              parts.push(part)
            } catch {
              continue
            }
          }
        } catch {
          // Ignore part directory errors
        }
      }

      if (parts.length > 0) {
        messages.push({ type: "message", parts })
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
