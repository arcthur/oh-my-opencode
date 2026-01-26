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
    const type = this.determineSessionType(parentID)

    const state: SessionLifecycleState = {
      id: sessionID,
      type,
      parentID,
      createdAt: Date.now(),
      agent,
    }

    this.sessions.set(sessionID, state)

    if (type === "background" || type === "subagent") {
      this.subagentSessions.add(sessionID)
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
   * Check if session is background/subagent
   */
  isBackgroundSession(sessionID: string): boolean {
    return this.subagentSessions.has(sessionID)
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
}

// Singleton instance
export const sessionStateCoordinator = new SessionStateCoordinator()
