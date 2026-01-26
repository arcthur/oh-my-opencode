/**
 * Session type classification
 */
export type SessionType = "main" | "background" | "subagent"

/**
 * Lifecycle state for a session
 */
export interface SessionLifecycleState {
  id: string
  type: SessionType
  parentID?: string
  createdAt: number
  agent?: string
  // Feature-contributed metadata
  activePlan?: string
  hasPendingTodos?: boolean
  isInRecovery?: boolean
}

/**
 * Handler interface for features to register with the coordinator
 */
export interface FeatureStateHandler {
  /** Called when session is created */
  onSessionCreated?(sessionID: string, parentID?: string): void

  /** Called when session is deleted - MUST clean up all state */
  onSessionDeleted(sessionID: string): void

  /** Called when session is compacted - may reset injection state */
  onSessionCompacted?(sessionID: string): void

  /** Query feature-specific state for a session */
  getState?(sessionID: string): unknown

  /** Contribute metadata to SessionLifecycleState */
  contributeMetadata?(sessionID: string): Record<string, unknown>
}

/**
 * Session state coordinator interface
 */
export interface ISessionStateCoordinator {
  /** Register a feature's state handler */
  registerFeature(name: string, handler: FeatureStateHandler): void

  /** Unregister a feature's state handler */
  unregisterFeature(name: string): void

  /** Notify coordinator of session created */
  onSessionCreated(sessionID: string, parentID?: string, agent?: string): void

  /** Notify coordinator of session deleted */
  onSessionDeleted(sessionID: string): void

  /** Notify coordinator of session compacted */
  onSessionCompacted(sessionID: string): void

  /** Get session info with feature metadata */
  getSessionInfo(sessionID: string): SessionLifecycleState | undefined

  /** Get main session ID */
  getMainSessionID(): string | undefined

  /** Set main session ID */
  setMainSessionID(id: string | undefined): void

  /** Check if session is background/subagent */
  isBackgroundSession(sessionID: string): boolean

  /** Query specific feature state */
  queryFeature<T = unknown>(sessionID: string, featureName: string): T | undefined

  /** Get all active sessions */
  getActiveSessions(): SessionLifecycleState[]
}
