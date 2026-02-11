import { existsSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { getSessionAgent } from "../features/claude-code-session-state"
import { findNearestMessageWithFields, MESSAGE_STORAGE } from "../features/hook-message-injector"
import { EXECUTION_OWNER, type ExecutionOwner } from "../features/orchestration/owner"

export type OrchestratorCaller = "sisyphus" | "atlas"
export type ExecutionOwnership = "matched" | "mismatched" | "unknown"

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

export function getOrchestratorCaller(sessionID?: string): OrchestratorCaller | null {
  if (!sessionID) return null
  const agent = getSessionAgentBestEffort(sessionID)?.toLowerCase()
  if (agent === "sisyphus" || agent === "atlas") {
    return agent
  }
  return null
}

export function getExecutionCaller(sessionID?: string): ExecutionOwner | null {
  const orchestrator = getOrchestratorCaller(sessionID)
  return orchestrator === EXECUTION_OWNER ? EXECUTION_OWNER : null
}

export function resolveExecutionOwnership(
  sessionID: string | undefined,
  expectedExecutor: ExecutionOwner
): ExecutionOwnership {
  if (!sessionID) return "unknown"

  const caller = getExecutionCaller(sessionID)
  if (caller) {
    return caller === expectedExecutor ? "matched" : "mismatched"
  }

  const resolvedAgent = getSessionAgentBestEffort(sessionID)?.toLowerCase()
  if (!resolvedAgent) {
    return "unknown"
  }

  return "mismatched"
}

export function isCallerOrchestrator(sessionID?: string): boolean {
  return getOrchestratorCaller(sessionID) !== null
}
