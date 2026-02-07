export type ContextWindowPhase =
  | "healthy"
  | "warned"
  | "preemptive_armed"
  | "compacting"
  | "recovery_pending"
  | "recovering"
  | "cooldown"
  | "failed"

export type CompactionLeaseOwner = "preemptive" | "recovery"

export interface ContextWindowSnapshot {
  sessionID: string
  providerID: string
  modelID?: string
  limitTokens: number
  usedInputCacheTokens: number
  usedTotalTokens: number
  usageRatio: number
  capturedAt: number
  source: "session.messages"
}

export interface ContextWindowSignal {
  phase: ContextWindowPhase
  shouldWarn: boolean
  shouldPreemptiveCompact: boolean
  shouldRecover: boolean
}

export interface ContextWindowGovernorConfig {
  warningRatio: number
  preemptiveRatio: number
  limitRatio: number
  warningResetRatio: number
  preemptiveResetRatio: number
  recovery: RecoveryRetryConfig
}

export interface RecoveryRetryConfig {
  maxAttempts: number
  initialDelayMs: number
  maxDelayMs: number
  toastCooldownMs: number
}

export interface ParsedTokenLimitError {
  currentTokens: number
  maxTokens: number
  providerID?: string
  modelID?: string
}

export interface RecoveryRequest {
  sessionID: string
  providerID?: string
  modelID?: string
  currentTokens?: number
  maxTokens?: number
}
