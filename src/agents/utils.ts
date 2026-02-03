import type { AgentConfig } from "@opencode-ai/sdk"
import type { BuiltinAgentName, AgentOverrideConfig, AgentOverrides, AgentFactory, AgentPromptMetadata } from "./types"
import type { CategoriesConfig, CategoryConfig, GitMasterConfig, BrowserAutomationProvider } from "../config/schema"
import { createSisyphusAgent } from "./sisyphus"
import { createOracleAgent, ORACLE_PROMPT_METADATA } from "./oracle"
import { createLibrarianAgent, LIBRARIAN_PROMPT_METADATA } from "./librarian"
import { createExploreAgent, EXPLORE_PROMPT_METADATA } from "./explore"
import { createMultimodalLookerAgent, MULTIMODAL_LOOKER_PROMPT_METADATA } from "./multimodal-looker"
import { createAtlasAgent } from "./atlas"
import { createPlanSynthesizerAgent, planSynthesizerPromptMetadata } from "./plan-synthesizer"
import { createHephaestusAgent, HEPHAESTUS_PROMPT_METADATA } from "./hephaestus"
import type { AvailableAgent, AvailableCategory, AvailableSkill } from "./dynamic-agent-prompt-builder"
import { deepMerge, fetchAvailableModels, resolveModelPipeline, AGENT_MODEL_REQUIREMENTS, readConnectedProvidersCache, isModelAvailable, isAnyFallbackModelAvailable } from "../shared"
import { DEFAULT_CATEGORIES, CATEGORY_DESCRIPTIONS } from "../tools/delegate-task/constants"
import { resolveMultipleSkills } from "../features/opencode-skill-loader/skill-content"
import { createBuiltinSkills } from "../features/builtin-skills"
import type { LoadedSkill, SkillScope } from "../features/opencode-skill-loader/types"

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
  hephaestus: createHephaestusAgent,
  oracle: createOracleAgent,
  librarian: createLibrarianAgent,
  explore: createExploreAgent,
  "multimodal-looker": createMultimodalLookerAgent,
  // Note: Atlas is handled specially in createBuiltinAgents()
  // because it needs OrchestratorContext, not just a model string
  atlas: createAtlasAgent as unknown as AgentFactory,
  "plan-synthesizer": createPlanSynthesizerAgent,
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
  "plan-synthesizer": planSynthesizerPromptMetadata,
  hephaestus: HEPHAESTUS_PROMPT_METADATA,
}

function isFactory(source: AgentSource): source is AgentFactory {
  return typeof source === "function"
}

export function buildAgent(
  source: AgentSource,
  model: string,
  categories?: CategoriesConfig,
  gitMasterConfig?: GitMasterConfig,
  browserProvider?: BrowserAutomationProvider
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
    const { resolved } = resolveMultipleSkills(agentWithCategory.skills, { gitMasterConfig, browserProvider })
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
}) {
  const entry = requirement?.fallbackChain?.[0]
  if (!entry || entry.providers.length === 0) return undefined
  return {
    model: `${entry.providers[0]}/${entry.model}`,
    provenance: "provider-fallback" as const,
    variant: entry.variant,
  }
}

/**
 * Expands a category reference from an agent override into concrete config properties.
 * Category properties are applied unconditionally (overwriting factory defaults),
 * because the user's chosen category should take priority over factory base values.
 * Direct override properties applied later via mergeAgentConfig() will supersede these.
 */
function applyCategoryOverride(
  config: AgentConfig,
  categoryName: string,
  mergedCategories: Record<string, CategoryConfig>
): AgentConfig {
  const categoryConfig = mergedCategories[categoryName]
  if (!categoryConfig) return config

  const result = { ...config } as AgentConfig & Record<string, unknown>
  if (categoryConfig.model) result.model = categoryConfig.model
  if (categoryConfig.variant !== undefined) result.variant = categoryConfig.variant
  if (categoryConfig.temperature !== undefined) result.temperature = categoryConfig.temperature
  if (categoryConfig.reasoningEffort !== undefined) result.reasoningEffort = categoryConfig.reasoningEffort
  if (categoryConfig.textVerbosity !== undefined) result.textVerbosity = categoryConfig.textVerbosity
  if (categoryConfig.thinking !== undefined) result.thinking = categoryConfig.thinking
  if (categoryConfig.top_p !== undefined) result.top_p = categoryConfig.top_p
  if (categoryConfig.maxTokens !== undefined) result.maxTokens = categoryConfig.maxTokens

  return result as AgentConfig
}

function applyModelResolution(input: {
  uiSelectedModel?: string
  userModel?: string
  categoryDefaultModel?: string
  requirement?: { fallbackChain?: { providers: string[]; model: string; variant?: string }[] }
  availableModels: Set<string>
  systemDefaultModel?: string
}) {
  const { uiSelectedModel, userModel, categoryDefaultModel, requirement, availableModels, systemDefaultModel } = input
  return resolveModelPipeline({
    intent: { uiSelectedModel, userModel, categoryDefaultModel },
    constraints: { availableModels },
    policy: { fallbackChain: requirement?.fallbackChain, systemDefaultModel },
  })
}

function applyEnvironmentContext(config: AgentConfig, directory?: string): AgentConfig {
  if (!directory || !config.prompt) return config
  const envContext = createEnvContext()
  return { ...config, prompt: config.prompt + envContext }
}

function applyOverrides(
  config: AgentConfig,
  override: AgentOverrideConfig | undefined,
  mergedCategories: Record<string, CategoryConfig>,
  options: { gitMasterConfig?: GitMasterConfig; browserProvider?: BrowserAutomationProvider } = {}
): AgentConfig {
  const originalSkills = (config as AgentConfig & { skills?: string[] }).skills

  let result = config
  if (override?.category) {
    result = applyCategoryOverride(result, override.category, mergedCategories)
  }

  if (override) {
    result = mergeAgentConfig(result, override)
  }

  const overrideSkills = override?.skills
  if (overrideSkills?.length && result.prompt) {
    const shouldInject =
      !Array.isArray(originalSkills) ||
      originalSkills.length === 0 ||
      originalSkills.join("\n") !== overrideSkills.join("\n")

    if (shouldInject) {
      const { resolved } = resolveMultipleSkills(overrideSkills, {
        gitMasterConfig: options.gitMasterConfig,
        browserProvider: options.browserProvider,
      })
      if (resolved.size > 0) {
        const skillContent = Array.from(resolved.values()).join("\n\n")
        result = {
          ...result,
          prompt: skillContent + (result.prompt ? "\n\n" + result.prompt : ""),
        } as AgentConfig
      }
    }
  }

  return result
}

function mergeAgentConfig(
  base: AgentConfig,
  override: AgentOverrideConfig
): AgentConfig {
  const { prompt_append, model, ...rest } = override
  const normalizedModel = model === undefined ? undefined : extractSingleModel(model)
  const merged = deepMerge(
    base,
    { ...rest, ...(normalizedModel ? { model: normalizedModel } : {}) } as Partial<AgentConfig>,
  )

  if (prompt_append && merged.prompt) {
    merged.prompt = merged.prompt + "\n" + prompt_append
  }

  return merged
}

function mapScopeToLocation(scope: SkillScope): AvailableSkill["location"] {
  if (scope === "user" || scope === "opencode") return "user"
  if (scope === "project" || scope === "opencode-project") return "project"
  return "plugin"
}

export async function createBuiltinAgents(
  disabledAgents: string[] = [],
  agentOverrides: AgentOverrides = {},
  directory?: string,
  systemDefaultModel?: string,
  categories?: CategoriesConfig,
  gitMasterConfig?: GitMasterConfig,
  discoveredSkills: LoadedSkill[] = [],
  _client?: unknown,
  browserProvider?: BrowserAutomationProvider,
  uiSelectedModel?: string
): Promise<Record<string, AgentConfig>> {
  const connectedProviders = readConnectedProvidersCache()
  // IMPORTANT: Do NOT pass client to fetchAvailableModels during plugin initialization.
  // This function is called from config handler, and calling client API causes deadlock.
  // See: https://github.com/code-yeongyu/oh-my-opencode/issues/1301
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
    description: categories?.[name]?.description ?? CATEGORY_DESCRIPTIONS[name] ?? "General tasks",
  }))

  const builtinSkills = createBuiltinSkills({ browserProvider })
  const builtinSkillNames = new Set(builtinSkills.map((s) => s.name))

  const builtinAvailable: AvailableSkill[] = builtinSkills.map((skill) => ({
    name: skill.name,
    description: skill.description,
    location: "plugin" as const,
  }))

  const discoveredAvailable: AvailableSkill[] = discoveredSkills
    .filter((s) => !builtinSkillNames.has(s.name))
    .map((skill) => ({
      name: skill.name,
      description: skill.definition.description ?? "",
      location: mapScopeToLocation(skill.scope),
    }))

  const availableSkills: AvailableSkill[] = [...builtinAvailable, ...discoveredAvailable]

  // Collect general agents first (for availableAgents), but don't add to result yet
  const pendingAgentConfigs: Map<string, AgentConfig> = new Map()

  for (const [name, source] of Object.entries(agentSources)) {
    const agentName = name as BuiltinAgentName

    if (agentName === "sisyphus") continue
    if (agentName === "hephaestus") continue
    if (agentName === "atlas") continue
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
      uiSelectedModel: isPrimaryAgent ? uiSelectedModel : undefined,
      userModel: typedOverride?.model ? extractSingleModel(typedOverride.model) : undefined,
      categoryDefaultModel: typedOverride?.category ? mergedCategories[typedOverride.category]?.model : undefined,
      requirement,
      availableModels,
      systemDefaultModel,
    })
    if (!resolution) continue
    const { model, variant: resolvedVariant } = resolution

    let config = buildAgent(source, model, mergedCategories, gitMasterConfig, browserProvider)
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

  let hephaestusConfig: AgentConfig | undefined
  if (!disabledAgents.some((name) => name.toLowerCase() === "hephaestus")) {
    const hephaestusOverride = agentOverrides["hephaestus"]
      ?? Object.entries(agentOverrides).find(([key]) => key.toLowerCase() === "hephaestus")?.[1]
    const typedHephaestusOverride = hephaestusOverride as AgentOverrideConfig | undefined
    const hephaestusRequirement = AGENT_MODEL_REQUIREMENTS["hephaestus"]
    const hasHephaestusExplicitConfig = typedHephaestusOverride !== undefined

    const hasRequiredModel =
      !hephaestusRequirement?.requiresModel ||
      hasHephaestusExplicitConfig ||
      isFirstRunNoCache ||
      (availableModels.size > 0 && isModelAvailable(hephaestusRequirement.requiresModel, availableModels))

    if (hasRequiredModel) {
      let hephaestusResolution = applyModelResolution({
        userModel: typedHephaestusOverride?.model ? extractSingleModel(typedHephaestusOverride.model) : undefined,
        categoryDefaultModel: typedHephaestusOverride?.category ? mergedCategories[typedHephaestusOverride.category]?.model : undefined,
        requirement: hephaestusRequirement,
        availableModels,
        systemDefaultModel,
      })

      if (isFirstRunNoCache && !typedHephaestusOverride?.model) {
        hephaestusResolution = getFirstFallbackModel(hephaestusRequirement)
      }

      if (hephaestusResolution) {
        const { model: hephaestusModel, variant: hephaestusResolvedVariant } = hephaestusResolution

        let built = createHephaestusAgent(
          hephaestusModel,
          availableAgents,
          undefined,
          availableSkills,
          availableCategories
        )
        built = { ...built, variant: hephaestusResolvedVariant ?? "medium" }

        built = applyEnvironmentContext(built, directory)
        hephaestusConfig = applyOverrides(built, typedHephaestusOverride, mergedCategories, {
          gitMasterConfig,
          browserProvider,
        })

        const metadata = agentMetadata["hephaestus"]
        if (metadata) {
          availableAgents.push({
            name: "hephaestus",
            description: hephaestusConfig.description ?? "",
            metadata,
          })
        }
      }
    }
  }

  const sisyphusOverride = agentOverrides["sisyphus"]
    ?? Object.entries(agentOverrides).find(([key]) => key.toLowerCase() === "sisyphus")?.[1]
  const typedSisyphusOverride = sisyphusOverride as AgentOverrideConfig | undefined
  const sisyphusRequirement = AGENT_MODEL_REQUIREMENTS["sisyphus"]
  const hasSisyphusExplicitConfig = typedSisyphusOverride !== undefined
  const meetsSisyphusAnyModelRequirement =
    !sisyphusRequirement?.requiresAnyModel ||
    hasSisyphusExplicitConfig ||
    isFirstRunNoCache ||
    isAnyFallbackModelAvailable(sisyphusRequirement.fallbackChain, availableModels)

  if (!disabledAgents.some((name) => name.toLowerCase() === "sisyphus") && meetsSisyphusAnyModelRequirement) {
    let sisyphusResolution = applyModelResolution({
      uiSelectedModel,
      userModel: typedSisyphusOverride?.model ? extractSingleModel(typedSisyphusOverride.model) : undefined,
      categoryDefaultModel: typedSisyphusOverride?.category ? mergedCategories[typedSisyphusOverride.category]?.model : undefined,
      requirement: sisyphusRequirement,
      availableModels,
      systemDefaultModel,
    })

    if (isFirstRunNoCache && !typedSisyphusOverride?.model && !uiSelectedModel) {
      sisyphusResolution = getFirstFallbackModel(sisyphusRequirement)
    }

    if (sisyphusResolution) {
      const { model: sisyphusModel, variant: sisyphusResolvedVariant } = sisyphusResolution
      let sisyphusConfig = createSisyphusAgent(
        sisyphusModel,
        availableAgents,
        undefined,
        availableSkills,
        availableCategories
      )

      if (sisyphusResolvedVariant) {
        sisyphusConfig = { ...sisyphusConfig, variant: sisyphusResolvedVariant }
      }

      sisyphusConfig = applyOverrides(sisyphusConfig, typedSisyphusOverride, mergedCategories, {
        gitMasterConfig,
        browserProvider,
      })
      sisyphusConfig = applyEnvironmentContext(sisyphusConfig, directory)

      result["sisyphus"] = sisyphusConfig
    }
  }

  if (hephaestusConfig) {
    result["hephaestus"] = hephaestusConfig
  }

  for (const [name, config] of pendingAgentConfigs) {
    result[name] = config
  }

  if (!disabledAgents.some((name) => name.toLowerCase() === "atlas")) {
    const orchestratorOverride = agentOverrides["atlas"]
      ?? Object.entries(agentOverrides).find(([key]) => key.toLowerCase() === "atlas")?.[1]
    const typedOrchestratorOverride = orchestratorOverride as AgentOverrideConfig | undefined
    const atlasRequirement = AGENT_MODEL_REQUIREMENTS["atlas"]

    const atlasResolution = applyModelResolution({
      // NOTE: Atlas does NOT use uiSelectedModel - respects its own fallbackChain
      userModel: typedOrchestratorOverride?.model ? extractSingleModel(typedOrchestratorOverride.model) : undefined,
      categoryDefaultModel: typedOrchestratorOverride?.category ? mergedCategories[typedOrchestratorOverride.category]?.model : undefined,
      requirement: atlasRequirement,
      availableModels,
      systemDefaultModel,
    })

    if (atlasResolution) {
      const { model: atlasModel, variant: atlasResolvedVariant } = atlasResolution

      let orchestratorConfig = createAtlasAgent({
        model: atlasModel,
        availableAgents,
        availableSkills,
        userCategories: categories,
      })

      if (atlasResolvedVariant) {
        orchestratorConfig = { ...orchestratorConfig, variant: atlasResolvedVariant }
      }

      orchestratorConfig = applyOverrides(orchestratorConfig, typedOrchestratorOverride, mergedCategories, {
        gitMasterConfig,
        browserProvider,
      })

      result["atlas"] = orchestratorConfig
    }
  }

  return result
}
