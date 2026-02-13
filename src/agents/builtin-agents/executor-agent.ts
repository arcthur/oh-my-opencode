import type { AgentConfig } from "@opencode-ai/sdk"
import type { AgentOverrides } from "../types"
import type { CategoryConfig } from "../../config/schema"
import type { AvailableAgent, AvailableCategory, AvailableSkill } from "../dynamic-agent-prompt-builder"
import { AGENT_MODEL_REQUIREMENTS, isAnyProviderConnected } from "../../shared"
import { createExecutorAgent } from "../executor"
import { createEnvContext } from "../env-context"
import { applyCategoryOverride, mergeAgentConfig } from "./agent-overrides"
import { applyModelResolution, getFirstFallbackModel } from "./model-resolution"

export function maybeCreateExecutorConfig(input: {
  disabledAgents: string[]
  agentOverrides: AgentOverrides
  availableModels: Set<string>
  systemDefaultModel?: string
  isFirstRunNoCache: boolean
  availableAgents: AvailableAgent[]
  availableSkills: AvailableSkill[]
  availableCategories: AvailableCategory[]
  mergedCategories: Record<string, CategoryConfig>
  directory?: string
}): AgentConfig | undefined {
  const {
    disabledAgents,
    agentOverrides,
    availableModels,
    systemDefaultModel,
    isFirstRunNoCache,
    availableAgents,
    availableSkills,
    availableCategories,
    mergedCategories,
    directory,
  } = input

  if (disabledAgents.includes("executor")) return undefined

  const executorOverride = agentOverrides["executor"]
  const executorRequirement = AGENT_MODEL_REQUIREMENTS["executor"]
  const hasExecutorExplicitConfig = executorOverride !== undefined

  const hasRequiredProvider =
    !executorRequirement?.requiresProvider ||
    hasExecutorExplicitConfig ||
    isFirstRunNoCache ||
    isAnyProviderConnected(executorRequirement.requiresProvider, availableModels)

  if (!hasRequiredProvider) return undefined

  let executorResolution = applyModelResolution({
    userModel: executorOverride?.model,
    categoryDefaultModel: executorOverride?.category ? mergedCategories[executorOverride.category]?.model : undefined,
    requirement: executorRequirement,
    availableModels,
    systemDefaultModel,
  })

  if (isFirstRunNoCache && !executorOverride?.model) {
    executorResolution = getFirstFallbackModel(executorRequirement)
  }

  if (!executorResolution) return undefined
  const { model: executorModel, variant: executorResolvedVariant } = executorResolution

  let executorConfig = createExecutorAgent(
    executorModel,
    availableAgents,
    undefined,
    availableSkills,
    availableCategories
  )

  executorConfig = { ...executorConfig, variant: executorResolvedVariant ?? "medium" }

  const executorOverrideCategory = executorOverride?.category
  if (executorOverrideCategory) {
    executorConfig = applyCategoryOverride(executorConfig, executorOverrideCategory, mergedCategories)
  }

  if (directory && executorConfig.prompt) {
    const envContext = createEnvContext()
    executorConfig = { ...executorConfig, prompt: executorConfig.prompt + envContext }
  }

  if (executorOverride) {
    executorConfig = mergeAgentConfig(executorConfig, executorOverride)
  }
  return executorConfig
}
