import { existsSync, readFileSync } from "node:fs"
import type { CheckResult, CheckDefinition, PluginInfo } from "../types"
import { CHECK_IDS, CHECK_NAMES, PACKAGE_NAME } from "../constants"
import { parseJsonc, getOpenCodeConfigPaths } from "../../../shared"
import { discoverInstalledPlugins, validateDiscoveredPlugins } from "../../../features/claude-code-plugin-loader"

function detectConfigPath(): { path: string; format: "json" | "jsonc" } | null {
  const paths = getOpenCodeConfigPaths({ binary: "opencode", version: null })

  if (existsSync(paths.configJsonc)) {
    return { path: paths.configJsonc, format: "jsonc" }
  }
  if (existsSync(paths.configJson)) {
    return { path: paths.configJson, format: "json" }
  }
  return null
}

function findPluginEntry(plugins: string[]): { entry: string; isPinned: boolean; version: string | null } | null {
  for (const plugin of plugins) {
    if (plugin === PACKAGE_NAME || plugin.startsWith(`${PACKAGE_NAME}@`)) {
      const isPinned = plugin.includes("@")
      const version = isPinned ? plugin.split("@")[1] : null
      return { entry: plugin, isPinned, version }
    }
    if (plugin.startsWith("file://") && plugin.includes(PACKAGE_NAME)) {
      return { entry: plugin, isPinned: false, version: "local-dev" }
    }
  }
  return null
}

export function getPluginInfo(): PluginInfo {
  const configInfo = detectConfigPath()

  if (!configInfo) {
    return {
      registered: false,
      configPath: null,
      entry: null,
      isPinned: false,
      pinnedVersion: null,
    }
  }

  try {
    const content = readFileSync(configInfo.path, "utf-8")
    const config = parseJsonc<{ plugin?: string[] }>(content)
    const plugins = config.plugin ?? []
    const pluginEntry = findPluginEntry(plugins)

    if (!pluginEntry) {
      return {
        registered: false,
        configPath: configInfo.path,
        entry: null,
        isPinned: false,
        pinnedVersion: null,
      }
    }

    return {
      registered: true,
      configPath: configInfo.path,
      entry: pluginEntry.entry,
      isPinned: pluginEntry.isPinned,
      pinnedVersion: pluginEntry.version,
    }
  } catch {
    return {
      registered: false,
      configPath: configInfo.path,
      entry: null,
      isPinned: false,
      pinnedVersion: null,
    }
  }
}

export async function checkPluginRegistration(): Promise<CheckResult> {
  const info = getPluginInfo()

  if (!info.configPath) {
    const expectedPaths = getOpenCodeConfigPaths({ binary: "opencode", version: null })
    return {
      name: CHECK_NAMES[CHECK_IDS.PLUGIN_REGISTRATION],
      status: "fail",
      message: "OpenCode config file not found",
      details: [
        "Run: bunx oh-my-opencode install",
        `Expected: ${expectedPaths.configJson} or ${expectedPaths.configJsonc}`,
      ],
    }
  }

  if (!info.registered) {
    return {
      name: CHECK_NAMES[CHECK_IDS.PLUGIN_REGISTRATION],
      status: "fail",
      message: "Plugin not registered in config",
      details: [
        "Run: bunx oh-my-opencode install",
        `Config: ${info.configPath}`,
      ],
    }
  }

  const message = info.isPinned
    ? `Registered (pinned: ${info.pinnedVersion})`
    : "Registered"

  return {
    name: CHECK_NAMES[CHECK_IDS.PLUGIN_REGISTRATION],
    status: "pass",
    message,
    details: [`Config: ${info.configPath}`],
  }
}

export function getPluginCheckDefinition(): CheckDefinition {
  return {
    id: CHECK_IDS.PLUGIN_REGISTRATION,
    name: CHECK_NAMES[CHECK_IDS.PLUGIN_REGISTRATION],
    category: "installation",
    check: checkPluginRegistration,
    critical: true,
  }
}

function formatPluginValidationDetails(
  report: ReturnType<typeof validateDiscoveredPlugins>
): string[] {
  const details: string[] = []
  for (const pluginReport of report.reports) {
    if (pluginReport.issues.length === 0) continue
    const issueSummary = pluginReport.issues
      .map((issue) => `${issue.severity.toUpperCase()}:${issue.code}`)
      .join(", ")
    details.push(`${pluginReport.pluginName} (${pluginReport.pluginKey}) -> ${issueSummary}`)
  }
  return details
}

export async function checkPluginComponentIntegrity(): Promise<CheckResult> {
  const discovery = discoverInstalledPlugins()
  const validation = validateDiscoveredPlugins(discovery.plugins, {
    discoveryErrors: discovery.errors,
  })

  if (validation.summary.totalPlugins === 0) {
    return {
      name: CHECK_NAMES[CHECK_IDS.PLUGIN_COMPONENT_INTEGRITY],
      status: "skip",
      message: "No plugins found for integrity check",
      details: ["No enabled Claude Code plugins are installed"],
    }
  }

  if (validation.summary.errorCount > 0 || validation.summary.warningCount > 0) {
    return {
      name: CHECK_NAMES[CHECK_IDS.PLUGIN_COMPONENT_INTEGRITY],
      status: "warn",
      message: `Found plugin integrity issues (${validation.summary.errorCount} error(s), ${validation.summary.warningCount} warning(s))`,
      details: formatPluginValidationDetails(validation),
    }
  }

  return {
    name: CHECK_NAMES[CHECK_IDS.PLUGIN_COMPONENT_INTEGRITY],
    status: "pass",
    message: `All ${validation.summary.validPlugins} plugin(s) passed integrity checks`,
    details: [`Validated plugins: ${validation.summary.totalPlugins}`],
  }
}

export function getPluginIntegrityCheckDefinition(): CheckDefinition {
  return {
    id: CHECK_IDS.PLUGIN_COMPONENT_INTEGRITY,
    name: CHECK_NAMES[CHECK_IDS.PLUGIN_COMPONENT_INTEGRITY],
    category: "installation",
    check: checkPluginComponentIntegrity,
    critical: false,
  }
}
