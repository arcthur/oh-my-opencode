import type { ContextWindowGovernorConfig } from "./types"

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
  },
}

export function resolveGovernorConfig(
  override?: Partial<ContextWindowGovernorConfig>
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
    },
  }
}
