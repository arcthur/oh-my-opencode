import { existsSync, readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"
import type { CheckResult, CheckDefinition, ConfigInfo } from "../types"
import { CHECK_IDS, CHECK_NAMES, PACKAGE_NAME } from "../constants"
import { deepMerge, detectConfigFile, getOpenCodeConfigDir, parseJsonc } from "../../../shared"
import { validateStrictOhMyOpenCodeConfig } from "../../../config"

const USER_CONFIG_DIR = getOpenCodeConfigDir({ binary: "opencode" })
const USER_CONFIG_BASE = join(USER_CONFIG_DIR, PACKAGE_NAME)
const PROJECT_CONFIG_BASE = join(process.cwd(), ".opencode", PACKAGE_NAME)

function listConfigModules(configDir: string): string[] {
  if (!existsSync(configDir)) return []
  try {
    const stat = statSync(configDir)
    if (!stat.isDirectory()) return []

    return readdirSync(configDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && (entry.name.endsWith(".json") || entry.name.endsWith(".jsonc")))
      .map((entry) => join(configDir, entry.name))
      .sort()
  } catch {
    return []
  }
}

function findConfigPath(): { path: string; format: "modular" } | null {
  const projectModules = listConfigModules(PROJECT_CONFIG_BASE)
  if (projectModules.length > 0) {
    return { path: PROJECT_CONFIG_BASE, format: "modular" }
  }

  const userModules = listConfigModules(USER_CONFIG_BASE)
  if (userModules.length > 0) {
    return { path: USER_CONFIG_BASE, format: "modular" }
  }

  return null
}

function findLegacyConfigPath(): { path: string; format: "json" | "jsonc" } | null {
  const projectDetected = detectConfigFile(PROJECT_CONFIG_BASE)
  if (projectDetected.format !== "none") {
    return { path: projectDetected.path, format: projectDetected.format }
  }

  const userDetected = detectConfigFile(USER_CONFIG_BASE)
  if (userDetected.format !== "none") {
    return { path: userDetected.path, format: userDetected.format }
  }

  return null
}

function getLegacyConfigError(path: string): string {
  return (
    `Detected legacy single-file config at ${path}. ` +
    "Legacy single-file config is no longer supported. " +
    "Use modular config files in <configDir>/oh-my-opencode/*.json instead."
  )
}

export function validateConfig(configPath: string): { valid: boolean; errors: string[] } {
  try {
    const modulePaths = listConfigModules(configPath)
    if (modulePaths.length === 0) {
      return { valid: false, errors: [`No config modules found in ${configPath}`] }
    }

    let mergedConfig: Record<string, unknown> = {}
    for (const modulePath of modulePaths) {
      const content = readFileSync(modulePath, "utf-8")
      const rawModule = parseJsonc<unknown>(content)
      if (!rawModule || typeof rawModule !== "object" || Array.isArray(rawModule)) {
        return { valid: false, errors: [`Module root must be an object: ${modulePath}`] }
      }
      mergedConfig = deepMerge(mergedConfig, rawModule as Record<string, unknown>) ?? mergedConfig
    }

    const result = validateStrictOhMyOpenCodeConfig(mergedConfig)

    if (!result.success) {
      return { valid: false, errors: result.errors }
    }

    return { valid: true, errors: [] }
  } catch (err) {
    return {
      valid: false,
      errors: [err instanceof Error ? err.message : "Failed to parse config"],
    }
  }
}

export function getConfigInfo(): ConfigInfo {
  const legacyConfigPath = findLegacyConfigPath()
  if (legacyConfigPath) {
    return {
      exists: true,
      path: legacyConfigPath.path,
      format: legacyConfigPath.format,
      valid: false,
      errors: [getLegacyConfigError(legacyConfigPath.path)],
    }
  }

  const configPath = findConfigPath()

  if (!configPath) {
    return {
      exists: false,
      path: null,
      format: null,
      valid: true,
      errors: [],
    }
  }

  if (!existsSync(configPath.path)) {
    return {
      exists: false,
      path: configPath.path,
      format: configPath.format,
      valid: true,
      errors: [],
    }
  }

  const validation = validateConfig(configPath.path)

  return {
    exists: true,
    path: configPath.path,
    format: configPath.format,
    valid: validation.valid,
    errors: validation.errors,
  }
}

export async function checkConfigValidity(): Promise<CheckResult> {
  const info = getConfigInfo()

  if (!info.exists) {
    return {
      name: CHECK_NAMES[CHECK_IDS.CONFIG_VALIDATION],
      status: "pass",
      message: "Using default configuration",
      details: ["No custom config file found (optional)"],
    }
  }

  if (!info.valid) {
    return {
      name: CHECK_NAMES[CHECK_IDS.CONFIG_VALIDATION],
      status: "fail",
      message: "Configuration has validation errors",
      details: [
        `Path: ${info.path}`,
        ...info.errors.map((e) => `Error: ${e}`),
      ],
    }
  }

  return {
    name: CHECK_NAMES[CHECK_IDS.CONFIG_VALIDATION],
    status: "pass",
    message: info.format === "modular" ? "Valid modular config" : `Valid ${info.format?.toUpperCase()} config`,
    details: [`Path: ${info.path}`],
  }
}

export function getConfigCheckDefinition(): CheckDefinition {
  return {
    id: CHECK_IDS.CONFIG_VALIDATION,
    name: CHECK_NAMES[CHECK_IDS.CONFIG_VALIDATION],
    category: "configuration",
    check: checkConfigValidity,
    critical: false,
  }
}
