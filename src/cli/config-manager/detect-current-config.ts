import { existsSync, readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"
import { deepMerge, parseJsonc } from "../../shared"
import type { DetectedConfig } from "../types"
import { getOmoConfigDirPath } from "./config-context"
import { normalizePluginList } from "./normalize-plugin-list"
import { detectConfigFormat } from "./opencode-config-format"
import { parseOpenCodeConfigFileWithError } from "./parse-opencode-config-file"

function isConfigObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function loadMergedOmoConfig(): Record<string, unknown> | null {
  const omoConfigDirPath = getOmoConfigDirPath()
  if (!existsSync(omoConfigDirPath)) {
    return null
  }

  try {
    const stat = statSync(omoConfigDirPath)
    if (!stat.isDirectory()) {
      return null
    }

    const moduleFiles = readdirSync(omoConfigDirPath, { withFileTypes: true })
      .filter((entry) => entry.isFile() && (entry.name.endsWith(".json") || entry.name.endsWith(".jsonc")))
      .map((entry) => entry.name)
      .sort()

    if (moduleFiles.length === 0) {
      return null
    }

    let mergedConfig: Record<string, unknown> = {}
    for (const moduleFile of moduleFiles) {
      const modulePath = join(omoConfigDirPath, moduleFile)
      const content = readFileSync(modulePath, "utf-8")
      const rawModule = parseJsonc<unknown>(content)
      if (!isConfigObject(rawModule)) {
        continue
      }
      mergedConfig = deepMerge(mergedConfig, rawModule) ?? mergedConfig
    }

    return mergedConfig
  } catch {
    return null
  }
}

function detectProvidersFromOmoConfig(): {
  hasOpenAI: boolean
  hasOpencodeZen: boolean
  hasZaiCodingPlan: boolean
  hasKimiForCoding: boolean
} {
  const omoConfig = loadMergedOmoConfig()
  if (!omoConfig) {
    return { hasOpenAI: false, hasOpencodeZen: false, hasZaiCodingPlan: false, hasKimiForCoding: false }
  }

  try {
    const configStr = JSON.stringify(omoConfig)
    const hasOpenAI = configStr.includes('"openai/')
    const hasOpencodeZen = configStr.includes('"opencode/')
    const hasZaiCodingPlan = configStr.includes('"zai-coding-plan/')
    const hasKimiForCoding = configStr.includes('"kimi-for-coding/')

    return { hasOpenAI, hasOpencodeZen, hasZaiCodingPlan, hasKimiForCoding }
  } catch {
    return { hasOpenAI: false, hasOpencodeZen: false, hasZaiCodingPlan: false, hasKimiForCoding: false }
  }
}

export function detectCurrentConfig(): DetectedConfig {
  const result: DetectedConfig = {
    isInstalled: false,
    hasClaude: false,
    isMax20: false,
    hasOpenAI: false,
    hasGemini: false,
    hasCopilot: false,
    hasOpencodeZen: false,
    hasZaiCodingPlan: false,
    hasKimiForCoding: false,
  }

  const { format, path } = detectConfigFormat()
  if (format === "none") {
    return result
  }

  const parseResult = parseOpenCodeConfigFileWithError(path)
  if (!parseResult.config) {
    return result
  }

  const openCodeConfig = parseResult.config
  const plugins = normalizePluginList(openCodeConfig.plugin)
  result.isInstalled = plugins.some((p) => p.startsWith("oh-my-opencode"))

  if (!result.isInstalled) {
    return result
  }

  result.hasGemini = plugins.some((p) => p.startsWith("opencode-antigravity-auth"))

  const { hasOpenAI, hasOpencodeZen, hasZaiCodingPlan, hasKimiForCoding } = detectProvidersFromOmoConfig()
  result.hasOpenAI = hasOpenAI
  result.hasOpencodeZen = hasOpencodeZen
  result.hasZaiCodingPlan = hasZaiCodingPlan
  result.hasKimiForCoding = hasKimiForCoding

  return result
}
