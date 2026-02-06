import { sessionStateCoordinator } from "../session-state-coordinator"

export function setMainSession(id: string | undefined): void {
  sessionStateCoordinator.setMainSessionID(id)
}

export function getMainSessionID(): string | undefined {
  return sessionStateCoordinator.getMainSessionID()
}

export function setSessionAgent(sessionID: string, agent: string): void {
  sessionStateCoordinator.setSessionAgent(sessionID, agent)
}

export function updateSessionAgent(sessionID: string, agent: string): void {
  sessionStateCoordinator.updateSessionAgent(sessionID, agent)
}

export function getSessionAgent(sessionID: string): string | undefined {
  return sessionStateCoordinator.getSessionAgent(sessionID)
}

export function clearSessionAgent(sessionID: string): void {
  sessionStateCoordinator.clearSessionAgent(sessionID)
}

export function markSubagentSession(sessionID: string, parentID?: string): void {
  sessionStateCoordinator.markSubagentSession(sessionID, parentID)
}

export function unmarkSubagentSession(sessionID: string): void {
  sessionStateCoordinator.unmarkSubagentSession(sessionID)
}

export function isSubagentSession(sessionID: string): boolean {
  return sessionStateCoordinator.isSubagentSession(sessionID)
}

export function listSubagentSessions(): string[] {
  return sessionStateCoordinator.getSubagentSessionIDs()
}

/** @internal For testing only */
export function _resetForTesting(): void {
  sessionStateCoordinator._resetForTesting()
}
