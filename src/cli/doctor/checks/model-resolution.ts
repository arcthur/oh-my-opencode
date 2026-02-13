import { readFileSync, existsSync, readdirSync, statSync } from "node:fs"
import type { CheckResult, CheckDefinition } from "../types"
import { CHECK_IDS, CHECK_NAMES } from "../constants"
import { deepMerge, getOpenCodeConfigPaths, parseJsonc } from "../../../shared"
import {
  AGENT_MODEL_REQUIREMENTS,
  CATEGORY_MODEL_REQUIREMENTS,
  type ModelRequirement,
} from "../../../shared/model-requirements"
import { homedir } from "node:os"
import { join } from "node:path"

function getOpenCodeCacheDir(): string {
  const xdgCache = process.env.XDG_CACHE_HOME
  if (xdgCache) return join(xdgCache, "opencode")
  return join(homedir(), ".cache", "opencode")
}

function loadAvailableModels(): { providers: string[]; modelCount: number; cacheExists: boolean } {
  const cacheFile = join(getOpenCodeCacheDir(), "models.json")
  
  if (!existsSync(cacheFile)) {
    return { providers: [], modelCount: 0, cacheExists: false }
  }

  try {
    const content = readFileSync(cacheFile, "utf-8")
    const data = parseJsonc<Record<string, { models?: Record<string, unknown> }>>(content)
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      return { providers: [], modelCount: 0, cacheExists: false }
    }

    const providers = Object.keys(data)
    let modelCount = 0
    for (const providerId of providers) {
      const models = data[providerId]?.models
      if (models && typeof models === "object") {
        modelCount += Object.keys(models).length
      }
    }
    
    return { providers, modelCount, cacheExists: true }
  } catch {
    return { providers: [], modelCount: 0, cacheExists: false }
  }
}

const PACKAGE_NAME = "oh-my-opencode"

function getUserConfigBase(): string {
  return join(
    getOpenCodeConfigPaths({ binary: "opencode", version: null }).configDir,
    PACKAGE_NAME
  )
}

function getProjectConfigBase(cwd = process.cwd()): string {
  return join(cwd, ".opencode", PACKAGE_NAME)
}

export interface AgentResolutionInfo {
  name: string
  requirement: ModelRequirement
  userOverride?: string
  userVariant?: string
  effectiveModel: string
  effectiveResolution: string
}

export interface CategoryResolutionInfo {
  name: string
  requirement: ModelRequirement
  userOverride?: string
  userVariant?: string
  effectiveModel: string
  effectiveResolution: string
}

export interface ModelResolutionInfo {
  agents: AgentResolutionInfo[]
  categories: CategoryResolutionInfo[]
}

interface OmoConfig {
  agents?: Record<string, { model?: string; variant?: string }>
  categories?: Record<string, { model?: string; variant?: string }>
}

function loadConfig(): OmoConfig | null {
  const sources = [getProjectConfigBase(), getUserConfigBase()]

  for (const source of sources) {
    if (!existsSync(source)) continue

    try {
      const stat = statSync(source)
      if (!stat.isDirectory()) continue

      const moduleFiles = readdirSync(source, { withFileTypes: true })
        .filter((entry) => entry.isFile() && (entry.name.endsWith(".json") || entry.name.endsWith(".jsonc")))
        .map((entry) => entry.name)
        .sort()

      if (moduleFiles.length === 0) continue

      let mergedConfig: Record<string, unknown> = {}
      for (const moduleFile of moduleFiles) {
        const modulePath = join(source, moduleFile)
        const content = readFileSync(modulePath, "utf-8")
        const parsed = parseJsonc<unknown>(content)
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          mergedConfig = deepMerge(mergedConfig, parsed as Record<string, unknown>) ?? mergedConfig
        }
      }

      return mergedConfig as OmoConfig
    } catch {
      continue
    }
  }

  return null
}

function formatProviderChain(providers: string[]): string {
  return providers.join(" → ")
}

function getEffectiveModel(requirement: ModelRequirement, userOverride?: string): string {
  if (userOverride) {
    return userOverride
  }
  const firstEntry = requirement.fallbackChain[0]
  if (!firstEntry) {
    return "unknown"
  }
  return `${firstEntry.providers[0]}/${firstEntry.model}`
}

function buildEffectiveResolution(
  requirement: ModelRequirement,
  userOverride?: string,
): string {
  if (userOverride) {
    return `User override: ${userOverride}`
  }
  const firstEntry = requirement.fallbackChain[0]
  if (!firstEntry) {
    return "No fallback chain defined"
  }
  return `Provider fallback: ${formatProviderChain(firstEntry.providers)} → ${firstEntry.model}`
}

export function getModelResolutionInfo(): ModelResolutionInfo {
  const agents: AgentResolutionInfo[] = Object.entries(AGENT_MODEL_REQUIREMENTS).map(
    ([name, requirement]) => ({
      name,
      requirement,
      effectiveModel: getEffectiveModel(requirement),
      effectiveResolution: buildEffectiveResolution(requirement),
    }),
  )

  const categories: CategoryResolutionInfo[] = Object.entries(CATEGORY_MODEL_REQUIREMENTS).map(
    ([name, requirement]) => ({
      name,
      requirement,
      effectiveModel: getEffectiveModel(requirement),
      effectiveResolution: buildEffectiveResolution(requirement),
    }),
  )

  return { agents, categories }
}

export function getModelResolutionInfoWithOverrides(config: OmoConfig): ModelResolutionInfo {
  const agents: AgentResolutionInfo[] = Object.entries(AGENT_MODEL_REQUIREMENTS).map(
    ([name, requirement]) => {
      const userOverride = config.agents?.[name]?.model
      const userVariant = config.agents?.[name]?.variant
      return {
        name,
        requirement,
        userOverride,
        userVariant,
        effectiveModel: getEffectiveModel(requirement, userOverride),
        effectiveResolution: buildEffectiveResolution(requirement, userOverride),
      }
    },
  )

  const categories: CategoryResolutionInfo[] = Object.entries(CATEGORY_MODEL_REQUIREMENTS).map(
    ([name, requirement]) => {
      const userOverride = config.categories?.[name]?.model
      const userVariant = config.categories?.[name]?.variant
      return {
        name,
        requirement,
        userOverride,
        userVariant,
        effectiveModel: getEffectiveModel(requirement, userOverride),
        effectiveResolution: buildEffectiveResolution(requirement, userOverride),
      }
    },
  )

  return { agents, categories }
}

function formatModelWithVariant(model: string, variant?: string): string {
  return variant ? `${model} (${variant})` : model
}

function getEffectiveVariant(requirement: ModelRequirement, userVariant?: string): string | undefined {
  if (userVariant) {
    return userVariant
  }
  const firstEntry = requirement.fallbackChain[0]
  return firstEntry?.variant ?? requirement.variant
}

interface AvailableModelsInfo {
  providers: string[]
  modelCount: number
  cacheExists: boolean
}

function buildDetailsArray(info: ModelResolutionInfo, available: AvailableModelsInfo): string[] {
  const details: string[] = []
  const cacheFilePath = join(getOpenCodeCacheDir(), "models.json")

  details.push("═══ Available Models (from cache) ═══")
  details.push("")
  if (available.cacheExists) {
    details.push(`  Providers in cache: ${available.providers.length}`)
    details.push(`  Sample: ${available.providers.slice(0, 6).join(", ")}${available.providers.length > 6 ? "..." : ""}`)
    details.push(`  Total models: ${available.modelCount}`)
    details.push(`  Cache: ${cacheFilePath}`)
    details.push(`  ℹ Runtime: only connected providers used`)
    details.push(`  Refresh: opencode models --refresh`)
  } else {
    details.push("  ⚠ Cache not found. Run 'opencode' to populate.")
  }
  details.push("")

  details.push("═══ Configured Models ═══")
  details.push("")
  details.push("Agents:")
  for (const agent of info.agents) {
    const marker = agent.userOverride ? "●" : "○"
    const display = formatModelWithVariant(
      agent.effectiveModel,
      getEffectiveVariant(agent.requirement, agent.userVariant)
    )
    details.push(`  ${marker} ${agent.name}: ${display}`)
  }
  details.push("")
  details.push("Categories:")
  for (const category of info.categories) {
    const marker = category.userOverride ? "●" : "○"
    const display = formatModelWithVariant(
      category.effectiveModel,
      getEffectiveVariant(category.requirement, category.userVariant)
    )
    details.push(`  ${marker} ${category.name}: ${display}`)
  }
  details.push("")
  details.push("● = user override, ○ = provider fallback")

  return details
}

export async function checkModelResolution(): Promise<CheckResult> {
  const config = loadConfig() ?? {}
  const info = getModelResolutionInfoWithOverrides(config)
  const available = loadAvailableModels()

  const agentCount = info.agents.length
  const categoryCount = info.categories.length
  const agentOverrides = info.agents.filter((a) => a.userOverride).length
  const categoryOverrides = info.categories.filter((c) => c.userOverride).length
  const totalOverrides = agentOverrides + categoryOverrides

  const overrideNote = totalOverrides > 0 ? ` (${totalOverrides} override${totalOverrides > 1 ? "s" : ""})` : ""
  const cacheNote = available.cacheExists ? `, ${available.modelCount} available` : ", cache not found"

  return {
    name: CHECK_NAMES[CHECK_IDS.MODEL_RESOLUTION],
    status: available.cacheExists ? "pass" : "warn",
    message: `${agentCount} agents, ${categoryCount} categories${overrideNote}${cacheNote}`,
    details: buildDetailsArray(info, available),
  }
}

export function getModelResolutionCheckDefinition(): CheckDefinition {
  return {
    id: CHECK_IDS.MODEL_RESOLUTION,
    name: CHECK_NAMES[CHECK_IDS.MODEL_RESOLUTION],
    category: "configuration",
    check: checkModelResolution,
    critical: false,
  }
}
