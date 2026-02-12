import { log } from "../../shared/logger"
import {
  applyProviderCachePolicy,
  evaluateProviderRolloutGate,
  isProviderWithinRolloutStage,
  type ProviderCacheCapabilityOverride,
  type ProviderRolloutGate,
  resolveProviderCacheCapability,
  type ProviderCachePolicyMode,
} from "./providers"

interface ProviderPolicyOverride {
  mode?: "inherit" | ProviderCachePolicyMode
}

interface CacheStrategyLike {
  observability?: {
    enabled?: boolean
    emit_log?: boolean
  }
  provider_policy?: {
    mode?: ProviderCachePolicyMode
    inject_when_missing?: boolean
    providers?: Record<string, ProviderPolicyOverride>
    capabilities?: Record<string, ProviderCacheCapabilityOverride>
    rollout?: ProviderPolicyRolloutConfig
  }
}

interface ProviderPolicyRolloutConfig {
  enabled?: boolean
  stage?: number
  require_thresholds?: boolean
  providers?: Record<string, ProviderRolloutGate>
}

interface ChatParamsInput {
  sessionID: string
  agent: { name?: string }
  model: { providerID?: string; modelID?: string }
  provider: { id?: string }
  message: { variant?: string }
}

interface ChatParamsOutput {
  options: Record<string, unknown>
}

export interface ProviderCachePolicyDecision {
  sessionID: string
  providerID: string
  modelID?: string
  requestedMode: ProviderCachePolicyMode
  effectiveMode: ProviderCachePolicyMode
  supportsCachePolicy: boolean
  applied: boolean
  reason: string
  appliedKey?: string
  createdAt: number
}

const DEFAULT_MODE: ProviderCachePolicyMode = "observe"

function normalizeProviderID(providerID: string | undefined): string {
  return (providerID ?? "").trim().toLowerCase()
}

function resolveRequestedMode(
  providerID: string,
  config?: CacheStrategyLike
): ProviderCachePolicyMode {
  const globalMode = config?.provider_policy?.mode ?? DEFAULT_MODE
  const providerMode = config?.provider_policy?.providers?.[providerID]?.mode

  if (!providerMode || providerMode === "inherit") {
    return globalMode
  }

  return providerMode
}

function evaluateRolloutGateForProvider(
  providerID: string,
  config?: CacheStrategyLike
): { allowed: boolean; reason: string } {
  const rollout = config?.provider_policy?.rollout
  if (!rollout?.enabled) {
    return { allowed: true, reason: "rollout disabled" }
  }

  const stage = rollout.stage ?? 0
  if (!isProviderWithinRolloutStage({ providerID, stage })) {
    return {
      allowed: false,
      reason: `rollout stage ${stage} has not reached provider ${providerID}`,
    }
  }

  if (rollout.require_thresholds === false) {
    return {
      allowed: true,
      reason: "rollout stage allows enforce without threshold checks",
    }
  }

  const gate = rollout.providers?.[providerID]
  if (!gate) {
    return {
      allowed: false,
      reason: "threshold gate missing for provider",
    }
  }
  if (gate.threshold?.enabled !== true) {
    return {
      allowed: false,
      reason: "threshold gate disabled for provider",
    }
  }
  const result = evaluateProviderRolloutGate(gate)
  return {
    allowed: result.passed,
    reason: result.reason,
  }
}

export function createCachePolicyHook(config?: CacheStrategyLike) {
  const lastDecisionBySession = new Map<string, ProviderCachePolicyDecision>()

  return {
    "chat.params": async (input: ChatParamsInput, output: ChatParamsOutput): Promise<void> => {
      const providerID = normalizeProviderID(
        input.model.providerID ?? input.provider.id
      )
      const requestedMode = resolveRequestedMode(providerID, config)
      const capability = resolveProviderCacheCapability(
        providerID,
        config?.provider_policy?.capabilities
      )

      let effectiveMode = requestedMode
      let applied = false
      let appliedKey: string | undefined
      let reason = "observe mode: no mutation"

      if (requestedMode === "off") {
        reason = "policy disabled"
      } else if (requestedMode === "enforce") {
        const rollout = evaluateRolloutGateForProvider(capability.providerID, config)
        if (!rollout.allowed) {
          effectiveMode = "observe"
          reason = `rollout gate blocked enforce: ${rollout.reason}`
        } else if (!capability.supportsCachePolicy) {
          effectiveMode = "observe"
          reason = `provider ${capability.providerID} unsupported, downgraded to observe`
        } else {
          const applyResult = applyProviderCachePolicy({
            options: output.options,
            capability,
            injectWhenMissing: config?.provider_policy?.inject_when_missing ?? false,
          })
          applied = applyResult.applied
          reason = applyResult.reason
          appliedKey = applyResult.key
        }
      } else if (requestedMode === "observe") {
        const rollout = evaluateRolloutGateForProvider(capability.providerID, config)
        reason = rollout.allowed
          ? "observe mode: no mutation"
          : `observe mode active; rollout status: ${rollout.reason}`
      }

      const decision: ProviderCachePolicyDecision = {
        sessionID: input.sessionID,
        providerID: capability.providerID,
        modelID: input.model.modelID,
        requestedMode,
        effectiveMode,
        supportsCachePolicy: capability.supportsCachePolicy,
        applied,
        reason,
        appliedKey,
        createdAt: Date.now(),
      }

      lastDecisionBySession.set(input.sessionID, decision)

      if (config?.observability?.enabled !== false && config?.observability?.emit_log !== false) {
        log("[cache-policy] decision", decision)
      }
    },

    getLastDecision(sessionID: string): ProviderCachePolicyDecision | undefined {
      return lastDecisionBySession.get(sessionID)
    },

    clearSession(sessionID: string): void {
      lastDecisionBySession.delete(sessionID)
    },
  }
}
