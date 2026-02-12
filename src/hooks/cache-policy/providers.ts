export type ProviderCachePolicyMode = "off" | "observe" | "enforce"

export const FIXED_PROVIDER_ROLLOUT_ORDER = [
  "openai",
  "anthropic",
  "google",
  "minimax",
  "zai",
  "moonshot",
] as const

export type ProviderRolloutID = (typeof FIXED_PROVIDER_ROLLOUT_ORDER)[number]

export interface ProviderCacheCapability {
  providerID: string
  supportsCachePolicy: boolean
  preferredOptionKey: string
  optionAliases: string[]
}

export interface ProviderCacheCapabilityOverride {
  supports_cache_policy?: boolean
  preferred_option_key?: string
  option_aliases?: string[]
}

export interface CachePolicyApplyResult {
  applied: boolean
  key?: string
  reason: string
}

export interface ProviderRolloutThreshold {
  enabled?: boolean
  min_cache_hit_ratio?: number
  max_error_rate?: number
  max_p95_latency_ms?: number
  min_samples?: number
}

export interface ProviderObservedMetrics {
  cache_hit_ratio?: number
  error_rate?: number
  p95_latency_ms?: number
  samples?: number
}

export interface ProviderRolloutGate {
  approved?: boolean
  threshold?: ProviderRolloutThreshold
  observed?: ProviderObservedMetrics
}

export interface ProviderRolloutGateEvaluation {
  passed: boolean
  reason: string
}

const CAPABILITY_REGISTRY: Record<string, ProviderCacheCapability> = {
  openai: {
    providerID: "openai",
    supportsCachePolicy: true,
    preferredOptionKey: "prompt_cache",
    optionAliases: ["prompt_cache", "promptCache", "cache"],
  },
  anthropic: {
    providerID: "anthropic",
    supportsCachePolicy: true,
    preferredOptionKey: "cache",
    optionAliases: ["cache", "prompt_cache", "cache_control", "cacheControl"],
  },
  google: {
    providerID: "google",
    supportsCachePolicy: true,
    preferredOptionKey: "cachedContent",
    optionAliases: ["cachedContent", "cached_content", "cache"],
  },
  minimax: {
    providerID: "minimax",
    supportsCachePolicy: false,
    preferredOptionKey: "cache",
    optionAliases: ["cache"],
  },
  zai: {
    providerID: "zai",
    supportsCachePolicy: false,
    preferredOptionKey: "cache",
    optionAliases: ["cache"],
  },
  moonshot: {
    providerID: "moonshot",
    supportsCachePolicy: false,
    preferredOptionKey: "cache",
    optionAliases: ["cache"],
  },
}

function normalizeProviderID(providerID: string | undefined): string {
  return (providerID ?? "").trim().toLowerCase()
}

function setEnabledValue(target: Record<string, unknown>, key: string): void {
  const current = target[key]

  if (typeof current === "boolean") {
    target[key] = true
    return
  }

  if (typeof current === "string") {
    target[key] = "enabled"
    return
  }

  if (typeof current === "number") {
    target[key] = 1
    return
  }

  if (current && typeof current === "object" && !Array.isArray(current)) {
    target[key] = {
      ...(current as Record<string, unknown>),
      enabled: true,
    }
    return
  }

  target[key] = true
}

export function resolveProviderCacheCapability(
  providerID: string,
  overrides?: Record<string, ProviderCacheCapabilityOverride>
): ProviderCacheCapability {
  const normalized = normalizeProviderID(providerID)

  const base: ProviderCacheCapability =
    normalized in CAPABILITY_REGISTRY
      ? CAPABILITY_REGISTRY[normalized]
      : {
          providerID: normalized || "unknown",
          supportsCachePolicy: false,
          preferredOptionKey: "cache",
          optionAliases: ["cache"],
        }

  const override = overrides?.[normalized]
  if (!override) {
    return base
  }

  const preferredOptionKey =
    typeof override.preferred_option_key === "string" && override.preferred_option_key.trim()
      ? override.preferred_option_key.trim()
      : base.preferredOptionKey

  const aliases = Array.isArray(override.option_aliases)
    ? override.option_aliases
        .map((alias) => alias.trim())
        .filter((alias) => alias.length > 0)
    : [...base.optionAliases]
  if (!aliases.includes(preferredOptionKey)) {
    aliases.unshift(preferredOptionKey)
  }

  return {
    providerID: base.providerID,
    supportsCachePolicy:
      typeof override.supports_cache_policy === "boolean"
        ? override.supports_cache_policy
        : base.supportsCachePolicy,
    preferredOptionKey,
    optionAliases: [...new Set(aliases)],
  }
}

export function applyProviderCachePolicy(params: {
  options: Record<string, unknown>
  capability: ProviderCacheCapability
  injectWhenMissing: boolean
}): CachePolicyApplyResult {
  const { options, capability, injectWhenMissing } = params

  if (!capability.supportsCachePolicy) {
    return {
      applied: false,
      reason: `provider ${capability.providerID} does not advertise cache policy support`,
    }
  }

  for (const key of capability.optionAliases) {
    if (!(key in options)) {
      continue
    }
    setEnabledValue(options, key)
    return {
      applied: true,
      key,
      reason: `updated existing option ${key}`,
    }
  }

  if (!injectWhenMissing) {
    return {
      applied: false,
      reason: "no known cache option key found in output.options",
    }
  }

  setEnabledValue(options, capability.preferredOptionKey)
  return {
    applied: true,
    key: capability.preferredOptionKey,
    reason: `injected option ${capability.preferredOptionKey}`,
  }
}

export function isProviderWithinRolloutStage(params: {
  providerID: string
  stage: number
}): boolean {
  const normalized = normalizeProviderID(params.providerID)
  const providerIndex = FIXED_PROVIDER_ROLLOUT_ORDER.indexOf(normalized as ProviderRolloutID)
  if (providerIndex < 0) {
    return false
  }

  const normalizedStage = Math.max(
    0,
    Math.min(Math.floor(params.stage), FIXED_PROVIDER_ROLLOUT_ORDER.length)
  )

  return providerIndex < normalizedStage
}

export function evaluateProviderRolloutGate(
  gate: ProviderRolloutGate | undefined
): ProviderRolloutGateEvaluation {
  if (!gate) {
    return { passed: true, reason: "no rollout threshold gate configured" }
  }

  const threshold = gate.threshold
  if (threshold?.enabled !== true) {
    if (gate.approved === false) {
      return { passed: false, reason: "threshold gate not approved" }
    }
    return { passed: true, reason: "threshold gate disabled" }
  }

  const observed = gate.observed
  if (!observed) {
    return { passed: false, reason: "threshold gate missing observed metrics" }
  }

  const minSamples = Math.max(0, threshold.min_samples ?? 0)
  const samples = Math.max(0, observed.samples ?? 0)
  if (samples < minSamples) {
    return {
      passed: false,
      reason: `threshold gate sample size ${samples} < ${minSamples}`,
    }
  }

  const minHitRatio = threshold.min_cache_hit_ratio ?? 0
  const hitRatio = observed.cache_hit_ratio ?? 0
  if (hitRatio < minHitRatio) {
    return {
      passed: false,
      reason: `threshold gate cache hit ratio ${hitRatio} < ${minHitRatio}`,
    }
  }

  const maxErrorRate = threshold.max_error_rate ?? 1
  const errorRate = observed.error_rate ?? 0
  if (errorRate > maxErrorRate) {
    return {
      passed: false,
      reason: `threshold gate error rate ${errorRate} > ${maxErrorRate}`,
    }
  }

  const maxP95 = threshold.max_p95_latency_ms ?? Number.POSITIVE_INFINITY
  const p95Latency = observed.p95_latency_ms ?? Number.POSITIVE_INFINITY
  if (p95Latency > maxP95) {
    return {
      passed: false,
      reason: `threshold gate p95 latency ${p95Latency} > ${maxP95}`,
    }
  }

  if (gate.approved === false) {
    return { passed: false, reason: "threshold gate not approved" }
  }

  return { passed: true, reason: "threshold gate satisfied" }
}
