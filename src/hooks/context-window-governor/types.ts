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
  dynamicPruning: DynamicPruningConfig
}

export interface RecoveryRetryConfig {
  maxAttempts: number
  initialDelayMs: number
  maxDelayMs: number
  toastCooldownMs: number
  aggressiveOutputTruncation: RecoveryAggressiveOutputTruncationConfig
}

export interface RecoveryAggressiveOutputTruncationConfig {
  enabled: boolean
  targetRatio: number
  charsPerToken: number
  maxOutputs: number
  minOutputChars: number
  keepRecentTurns: number
  protectedTools: string[]
}

export interface RecoveryRetryConfigOverride
  extends Partial<Omit<RecoveryRetryConfig, "aggressiveOutputTruncation">> {
  aggressiveOutputTruncation?: Partial<RecoveryAggressiveOutputTruncationConfig>
}

export interface DynamicPruningConfigOverride
  extends Partial<Omit<DynamicPruningConfig, "turnProtection" | "strategies">> {
  turnProtection?: Partial<DynamicPruningTurnProtectionConfig>
  strategies?: {
    deduplication?: Partial<DynamicPruningDeduplicationConfig>
    staleToolOutputs?: Partial<DynamicPruningStaleToolOutputsConfig>
  }
}

export interface ContextWindowGovernorConfigOverride
  extends Partial<Omit<ContextWindowGovernorConfig, "recovery" | "dynamicPruning">> {
  recovery?: RecoveryRetryConfigOverride
  dynamicPruning?: DynamicPruningConfigOverride
}

export interface DynamicPruningConfig {
  enabled: boolean
  notification: "off" | "minimal" | "detailed"
  recoveryTargetRatio: number
  charsPerToken: number
  skipSummarizeIfRecovered: boolean
  protectedTools: string[]
  turnProtection: DynamicPruningTurnProtectionConfig
  strategies: DynamicPruningStrategiesConfig
}

export interface DynamicPruningTurnProtectionConfig {
  enabled: boolean
  turns: number
}

export interface DynamicPruningStrategiesConfig {
  deduplication: DynamicPruningDeduplicationConfig
  staleToolOutputs: DynamicPruningStaleToolOutputsConfig
}

export interface DynamicPruningDeduplicationConfig {
  enabled: boolean
}

export interface DynamicPruningStaleToolOutputsConfig {
  enabled: boolean
  keepRecentTurns: number
  minOutputChars: number
  maxOutputs: number
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
