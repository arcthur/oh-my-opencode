import { log } from "../../shared/logger"
import type {
  FeatureStateHandler,
  ISessionStateCoordinator,
  SessionLifecycleState,
  SessionType,
} from "./types"

/**
 * SessionStateCoordinator manages session lifecycle across all features.
 *
 * It provides:
 * - Unified session lifecycle event dispatch
 * - Feature handler registration
 * - Session info with feature-contributed metadata
 * - Query API for feature-specific state
 */
export class SessionStateCoordinator implements ISessionStateCoordinator {
  private sessions: Map<string, SessionLifecycleState> = new Map()
  private handlers: Map<string, FeatureStateHandler> = new Map()
  private mainSessionID: string | undefined
  private subagentSessions: Set<string> = new Set()

  /**
   * Register a feature's state handler
   */
  registerFeature(name: string, handler: FeatureStateHandler): void {
    if (this.handlers.has(name)) {
      log("[session-coordinator] replacing handler", { feature: name })
    }
    this.handlers.set(name, handler)
    log("[session-coordinator] registered feature handler", { feature: name })
  }

  /**
   * Unregister a feature's state handler
   */
  unregisterFeature(name: string): void {
    this.handlers.delete(name)
  }

  /**
   * Notify coordinator of session created
   */
  onSessionCreated(sessionID: string, parentID?: string, agent?: string): void {
    const existing = this.sessions.get(sessionID)
    const effectiveParentID = parentID ?? existing?.parentID
    const type = this.determineSessionType(effectiveParentID)
    // Sticky: if previously marked as subagent (e.g. via markSubagentSession before create), preserve that flag
    const isSubagent = existing?.isSubagent ?? type !== "main"
    const rootSessionID = this.resolveRootSessionID(sessionID, effectiveParentID)

    const state: SessionLifecycleState = {
      id: sessionID,
      type,
      parentID: effectiveParentID,
      createdAt: existing?.createdAt ?? Date.now(),
      agent: agent ?? existing?.agent,
      isSubagent,
      rootSessionID,
    }

    this.sessions.set(sessionID, state)

    if (state.isSubagent) {
      this.subagentSessions.add(sessionID)
    } else {
      this.subagentSessions.delete(sessionID)
    }

    // Dispatch to all registered handlers
    for (const [name, handler] of this.handlers) {
      try {
        handler.onSessionCreated?.(sessionID, parentID)
      } catch (error) {
        log("[session-coordinator] handler error on create", {
          feature: name,
          error: String(error),
        })
      }
    }
  }

  /**
   * Notify coordinator of session deleted
   */
  onSessionDeleted(sessionID: string): void {
    // Dispatch to all registered handlers FIRST (so they can clean up)
    for (const [name, handler] of this.handlers) {
      try {
        handler.onSessionDeleted(sessionID)
      } catch (error) {
        log("[session-coordinator] handler error on delete", {
          feature: name,
          error: String(error),
        })
      }
    }

    // Clean up coordinator state
    this.sessions.delete(sessionID)
    this.subagentSessions.delete(sessionID)

    if (sessionID === this.mainSessionID) {
      this.mainSessionID = undefined
    }
  }

  /**
   * Notify coordinator of session compacted
   */
  onSessionCompacted(sessionID: string): void {
    // Dispatch to all registered handlers
    for (const [name, handler] of this.handlers) {
      try {
        handler.onSessionCompacted?.(sessionID)
      } catch (error) {
        log("[session-coordinator] handler error on compaction", {
          feature: name,
          error: String(error),
        })
      }
    }
  }

  /**
   * Get session info with feature-contributed metadata
   */
  getSessionInfo(sessionID: string): SessionLifecycleState | undefined {
    const base = this.sessions.get(sessionID)
    if (!base) return undefined

    // Collect metadata from all handlers
    const metadata: Record<string, unknown> = {}
    for (const [_name, handler] of this.handlers) {
      try {
        const contributed = handler.contributeMetadata?.(sessionID)
        if (contributed) {
          Object.assign(metadata, contributed)
        }
      } catch {
        // Ignore errors in metadata contribution
      }
    }

    return {
      ...base,
      ...metadata,
    } as SessionLifecycleState
  }

  /**
   * Get main session ID
   */
  getMainSessionID(): string | undefined {
    return this.mainSessionID
  }

  /**
   * Set main session ID
   */
  setMainSessionID(id: string | undefined): void {
    this.mainSessionID = id
  }

  /**
   * Check if session is currently marked as subagent/background.
   */
  isSubagentSession(sessionID: string): boolean {
    if (this.subagentSessions.has(sessionID)) return true
    return this.sessions.get(sessionID)?.isSubagent ?? false
  }

  /**
   * Backward-compatible alias for previous naming.
   */
  isBackgroundSession(sessionID: string): boolean {
    return this.isSubagentSession(sessionID)
  }

  /**
   * Mark a session as subagent/background.
   */
  markSubagentSession(sessionID: string, parentID?: string): void {
    const existing = this.sessions.get(sessionID)
    if (existing) {
      const effectiveParentID = parentID ?? existing.parentID
      let type = this.determineSessionType(effectiveParentID)
      if (type === "main") {
        type = "background"
      }
      existing.parentID = effectiveParentID
      existing.type = type
      existing.isSubagent = true
      existing.rootSessionID = this.resolveRootSessionID(sessionID, effectiveParentID)
      this.subagentSessions.add(sessionID)
      return
    }

    const typeFromParent = this.determineSessionType(parentID)
    const type: SessionType = typeFromParent === "main" ? "background" : typeFromParent
    this.sessions.set(sessionID, {
      id: sessionID,
      type,
      parentID,
      createdAt: Date.now(),
      isSubagent: true,
      rootSessionID: this.resolveRootSessionID(sessionID, parentID),
    })
    this.subagentSessions.add(sessionID)
  }

  /**
   * Remove subagent/background marker from a session.
   */
  unmarkSubagentSession(sessionID: string): void {
    this.subagentSessions.delete(sessionID)
    const existing = this.sessions.get(sessionID)
    if (existing) {
      existing.isSubagent = false
    }
  }

  /**
   * List all currently marked subagent/background sessions.
   */
  getSubagentSessionIDs(): string[] {
    return Array.from(this.subagentSessions)
  }

  /**
   * Set session agent only if not already set.
   */
  setSessionAgent(sessionID: string, agent: string): void {
    const state = this.ensureSessionState(sessionID)
    if (!state.agent) {
      state.agent = agent
    }
  }

  /**
   * Force-update session agent.
   */
  updateSessionAgent(sessionID: string, agent: string): void {
    const state = this.ensureSessionState(sessionID)
    state.agent = agent
  }

  /**
   * Get session agent.
   */
  getSessionAgent(sessionID: string): string | undefined {
    return this.sessions.get(sessionID)?.agent
  }

  /**
   * Clear session agent.
   */
  clearSessionAgent(sessionID: string): void {
    const state = this.sessions.get(sessionID)
    if (state) {
      state.agent = undefined
    }
  }

  /**
   * Query specific feature state
   */
  queryFeature<T = unknown>(sessionID: string, featureName: string): T | undefined {
    const handler = this.handlers.get(featureName)
    if (!handler?.getState) return undefined

    try {
      return handler.getState(sessionID) as T | undefined
    } catch {
      return undefined
    }
  }

  /**
   * Get all active sessions
   */
  getActiveSessions(): SessionLifecycleState[] {
    return Array.from(this.sessions.values()).map((base) => {
      const metadata: Record<string, unknown> = {}
      for (const [_name, handler] of this.handlers) {
        try {
          const contributed = handler.contributeMetadata?.(base.id)
          if (contributed) {
            Object.assign(metadata, contributed)
          }
        } catch {
          // Ignore
        }
      }
      return { ...base, ...metadata } as SessionLifecycleState
    })
  }

  /**
   * Determine session type from parentID
   */
  private determineSessionType(parentID?: string): SessionType {
    if (!parentID) return "main"
    if (this.sessions.get(parentID)?.type === "main") return "background"
    return "subagent"
  }

  private resolveRootSessionID(sessionID: string, parentID?: string): string | undefined {
    if (!parentID) return sessionID
    const parent = this.sessions.get(parentID)
    if (!parent) return parentID
    return parent.rootSessionID ?? parent.id
  }

  private ensureSessionState(sessionID: string): SessionLifecycleState {
    const existing = this.sessions.get(sessionID)
    if (existing) return existing

    log("[session-coordinator] implicit session state created", { sessionID })
    const state: SessionLifecycleState = {
      id: sessionID,
      type: "main",
      createdAt: Date.now(),
      isSubagent: false,
      rootSessionID: sessionID,
    }
    this.sessions.set(sessionID, state)
    return state
  }

  /**
   * Reset for testing
   * @internal
   */
  _resetForTesting(): void {
    this.sessions.clear()
    this.handlers.clear()
    this.subagentSessions.clear()
    this.mainSessionID = undefined
  }

  /**
   * Clear subagent markers for testing.
   * @internal
   */
  _clearSubagentSessionsForTesting(): void {
    this.subagentSessions.clear()
    for (const session of this.sessions.values()) {
      session.isSubagent = false
    }
  }
}

// Singleton instance
export const sessionStateCoordinator = new SessionStateCoordinator()
