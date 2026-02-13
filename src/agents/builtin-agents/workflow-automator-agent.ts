import type { AgentConfig } from "@opencode-ai/sdk"
import type { AgentOverrides } from "../types"
import type { CategoriesConfig, CategoryConfig } from "../../config/schema"
import type { AvailableAgent, AvailableSkill } from "../dynamic-agent-prompt-builder"
import { AGENT_MODEL_REQUIREMENTS } from "../../shared"
import { applyOverrides } from "./agent-overrides"
import { applyModelResolution } from "./model-resolution"
import { createWorkflowAutomatorAgent } from "../workflow-automator"

export function maybeCreateWorkflowAutomatorConfig(input: {
  disabledAgents: string[]
  agentOverrides: AgentOverrides
  uiSelectedModel?: string
  availableModels: Set<string>
  systemDefaultModel?: string
  availableAgents: AvailableAgent[]
  availableSkills: AvailableSkill[]
  mergedCategories: Record<string, CategoryConfig>
  userCategories?: CategoriesConfig
}): AgentConfig | undefined {
  const {
    disabledAgents,
    agentOverrides,
    uiSelectedModel,
    availableModels,
    systemDefaultModel,
    availableAgents,
    availableSkills,
    mergedCategories,
    userCategories,
  } = input

  if (disabledAgents.includes("workflow-automator")) return undefined

  const orchestratorOverride = agentOverrides["workflow-automator"]
  const workflowAutomatorRequirement = AGENT_MODEL_REQUIREMENTS["workflow-automator"]

  const workflowAutomatorResolution = applyModelResolution({
    uiSelectedModel: orchestratorOverride?.model ? undefined : uiSelectedModel,
    userModel: orchestratorOverride?.model,
    requirement: workflowAutomatorRequirement,
    availableModels,
    systemDefaultModel,
  })

  if (!workflowAutomatorResolution) return undefined
  const { model: workflowAutomatorModel, variant: workflowAutomatorResolvedVariant } = workflowAutomatorResolution

  let orchestratorConfig = createWorkflowAutomatorAgent({
    model: workflowAutomatorModel,
    availableAgents,
    availableSkills,
    userCategories,
  })

  if (workflowAutomatorResolvedVariant) {
    orchestratorConfig = { ...orchestratorConfig, variant: workflowAutomatorResolvedVariant }
  }

  orchestratorConfig = applyOverrides(orchestratorConfig, orchestratorOverride, mergedCategories)

  return orchestratorConfig
}
