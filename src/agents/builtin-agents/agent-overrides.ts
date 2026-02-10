import type { AgentConfig } from "@opencode-ai/sdk"
import type { AgentOverrideConfig } from "../types"
import type { CategoryConfig, GitMasterConfig, BrowserAutomationProvider } from "../../config/schema"
import { deepMerge, migrateAgentConfig } from "../../shared"
import { resolveMultipleSkills } from "../../features/opencode-skill-loader/skill-content"

/**
 * Expands a category reference from an agent override into concrete config properties.
 * Category properties are applied unconditionally (overwriting factory defaults),
 * because the user's chosen category should take priority over factory base values.
 * Direct override properties applied later via mergeAgentConfig() will supersede these.
 */
export function applyCategoryOverride(
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

  if (categoryConfig.prompt_append && typeof result.prompt === "string") {
    result.prompt = result.prompt + "\n" + categoryConfig.prompt_append
  }

  return result as AgentConfig
}

function extractSingleModel(model: string | string[]): string {
  return Array.isArray(model) ? model[0] : model
}

export function mergeAgentConfig(base: AgentConfig, override: AgentOverrideConfig): AgentConfig {
  const migratedOverride = migrateAgentConfig(override as Record<string, unknown>) as AgentOverrideConfig
  const { prompt_append, model, ...rest } = migratedOverride
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

export function applyOverrides(
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
