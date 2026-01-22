/**
 * Blocker Detection for Planning with Files
 *
 * Identifies errors that are likely to be blockers (permission issues, missing credentials)
 * vs. transient/fixable errors.
 */

// ============================================================================
// Blocker Keywords
// ============================================================================

/**
 * Keywords that indicate a blocker (permission/auth issues).
 * These errors typically require user intervention or external action.
 */
export const BLOCKER_KEYWORDS = [
  // API key issues
  "missing api key",
  "missing api-key",
  "no api key",
  "api key not found",
  "api key required",
  "invalid api key",

  // Permission issues
  "permission denied",
  "access denied",
  "not authorized",
  "unauthorized",
  "forbidden",
  "insufficient permissions",
  "insufficient privileges",

  // Authentication issues
  "authentication failed",
  "authentication required",
  "auth failed",
  "login required",
  "session expired",

  // Credential issues
  "credential",
  "requires credentials",
  "invalid credentials",
  "credentials not found",

  // Token issues
  "invalid token",
  "token expired",
  "token required",
  "access token",

  // Rate limiting (often requires waiting or plan change)
  "rate limit",
  "rate limited",
  "too many requests",
  "quota exceeded",
] as const

/**
 * LRU-style cache for tracking prompted blockers per session.
 * Prevents duplicate prompts while managing memory.
 */
export class BlockerPromptCache {
  private sessionKeys = new Map<string, Set<string>>()
  private sessionOrder: string[] = []
  private maxSessions: number
  private maxBlockersPerSession: number

  constructor(options?: { maxSessions?: number; maxBlockersPerSession?: number }) {
    this.maxSessions = options?.maxSessions ?? 100
    this.maxBlockersPerSession = options?.maxBlockersPerSession ?? 50
  }

  /**
   * Check if blocker was already prompted for this session
   */
  has(sessionId: string, blockerKey: string): boolean {
    return this.sessionKeys.get(sessionId)?.has(blockerKey) ?? false
  }

  /**
   * Mark blocker as prompted for this session
   */
  add(sessionId: string, blockerKey: string): void {
    let keys = this.sessionKeys.get(sessionId)

    if (!keys) {
      // New session - evict oldest if at capacity
      if (this.sessionOrder.length >= this.maxSessions) {
        const oldest = this.sessionOrder.shift()
        if (oldest) this.sessionKeys.delete(oldest)
      }

      keys = new Set<string>()
      this.sessionKeys.set(sessionId, keys)
      this.sessionOrder.push(sessionId)
    } else {
      // Move to end (most recently used)
      const idx = this.sessionOrder.indexOf(sessionId)
      if (idx !== -1) {
        this.sessionOrder.splice(idx, 1)
        this.sessionOrder.push(sessionId)
      }
    }

    // Evict oldest blockers if at capacity
    if (keys.size >= this.maxBlockersPerSession) {
      const keysArray = [...keys]
      keys.clear()
      // Keep most recent half
      for (const key of keysArray.slice(-Math.floor(this.maxBlockersPerSession / 2))) {
        keys.add(key)
      }
    }

    keys.add(blockerKey)
  }

  /**
   * Clear all data for a session
   */
  delete(sessionId: string): void {
    this.sessionKeys.delete(sessionId)
    const idx = this.sessionOrder.indexOf(sessionId)
    if (idx !== -1) this.sessionOrder.splice(idx, 1)
  }

  /**
   * Get cache statistics
   */
  stats(): { sessions: number; totalBlockers: number } {
    let totalBlockers = 0
    for (const keys of this.sessionKeys.values()) {
      totalBlockers += keys.size
    }
    return { sessions: this.sessionKeys.size, totalBlockers }
  }
}

/**
 * Check if error text indicates a likely blocker
 */
export function isBlockerLikely(errorText: string): boolean {
  const normalized = errorText.toLowerCase()
  return BLOCKER_KEYWORDS.some((keyword) => normalized.includes(keyword))
}

/**
 * Classify error type for better handling
 */
export type ErrorClassification =
  | "blocker" // Requires user intervention
  | "transient" // May resolve with retry
  | "fixable" // Can be fixed programmatically
  | "unknown" // Cannot classify

export function classifyError(errorText: string): ErrorClassification {
  const normalized = errorText.toLowerCase()

  // Check for blocker patterns
  if (isBlockerLikely(errorText)) {
    return "blocker"
  }

  // Check for transient patterns
  const transientPatterns = [
    "timeout",
    "timed out",
    "temporarily",
    "try again",
    "retry",
    "ECONNRESET",
    "ETIMEDOUT",
  ]
  if (transientPatterns.some((p) => normalized.includes(p.toLowerCase()))) {
    return "transient"
  }

  // Check for fixable patterns
  const fixablePatterns = [
    "not found",
    "does not exist",
    "no such file",
    "syntax error",
    "type error",
    "undefined",
    "null reference",
  ]
  if (fixablePatterns.some((p) => normalized.includes(p.toLowerCase()))) {
    return "fixable"
  }

  return "unknown"
}
