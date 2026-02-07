import type { ModelCacheState } from "../../plugin-state"
import { getModelLimit } from "../../plugin-state"
import { getDefaultAnthropicContextLimit } from "../../shared/context-limits"

const DEFAULT_NON_ANTHROPIC_LIMIT = 200_000

interface LimitResolverDeps {
  modelCacheState?: ModelCacheState
}

interface LimitResolveInput {
  providerID?: string
  modelID?: string
}

export function createLimitResolver(deps?: LimitResolverDeps) {
  return (input: LimitResolveInput): number => {
    const providerID = input.providerID
    const modelID = input.modelID

    if (providerID && modelID && deps?.modelCacheState) {
      const cached = getModelLimit(deps.modelCacheState, providerID, modelID)
      if (cached) {
        return cached
      }
    }

    if (providerID === "anthropic") {
      return getDefaultAnthropicContextLimit()
    }

    return DEFAULT_NON_ANTHROPIC_LIMIT
  }
}
