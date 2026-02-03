import type { AgentConfig } from "@opencode-ai/sdk"
import type { BuiltinAgentName, AgentOverrideConfig, AgentOverrides, AgentFactory, AgentPromptMetadata } from "./types"
import type { CategoriesConfig, CategoryConfig, GitMasterConfig } from "../config/schema"
import { createSisyphusAgent } from "./sisyphus"
import { createOracleAgent, ORACLE_PROMPT_METADATA } from "./oracle"
import { createLibrarianAgent, LIBRARIAN_PROMPT_METADATA } from "./librarian"
import { createExploreAgent, EXPLORE_PROMPT_METADATA } from "./explore"
import { createMultimodalLookerAgent, MULTIMODAL_LOOKER_PROMPT_METADATA } from "./multimodal-looker"
import { createAtlasAgent } from "./atlas"
import { createPlanSynthesizerAgent } from "./plan-synthesizer"
import { createHephaestusAgent } from "./hephaestus"
import type { AvailableAgent, AvailableCategory, AvailableSkill } from "./dynamic-agent-prompt-builder"
import { deepMerge, AGENT_MODEL_REQUIREMENTS, isModelAvailable, isAnyFallbackModelAvailable, resolveModelWithFallback, findCaseInsensitive, includesCaseInsensitive, fetchAvailableModels, readConnectedProvidersCache } from "../shared"
import { DEFAULT_CATEGORIES, CATEGORY_DESCRIPTIONS } from "../tools/delegate-task/constants"
import { resolveMultipleSkills } from "../features/opencode-skill-loader/skill-content"

type AgentSource = AgentFactory | AgentConfig

/**
 * Extracts a single model string from model specification.
 * Only Prometheus supports multi-model arrays; other agents use the first element.
 */
function extractSingleModel(model: string | string[]): string {
  return Array.isArray(model) ? model[0] : model
}

const agentSources: Record<BuiltinAgentName, AgentSource> = {
  sisyphus: createSisyphusAgent,
  oracle: createOracleAgent,
  librarian: createLibrarianAgent,
  explore: createExploreAgent,
  "multimodal-looker": createMultimodalLookerAgent,
  // Note: Atlas is handled specially in createBuiltinAgents()
  // because it needs OrchestratorContext, not just a model string
  atlas: createAtlasAgent as unknown as AgentFactory,
  "plan-synthesizer": createPlanSynthesizerAgent,
  hephaestus: createHephaestusAgent,
}

/**
 * Metadata for each agent, used to build Sisyphus's dynamic prompt sections
 * (Delegation Table, Tool Selection, Key Triggers, etc.)
 */
const agentMetadata: Partial<Record<BuiltinAgentName, AgentPromptMetadata>> = {
  oracle: ORACLE_PROMPT_METADATA,
  librarian: LIBRARIAN_PROMPT_METADATA,
  explore: EXPLORE_PROMPT_METADATA,
  "multimodal-looker": MULTIMODAL_LOOKER_PROMPT_METADATA,
}

function isFactory(source: AgentSource): source is AgentFactory {
  return typeof source === "function"
}

export function buildAgent(
  source: AgentSource,
  model: string,
  categories?: CategoriesConfig,
  gitMasterConfig?: GitMasterConfig
): AgentConfig {
  const base = isFactory(source) ? source(model) : source
  const categoryConfigs: Record<string, CategoryConfig> = categories
    ? { ...DEFAULT_CATEGORIES, ...categories }
    : DEFAULT_CATEGORIES

  const agentWithCategory = base as AgentConfig & { category?: string; skills?: string[]; variant?: string }
  if (agentWithCategory.category) {
    const categoryConfig = categoryConfigs[agentWithCategory.category]
    if (categoryConfig) {
      if (!base.model) {
        base.model = categoryConfig.model
      }
      if (base.temperature === undefined && categoryConfig.temperature !== undefined) {
        base.temperature = categoryConfig.temperature
      }
      if (base.variant === undefined && categoryConfig.variant !== undefined) {
        base.variant = categoryConfig.variant
      }
    }
  }

  if (agentWithCategory.skills?.length) {
    const { resolved } = resolveMultipleSkills(agentWithCategory.skills, { gitMasterConfig })
    if (resolved.size > 0) {
      const skillContent = Array.from(resolved.values()).join("\n\n")
      base.prompt = skillContent + (base.prompt ? "\n\n" + base.prompt : "")
    }
  }

  return base
}

/**
 * Creates OmO-specific environment context (time, timezone, locale).
 * Note: Working directory, platform, and date are already provided by OpenCode's system.ts,
 * so we only include fields that OpenCode doesn't provide to avoid duplication.
 * See: https://github.com/code-yeongyu/oh-my-opencode/issues/379
 */
export function createEnvContext(): string {
  const now = new Date()
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone
  const locale = Intl.DateTimeFormat().resolvedOptions().locale

  const dateStr = now.toLocaleDateString(locale, {
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
  })

  const timeStr = now.toLocaleTimeString(locale, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  })

  return `
<omo-env>
  Current date: ${dateStr}
  Current time: ${timeStr}
  Timezone: ${timezone}
  Locale: ${locale}
</omo-env>`
}

/**
 * Get the first model from a fallback chain for first-run scenarios.
 * When no providers are connected and no cache exists, use this to provide
 * a sensible default model so agents are still visible/usable.
 */
function getFirstFallbackModel(requirement?: {
  fallbackChain?: { providers: string[]; model: string; variant?: string }[]
}): { model: string; variant?: string } | undefined {
  const entry = requirement?.fallbackChain?.[0]
  if (!entry || entry.providers.length === 0) return undefined
  return {
    model: `${entry.providers[0]}/${entry.model}`,
    variant: entry.variant,
  }
}

function mergeAgentConfig(
  base: AgentConfig,
  override: AgentOverrideConfig
): AgentConfig {
  const { prompt_append, ...rest } = override
  const merged = deepMerge(base, rest as Partial<AgentConfig>)

  if (prompt_append && merged.prompt) {
    merged.prompt = merged.prompt + "\n" + prompt_append
  }

  return merged
}

export async function createBuiltinAgents(
  disabledAgents: BuiltinAgentName[] = [],
  agentOverrides: AgentOverrides = {},
  directory?: string,
  systemDefaultModel?: string,
  categories?: CategoriesConfig,
  gitMasterConfig?: GitMasterConfig,
  availableSkills: AvailableSkill[] = []
): Promise<Record<string, AgentConfig>> {
  if (!systemDefaultModel) {
    throw new Error("createBuiltinAgents requires systemDefaultModel")
  }

  // Fetch available models from cache (no client API call to avoid deadlock)
  // See: https://github.com/code-yeongyu/oh-my-opencode/issues/1301
  const connectedProviders = readConnectedProvidersCache()
  const availableModels = await fetchAvailableModels(undefined, {
    connectedProviders: connectedProviders ?? undefined,
  })
  const isFirstRunNoCache =
    availableModels.size === 0 && (!connectedProviders || connectedProviders.length === 0)

  const result: Record<string, AgentConfig> = {}
  const availableAgents: AvailableAgent[] = []

  const mergedCategories = categories
    ? { ...DEFAULT_CATEGORIES, ...categories }
    : DEFAULT_CATEGORIES

  const availableCategories: AvailableCategory[] = Object.entries(mergedCategories).map(([name]) => ({
    name,
    description: CATEGORY_DESCRIPTIONS[name] ?? "General tasks",
  }))

  for (const [name, source] of Object.entries(agentSources)) {
    const agentName = name as BuiltinAgentName

    if (agentName === "sisyphus") continue
    if (agentName === "hephaestus") continue // Handle separately with model requirement check
    if (agentName === "atlas") continue
    // Use case-insensitive matching for disabled agents
    if (includesCaseInsensitive(disabledAgents, agentName)) continue

    // Use case-insensitive lookup for agent overrides
    // Cast to AgentOverrideConfig since we're not handling prometheus here (which has array model)
    const override = findCaseInsensitive(agentOverrides, agentName) as AgentOverrideConfig | undefined
    const requirement = AGENT_MODEL_REQUIREMENTS[agentName]

    // Check if agent requires a specific model
    if (requirement?.requiresModel && availableModels) {
      if (!isModelAvailable(requirement.requiresModel, availableModels)) {
        continue
      }
    }

    // Use resolveModelWithFallback when availableModels is provided and agent has fallback chain
    // extractSingleModel handles array models (only Prometheus uses arrays)
    const userModelOverride = override?.model ? extractSingleModel(override.model) : undefined
    let model: string
    if (availableModels && availableModels.size > 0 && requirement?.fallbackChain) {
      const resolved = resolveModelWithFallback({
        userModel: userModelOverride,
        fallbackChain: requirement.fallbackChain,
        availableModels,
        systemDefaultModel,
      })
      model = resolved.model
    } else {
      model = userModelOverride ?? systemDefaultModel
    }

    let config = buildAgent(source, model, mergedCategories, gitMasterConfig)

    // Apply variant from override or requirement
    if (override?.variant) {
      config = { ...config, variant: override.variant }
    } else if (requirement?.variant) {
      config = { ...config, variant: requirement.variant }
    }

    if (agentName === "librarian" && directory && config.prompt) {
      const envContext = createEnvContext()
      config = { ...config, prompt: config.prompt + envContext }
    }

    if (override) {
      config = mergeAgentConfig(config, override)
    }

    result[name] = config

    const metadata = agentMetadata[agentName]
    if (metadata) {
      availableAgents.push({
        name: agentName,
        description: config.description ?? "",
        metadata,
      })
    }
  }

  // Handle Hephaestus with model requirement check
  // Hephaestus requires gpt-5.2-codex - only create if model is available or user has explicit config
  // Also create on first-run (no cache) for better UX
  if (!includesCaseInsensitive(disabledAgents, "hephaestus")) {
    const hephaestusOverride = findCaseInsensitive(agentOverrides, "hephaestus") as AgentOverrideConfig | undefined
    const hephaestusRequirement = AGENT_MODEL_REQUIREMENTS["hephaestus"]
    const hasHephaestusExplicitConfig = hephaestusOverride !== undefined

    const hasRequiredModel =
      !hephaestusRequirement?.requiresModel ||
      hasHephaestusExplicitConfig ||
      isFirstRunNoCache ||
      (availableModels && availableModels.size > 0 && isModelAvailable(hephaestusRequirement.requiresModel, availableModels))

    if (hasRequiredModel) {
      // Use resolveModelWithFallback when availableModels is provided
      const hephaestusUserModel = hephaestusOverride?.model ? extractSingleModel(hephaestusOverride.model) : undefined
      let hephaestusModel: string
      let hephaestusFirstRunVariant: string | undefined
      if (availableModels && availableModels.size > 0 && hephaestusRequirement?.fallbackChain) {
        const resolved = resolveModelWithFallback({
          userModel: hephaestusUserModel,
          fallbackChain: hephaestusRequirement.fallbackChain,
          availableModels,
          systemDefaultModel,
        })
        hephaestusModel = resolved.model
      } else if (!hephaestusUserModel) {
        // First-run scenario: use fallback chain's first model
        const fallbackResult = getFirstFallbackModel(hephaestusRequirement)
        hephaestusModel = fallbackResult?.model ?? systemDefaultModel
        hephaestusFirstRunVariant = fallbackResult?.variant
      } else {
        hephaestusModel = hephaestusUserModel
      }

      let hephaestusConfig = createHephaestusAgent(
        hephaestusModel,
        availableAgents,
        undefined,
        availableSkills,
        availableCategories
      )

      // Apply variant: user override > first-run fallback variant > requirement default > "medium"
      if (hephaestusOverride?.variant) {
        hephaestusConfig = { ...hephaestusConfig, variant: hephaestusOverride.variant }
      } else if (hephaestusFirstRunVariant) {
        hephaestusConfig = { ...hephaestusConfig, variant: hephaestusFirstRunVariant }
      } else if (hephaestusRequirement?.variant) {
        hephaestusConfig = { ...hephaestusConfig, variant: hephaestusRequirement.variant }
      } else {
        hephaestusConfig = { ...hephaestusConfig, variant: hephaestusConfig.variant ?? "medium" }
      }

      if (hephaestusOverride) {
        hephaestusConfig = mergeAgentConfig(hephaestusConfig, hephaestusOverride)
      }

      result["hephaestus"] = hephaestusConfig
    }
  }

  // Handle Sisyphus with model requirement check
  // Sisyphus requires at least one model from its fallback chain
  if (!includesCaseInsensitive(disabledAgents, "sisyphus")) {
    const sisyphusOverride = findCaseInsensitive(agentOverrides, "sisyphus") as AgentOverrideConfig | undefined
    const sisyphusRequirement = AGENT_MODEL_REQUIREMENTS["sisyphus"]
    const hasSisyphusExplicitConfig = sisyphusOverride !== undefined

    const meetsSisyphusAnyModelRequirement =
      !sisyphusRequirement?.requiresAnyModel ||
      hasSisyphusExplicitConfig ||
      isFirstRunNoCache ||
      isAnyFallbackModelAvailable(sisyphusRequirement.fallbackChain, availableModels)

    if (meetsSisyphusAnyModelRequirement) {
      // Use resolveModelWithFallback when availableModels is provided
      const sisyphusUserModel = sisyphusOverride?.model ? extractSingleModel(sisyphusOverride.model) : undefined
      let sisyphusModel: string
      let sisyphusFirstRunVariant: string | undefined
      if (availableModels && availableModels.size > 0 && sisyphusRequirement?.fallbackChain) {
        const resolved = resolveModelWithFallback({
          userModel: sisyphusUserModel,
          fallbackChain: sisyphusRequirement.fallbackChain,
          availableModels,
          systemDefaultModel,
        })
        sisyphusModel = resolved.model
      } else if (!sisyphusUserModel) {
        // First-run scenario: no available models and no user config
        // Use fallback chain's first model for better UX
        const fallbackResult = getFirstFallbackModel(sisyphusRequirement)
        sisyphusModel = fallbackResult?.model ?? systemDefaultModel
        sisyphusFirstRunVariant = fallbackResult?.variant
      } else {
        sisyphusModel = sisyphusUserModel
      }

      let sisyphusConfig = createSisyphusAgent(
        sisyphusModel,
        availableAgents,
        undefined,
        availableSkills,
        availableCategories
      )

      // Apply variant: user override > first-run fallback variant > requirement default
      if (sisyphusOverride?.variant) {
        sisyphusConfig = { ...sisyphusConfig, variant: sisyphusOverride.variant }
      } else if (sisyphusFirstRunVariant) {
        sisyphusConfig = { ...sisyphusConfig, variant: sisyphusFirstRunVariant }
      } else if (sisyphusRequirement?.variant) {
        sisyphusConfig = { ...sisyphusConfig, variant: sisyphusRequirement.variant }
      }

      if (directory && sisyphusConfig.prompt) {
        const envContext = createEnvContext()
        sisyphusConfig = { ...sisyphusConfig, prompt: sisyphusConfig.prompt + envContext }
      }

      if (sisyphusOverride) {
        sisyphusConfig = mergeAgentConfig(sisyphusConfig, sisyphusOverride)
      }

      result["sisyphus"] = sisyphusConfig
    }
  }

  if (!includesCaseInsensitive(disabledAgents, "atlas")) {
    const orchestratorOverride = findCaseInsensitive(agentOverrides, "atlas") as AgentOverrideConfig | undefined
    const atlasRequirement = AGENT_MODEL_REQUIREMENTS["atlas"]

    // Use resolveModelWithFallback when availableModels is provided
    const atlasUserModel = orchestratorOverride?.model ? extractSingleModel(orchestratorOverride.model) : undefined
    let orchestratorModel: string
    if (availableModels && availableModels.size > 0 && atlasRequirement?.fallbackChain) {
      const resolved = resolveModelWithFallback({
        userModel: atlasUserModel,
        fallbackChain: atlasRequirement.fallbackChain,
        availableModels,
        systemDefaultModel,
      })
      orchestratorModel = resolved.model
    } else {
      orchestratorModel = atlasUserModel ?? systemDefaultModel
    }

    let orchestratorConfig = createAtlasAgent({
      model: orchestratorModel,
      availableAgents,
      availableSkills,
      userCategories: categories,
    })

    // Apply variant from override or requirement
    if (orchestratorOverride?.variant) {
      orchestratorConfig = { ...orchestratorConfig, variant: orchestratorOverride.variant }
    } else if (atlasRequirement?.variant) {
      orchestratorConfig = { ...orchestratorConfig, variant: atlasRequirement.variant }
    }

    if (orchestratorOverride) {
      orchestratorConfig = mergeAgentConfig(orchestratorConfig, orchestratorOverride)
    }

    result["atlas"] = orchestratorConfig
  }

  return result
}
