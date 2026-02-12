import type { ContextWindowGovernorConfig, ContextWindowGovernorConfigOverride } from "./types"

export const DEFAULT_CONTEXT_WINDOW_GOVERNOR_CONFIG: ContextWindowGovernorConfig = {
  warningRatio: 0.7,
  preemptiveRatio: 0.78,
  limitRatio: 1.0,
  warningResetRatio: 0.65,
  preemptiveResetRatio: 0.73,
  recovery: {
    maxAttempts: 2,
    initialDelayMs: 2000,
    maxDelayMs: 30_000,
    toastCooldownMs: 30_000,
    aggressiveOutputTruncation: {
      enabled: true,
      targetRatio: 0.8,
      charsPerToken: 4,
      maxOutputs: 20,
      minOutputChars: 500,
      keepRecentTurns: 2,
      protectedTools: [
        "task",
        "task_update",
        "task_get",
        "lsp_rename",
        "session_read",
        "session_write",
        "session_search",
      ],
    },
  },
  dynamicPruning: {
    enabled: false,
    notification: "minimal",
    recoveryTargetRatio: 0.9,
    charsPerToken: 4,
    skipSummarizeIfRecovered: true,
    protectedTools: [
      "task",
      "task_update",
      "task_get",
      "lsp_rename",
      "session_read",
      "session_write",
      "session_search",
    ],
    turnProtection: {
      enabled: true,
      turns: 3,
    },
    strategies: {
      deduplication: {
        enabled: true,
      },
      staleToolOutputs: {
        enabled: true,
        keepRecentTurns: 6,
        minOutputChars: 1200,
        maxOutputs: 6,
      },
    },
  },
  prefixStability: {
    mode: "off",
    maxDestructiveRecoveries: 2,
    windowMs: 600_000,
    cooldownMs: 120_000,
    hardLimitBypassRatio: 1,
  },
}

export function resolveGovernorConfig(
  override?: ContextWindowGovernorConfigOverride
): ContextWindowGovernorConfig {
  return {
    warningRatio:
      override?.warningRatio ?? DEFAULT_CONTEXT_WINDOW_GOVERNOR_CONFIG.warningRatio,
    preemptiveRatio:
      override?.preemptiveRatio ?? DEFAULT_CONTEXT_WINDOW_GOVERNOR_CONFIG.preemptiveRatio,
    limitRatio: override?.limitRatio ?? DEFAULT_CONTEXT_WINDOW_GOVERNOR_CONFIG.limitRatio,
    warningResetRatio:
      override?.warningResetRatio ??
      DEFAULT_CONTEXT_WINDOW_GOVERNOR_CONFIG.warningResetRatio,
    preemptiveResetRatio:
      override?.preemptiveResetRatio ??
      DEFAULT_CONTEXT_WINDOW_GOVERNOR_CONFIG.preemptiveResetRatio,
    recovery: {
      ...DEFAULT_CONTEXT_WINDOW_GOVERNOR_CONFIG.recovery,
      ...override?.recovery,
      aggressiveOutputTruncation: {
        ...DEFAULT_CONTEXT_WINDOW_GOVERNOR_CONFIG.recovery.aggressiveOutputTruncation,
        ...override?.recovery?.aggressiveOutputTruncation,
        protectedTools:
          override?.recovery?.aggressiveOutputTruncation?.protectedTools ??
          DEFAULT_CONTEXT_WINDOW_GOVERNOR_CONFIG.recovery.aggressiveOutputTruncation
            .protectedTools,
      },
    },
    dynamicPruning: {
      ...DEFAULT_CONTEXT_WINDOW_GOVERNOR_CONFIG.dynamicPruning,
      ...override?.dynamicPruning,
      protectedTools:
        override?.dynamicPruning?.protectedTools ??
        DEFAULT_CONTEXT_WINDOW_GOVERNOR_CONFIG.dynamicPruning.protectedTools,
      turnProtection: {
        ...DEFAULT_CONTEXT_WINDOW_GOVERNOR_CONFIG.dynamicPruning.turnProtection,
        ...override?.dynamicPruning?.turnProtection,
      },
      strategies: {
        deduplication: {
          ...DEFAULT_CONTEXT_WINDOW_GOVERNOR_CONFIG.dynamicPruning.strategies.deduplication,
          ...override?.dynamicPruning?.strategies?.deduplication,
        },
        staleToolOutputs: {
          ...DEFAULT_CONTEXT_WINDOW_GOVERNOR_CONFIG.dynamicPruning.strategies.staleToolOutputs,
          ...override?.dynamicPruning?.strategies?.staleToolOutputs,
        },
      },
    },
    prefixStability: {
      ...DEFAULT_CONTEXT_WINDOW_GOVERNOR_CONFIG.prefixStability,
      ...override?.prefixStability,
    },
  }
}
