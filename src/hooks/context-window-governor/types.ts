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
  cacheReadTokens: number
  cacheWriteTokens: number
  cacheHitRatio: number
  usageConfidence: "high" | "medium" | "low"
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
  prefixStability: PrefixStabilityBudget
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
  extends Partial<
    Omit<ContextWindowGovernorConfig, "recovery" | "dynamicPruning" | "prefixStability">
  > {
  recovery?: RecoveryRetryConfigOverride
  dynamicPruning?: DynamicPruningConfigOverride
  prefixStability?: Partial<PrefixStabilityBudget>
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

export type PrefixStabilityMode = "off" | "balanced" | "strict"

export interface PrefixStabilityBudget {
  mode: PrefixStabilityMode
  maxDestructiveRecoveries: number
  windowMs: number
  cooldownMs: number
  hardLimitBypassRatio: number
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
