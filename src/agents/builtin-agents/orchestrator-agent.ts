import type { AgentConfig } from "@opencode-ai/sdk"
import type { AgentOverrides } from "../types"
import type { CategoriesConfig, CategoryConfig } from "../../config/schema"
import type { AvailableAgent, AvailableCategory, AvailableSkill } from "../dynamic-agent-prompt-builder"
import { AGENT_MODEL_REQUIREMENTS, isAnyFallbackModelAvailable } from "../../shared"
import { applyEnvironmentContext } from "./environment-context"
import { applyOverrides } from "./agent-overrides"
import { applyModelResolution, getFirstFallbackModel } from "./model-resolution"
import { createOrchestratorAgent } from "../orchestrator"

export function maybeCreateOrchestratorConfig(input: {
  disabledAgents: string[]
  agentOverrides: AgentOverrides
  uiSelectedModel?: string
  availableModels: Set<string>
  systemDefaultModel?: string
  isFirstRunNoCache: boolean
  availableAgents: AvailableAgent[]
  availableSkills: AvailableSkill[]
  availableCategories: AvailableCategory[]
  mergedCategories: Record<string, CategoryConfig>
  directory?: string
  userCategories?: CategoriesConfig
}): AgentConfig | undefined {
  const {
    disabledAgents,
    agentOverrides,
    uiSelectedModel,
    availableModels,
    systemDefaultModel,
    isFirstRunNoCache,
    availableAgents,
    availableSkills,
    availableCategories,
    mergedCategories,
    directory,
  } = input

  const orchestratorOverride = agentOverrides["orchestrator"]
  const orchestratorRequirement = AGENT_MODEL_REQUIREMENTS["orchestrator"]
  const hasOrchestratorExplicitConfig = orchestratorOverride !== undefined
  const meetsOrchestratorAnyModelRequirement =
    !orchestratorRequirement?.requiresAnyModel ||
    hasOrchestratorExplicitConfig ||
    isFirstRunNoCache ||
    isAnyFallbackModelAvailable(orchestratorRequirement.fallbackChain, availableModels)

  if (disabledAgents.includes("orchestrator") || !meetsOrchestratorAnyModelRequirement) return undefined

  let orchestratorResolution = applyModelResolution({
    uiSelectedModel: orchestratorOverride?.model ? undefined : uiSelectedModel,
    userModel: orchestratorOverride?.model,
    requirement: orchestratorRequirement,
    availableModels,
    systemDefaultModel,
  })

  if (isFirstRunNoCache && !orchestratorOverride?.model && !uiSelectedModel) {
    orchestratorResolution = getFirstFallbackModel(orchestratorRequirement)
  }

  if (!orchestratorResolution) return undefined
  const { model: orchestratorModel, variant: orchestratorResolvedVariant } = orchestratorResolution

  let orchestratorConfig = createOrchestratorAgent(
    orchestratorModel,
    availableAgents,
    undefined,
    availableSkills,
    availableCategories
  )

  if (orchestratorResolvedVariant) {
    orchestratorConfig = { ...orchestratorConfig, variant: orchestratorResolvedVariant }
  }

  orchestratorConfig = applyOverrides(orchestratorConfig, orchestratorOverride, mergedCategories)
  orchestratorConfig = applyEnvironmentContext(orchestratorConfig, directory)

  return orchestratorConfig
}
