import { existsSync, lstatSync } from "node:fs"
import { basename, dirname, resolve } from "node:path"
import {
  discoverInstalledPlugins,
  validateDiscoveredPlugins,
} from "../features/claude-code-plugin-loader"
import type {
  LoadedPlugin,
  PluginValidationIssue,
  PluginValidationResult,
} from "../features/claude-code-plugin-loader"

export interface ValidatePluginsOptions {
  json?: boolean
  strict?: boolean
  path?: string
}

function derivePluginRoot(inputPath: string): string {
  const resolvedInput = resolve(inputPath)
  if (!existsSync(resolvedInput)) {
    return resolvedInput
  }

  const stats = lstatSync(resolvedInput, { throwIfNoEntry: false })
  if (!stats) {
    return resolvedInput
  }

  if (stats.isDirectory()) {
    if (basename(resolvedInput) === ".claude-plugin") {
      return dirname(resolvedInput)
    }
    return resolvedInput
  }

  if (stats.isFile()) {
    const parent = dirname(resolvedInput)
    if (basename(resolvedInput) === "plugin.json" && basename(parent) === ".claude-plugin") {
      return dirname(parent)
    }
    return parent
  }

  return resolvedInput
}

function createPluginCandidate(inputPath: string): LoadedPlugin {
  const installPath = derivePluginRoot(inputPath)
  const pluginName = basename(installPath) || "plugin"

  return {
    name: pluginName,
    version: "unknown",
    scope: "local",
    installPath,
    pluginKey: `${pluginName}@manual`,
  }
}

function formatIssue(issue: PluginValidationIssue): string {
  const location = issue.path ? ` (${issue.path})` : ""
  return `[${issue.severity}] ${issue.code}: ${issue.message}${location}`
}

function printTextReport(report: PluginValidationResult): void {
  const { summary } = report

  if (summary.totalPlugins === 0) {
    console.log("No plugins found for validation.")
    return
  }

  console.log(
    `Validated ${summary.totalPlugins} plugin(s): ${summary.validPlugins} valid, ${summary.skippedPlugins} skipped, ${summary.errorCount} error(s), ${summary.warningCount} warning(s).`
  )

  for (const pluginReport of report.reports) {
    if (pluginReport.issues.length === 0) continue

    console.log(`- ${pluginReport.pluginName} (${pluginReport.pluginKey})`)
    for (const issue of pluginReport.issues) {
      console.log(`  ${formatIssue(issue)}`)
    }
  }
}

function shouldFail(result: PluginValidationResult, strict: boolean): boolean {
  if (result.summary.errorCount > 0) {
    return true
  }
  return strict && result.summary.warningCount > 0
}

export async function validatePlugins(options: ValidatePluginsOptions = {}): Promise<number> {
  const strict = options.strict ?? false

  const validationResult = options.path
    ? validateDiscoveredPlugins([createPluginCandidate(options.path)])
    : (() => {
      const discovery = discoverInstalledPlugins()
      return validateDiscoveredPlugins(discovery.plugins, {
        discoveryErrors: discovery.errors,
      })
    })()

  if (options.json) {
    console.log(JSON.stringify(validationResult, null, 2))
  } else {
    printTextReport(validationResult)
  }

  return shouldFail(validationResult, strict) ? 1 : 0
}
