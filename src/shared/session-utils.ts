import { existsSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { getSessionAgent } from "../features/claude-code-session-state"
import { findNearestMessageWithFields, MESSAGE_STORAGE } from "../features/hook-message-injector"

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

export function getSessionAgentBestEffort(sessionID: string): string | undefined {
  const inMemory = getSessionAgent(sessionID)
  if (inMemory) return inMemory

  const messageDir = getMessageDir(sessionID)
  if (!messageDir) return undefined

  const nearest = findNearestMessageWithFields(messageDir)
  return typeof nearest?.agent === "string" ? nearest.agent : undefined
}

export function isCallerAtlas(sessionID?: string): boolean {
  if (!sessionID) return false
  const agent = getSessionAgentBestEffort(sessionID)?.toLowerCase()
  return agent === "atlas"
}

export function isCallerOrchestrator(sessionID?: string): boolean {
  if (!sessionID) return false
  const agent = getSessionAgentBestEffort(sessionID)?.toLowerCase()
  return agent === "atlas" || agent === "sisyphus"
}
