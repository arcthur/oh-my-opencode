import type { OhMyOpenCodeConfig } from "../config"
import { AGENT_MODEL_REQUIREMENTS, CATEGORY_MODEL_REQUIREMENTS } from "./model-requirements"

export function resolveAgentVariant(
  config: OhMyOpenCodeConfig,
  agentName?: string
): string | undefined {
  if (!agentName) {
    return undefined
  }

  const agentOverrides = config.agents as
    | Record<string, { variant?: string; category?: string }>
    | undefined
  const agentOverride = agentOverrides
    ? agentOverrides[agentName]
      ?? Object.entries(agentOverrides).find(([key]) => key.toLowerCase() === agentName.toLowerCase())?.[1]
    : undefined
  if (!agentOverride) {
    return undefined
  }

  if (agentOverride.variant) {
    return agentOverride.variant
  }

  const categoryName = agentOverride.category
  if (!categoryName) {
    return undefined
  }

  return config.categories?.[categoryName]?.variant
}

/**
 * Resolve variant for a specific model, honoring user overrides first.
 * Priority order:
 * 1. User's agent override variant (highest priority)
 * 2. Agent's fallback chain variant for the current model
 * 3. Category's fallback chain variant for the current model
 */
export function resolveVariantForModel(
  config: OhMyOpenCodeConfig,
  agentName: string,
  currentModel: { providerID: string; modelID: string },
): string | undefined {
  const agentOverrides = config.agents as
    | Record<string, { variant?: string; category?: string }>
    | undefined
  const agentOverride = agentOverrides
    ? agentOverrides[agentName]
      ?? Object.entries(agentOverrides).find(([key]) => key.toLowerCase() === agentName.toLowerCase())?.[1]
    : undefined

  // Priority 1: User's explicit variant override takes precedence
  if (agentOverride?.variant) {
    return agentOverride.variant
  }

  // Priority 2: Agent's fallback chain variant for current model
  const agentRequirement = AGENT_MODEL_REQUIREMENTS[agentName]
  if (agentRequirement) {
    return findVariantInChain(agentRequirement.fallbackChain, currentModel)
  }

  // Priority 3: Category's fallback chain variant for current model
  const categoryName = agentOverride?.category
  if (categoryName) {
    const categoryRequirement = CATEGORY_MODEL_REQUIREMENTS[categoryName]
    if (categoryRequirement) {
      return findVariantInChain(categoryRequirement.fallbackChain, currentModel)
    }
  }

  return undefined
}

function findVariantInChain(
  fallbackChain: { providers: string[]; model: string; variant?: string }[],
  currentModel: { providerID: string; modelID: string },
): string | undefined {
  for (const entry of fallbackChain) {
    if (
      entry.providers.includes(currentModel.providerID)
      && entry.model === currentModel.modelID
    ) {
      return entry.variant
    }
  }
  return undefined
}

export function applyAgentVariant(
  config: OhMyOpenCodeConfig,
  agentName: string | undefined,
  message: { variant?: string }
): void {
  const variant = resolveAgentVariant(config, agentName)
  if (variant !== undefined && message.variant === undefined) {
    message.variant = variant
  }
}
