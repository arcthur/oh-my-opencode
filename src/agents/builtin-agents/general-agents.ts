import type { AgentConfig } from "@opencode-ai/sdk"
import type { BuiltinAgentName, AgentOverrideConfig, AgentOverrides, AgentPromptMetadata } from "../types"
import type { CategoryConfig, GitMasterConfig } from "../../config/schema"
import type { BrowserAutomationProvider } from "../../config/schema"
import type { AvailableAgent } from "../dynamic-agent-prompt-builder"
import { AGENT_MODEL_REQUIREMENTS, isModelAvailable } from "../../shared"
import { buildAgent, isFactory } from "../agent-builder"
import { applyOverrides } from "./agent-overrides"
import { applyEnvironmentContext } from "./environment-context"
import { applyModelResolution } from "./model-resolution"
import type { AgentSource } from "../agent-builder"

export function collectPendingBuiltinAgents(input: {
  agentSources: Record<BuiltinAgentName, AgentSource>
  agentMetadata: Partial<Record<BuiltinAgentName, AgentPromptMetadata>>
  disabledAgents: string[]
  agentOverrides: AgentOverrides
  directory?: string
  systemDefaultModel?: string
  mergedCategories: Record<string, CategoryConfig>
  gitMasterConfig?: GitMasterConfig
  browserProvider?: BrowserAutomationProvider
  uiSelectedModel?: string
  availableModels: Set<string>
  disabledSkills?: Set<string>
}): { pendingAgentConfigs: Map<string, AgentConfig>; availableAgents: AvailableAgent[] } {
  const {
    agentSources,
    agentMetadata,
    disabledAgents,
    agentOverrides,
    directory,
    systemDefaultModel,
    mergedCategories,
    gitMasterConfig,
    browserProvider,
    uiSelectedModel,
    availableModels,
    disabledSkills,
  } = input

  const availableAgents: AvailableAgent[] = []
  const pendingAgentConfigs: Map<string, AgentConfig> = new Map()

  for (const [name, source] of Object.entries(agentSources)) {
    const agentName = name as BuiltinAgentName

    if (agentName === "sisyphus") continue
    if (agentName === "hephaestus") continue
    if (disabledAgents.some((name) => name.toLowerCase() === agentName.toLowerCase())) continue

    const override = agentOverrides[agentName]
      ?? Object.entries(agentOverrides).find(([key]) => key.toLowerCase() === agentName.toLowerCase())?.[1]
    const requirement = AGENT_MODEL_REQUIREMENTS[agentName]

    if (requirement?.requiresModel && availableModels.size > 0) {
      if (!isModelAvailable(requirement.requiresModel, availableModels)) {
        continue
      }
    }

    const typedOverride = override as AgentOverrideConfig | undefined

    const isPrimaryAgent = isFactory(source) && source.mode === "primary"
    const resolution = applyModelResolution({
      uiSelectedModel: (isPrimaryAgent && !typedOverride?.model) ? uiSelectedModel : undefined,
      userModel: typedOverride?.model ? (Array.isArray(typedOverride.model) ? typedOverride.model[0] : typedOverride.model) : undefined,
      categoryDefaultModel: typedOverride?.category ? mergedCategories[typedOverride.category]?.model : undefined,
      requirement,
      availableModels,
      systemDefaultModel,
    })
    if (!resolution) continue
    const { model, variant: resolvedVariant } = resolution

    let config = buildAgent(source, model, mergedCategories, gitMasterConfig, browserProvider, disabledSkills)

    if (resolvedVariant) {
      config = { ...config, variant: resolvedVariant }
    }

    if (agentName === "librarian") {
      config = applyEnvironmentContext(config, directory)
    }

    config = applyOverrides(config, typedOverride, mergedCategories, {
      gitMasterConfig,
      browserProvider,
    })

    pendingAgentConfigs.set(name, config)

    const metadata = agentMetadata[agentName]
    if (metadata) {
      availableAgents.push({
        name: agentName,
        description: config.description ?? "",
        metadata,
      })
    }
  }

  return { pendingAgentConfigs, availableAgents }
}
