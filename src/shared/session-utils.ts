import { getSessionAgent } from "../features/claude-code-session-state"

export function isCallerOrchestrator(sessionID?: string): boolean {
  if (!sessionID) return false
  const agent = getSessionAgent(sessionID)?.toLowerCase()
  return agent === "atlas" || agent === "sisyphus"
}
