import type { ExecutionContract } from "../../contracts"

interface ChatParamsLike {
  options: Record<string, unknown>
}

function ensureReasoningObject(options: Record<string, unknown>): Record<string, unknown> {
  const current = options.reasoning
  if (current && typeof current === "object" && !Array.isArray(current)) {
    return current as Record<string, unknown>
  }

  const created: Record<string, unknown> = {}
  options.reasoning = created
  return created
}

export function applyExecutionContractToChatParams(
  output: ChatParamsLike,
  contract: ExecutionContract
): void {
  const options = output.options
  const reasoningBudget = contract.budgets.reasoningBudget

  if (options.reasoningEffort === undefined) {
    options.reasoningEffort = reasoningBudget
  }
  if (options.reasoning_effort === undefined) {
    options.reasoning_effort = reasoningBudget
  }

  const reasoning = ensureReasoningObject(options)
  if (reasoning.effort === undefined) {
    reasoning.effort = reasoningBudget
  }

  if (options.policy_provider_priority === undefined) {
    options.policy_provider_priority = [...contract.modelPolicy.providerPriority]
  }
  if (options.policy_allow_fallback === undefined) {
    options.policy_allow_fallback = contract.modelPolicy.allowFallback
  }
}
