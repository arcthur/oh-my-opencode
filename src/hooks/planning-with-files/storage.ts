/**
 * Planning with Files Hook State Storage
 *
 * Manages per-session state for the planning hooks.
 */

import type { PlanningHookState } from "./types"

/** In-memory state storage per session */
const sessionStates = new Map<string, PlanningHookState>()

/**
 * Get or create state for a session
 */
export function getSessionState(sessionId: string): PlanningHookState {
  let state = sessionStates.get(sessionId)
  if (!state) {
    state = {
      sessionId,
      activePlanName: null,
      actionCount: 0,
      lastRereadTime: 0,
      twoActionWarningShown: false,
      errorStrikes: new Map(),
    }
    sessionStates.set(sessionId, state)
  }
  return state
}

/**
 * Update session state
 */
export function updateSessionState(
  sessionId: string,
  updates: Partial<Omit<PlanningHookState, "sessionId">>
): void {
  const state = getSessionState(sessionId)
  Object.assign(state, updates)
}

/**
 * Set active plan for a session
 */
export function setActivePlan(sessionId: string, planName: string | null): void {
  const state = getSessionState(sessionId)
  state.activePlanName = planName
  state.actionCount = 0
  state.twoActionWarningShown = false
}

/**
 * Get active plan for a session
 */
export function getActivePlan(sessionId: string): string | null {
  return getSessionState(sessionId).activePlanName
}

/**
 * Increment action count and return new count
 */
export function incrementActionCount(sessionId: string): number {
  const state = getSessionState(sessionId)
  state.actionCount++
  return state.actionCount
}

/**
 * Reset action count
 */
export function resetActionCount(sessionId: string): void {
  const state = getSessionState(sessionId)
  state.actionCount = 0
  state.twoActionWarningShown = false
}

/**
 * Check if 2-action warning was shown
 */
export function wasTwoActionWarningShown(sessionId: string): boolean {
  return getSessionState(sessionId).twoActionWarningShown
}

/**
 * Mark 2-action warning as shown
 */
export function markTwoActionWarningShown(sessionId: string): void {
  getSessionState(sessionId).twoActionWarningShown = true
}

/**
 * Update last re-read time
 */
export function updateLastRereadTime(sessionId: string): void {
  getSessionState(sessionId).lastRereadTime = Date.now()
}

/**
 * Get last re-read time
 */
export function getLastRereadTime(sessionId: string): number {
  return getSessionState(sessionId).lastRereadTime
}

/**
 * Record an error strike
 */
export function recordErrorStrike(sessionId: string, errorKey: string): number {
  const state = getSessionState(sessionId)
  const currentStrikes = state.errorStrikes.get(errorKey) || 0
  const newStrikes = currentStrikes + 1
  state.errorStrikes.set(errorKey, newStrikes)
  return newStrikes
}

/**
 * Get error strikes
 */
export function getErrorStrikes(sessionId: string, errorKey: string): number {
  return getSessionState(sessionId).errorStrikes.get(errorKey) || 0
}

/**
 * Clear error strikes
 */
export function clearErrorStrikes(sessionId: string, errorKey: string): void {
  getSessionState(sessionId).errorStrikes.delete(errorKey)
}

/**
 * Cleanup session state
 */
export function cleanupSession(sessionId: string): void {
  sessionStates.delete(sessionId)
}

/**
 * Get all active sessions (for debugging)
 */
export function getActiveSessions(): string[] {
  return Array.from(sessionStates.keys())
}
