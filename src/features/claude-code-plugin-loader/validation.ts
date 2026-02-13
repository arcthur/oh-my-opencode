import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs"
import { isAbsolute, join, relative } from "node:path"
import { parseFrontmatter } from "../../shared/frontmatter"
import { isMarkdownFile, resolveSymlink } from "../../shared/file-utils"
import type {
  LoadedPlugin,
  PluginValidationIssue,
  PluginValidationOptions,
  PluginValidationReport,
  PluginValidationResult,
  PluginValidationSeverity,
} from "./types"

function derivePluginNameFromKey(pluginKey: string): string {
  const atIndex = pluginKey.indexOf("@")
  if (atIndex > 0) {
    return pluginKey.substring(0, atIndex)
  }
  return pluginKey
}

function createIssue(
  severity: PluginValidationSeverity,
  code: string,
  message: string,
  path?: string
): PluginValidationIssue {
  return { severity, code, message, path }
}

function hasErrors(report: PluginValidationReport): boolean {
  return report.issues.some((issue) => issue.severity === "error")
}

function isPathInsideRoot(rootRealPath: string, targetRealPath: string): boolean {
  const rel = relative(rootRealPath, targetRealPath)
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))
}

function pushPathIssue(
  report: PluginValidationReport,
  rootRealPath: string,
  candidatePath: string,
  expectedType: "directory" | "file"
): { exists: boolean; readable: boolean } {
  if (!existsSync(candidatePath)) {
    return { exists: false, readable: false }
  }

  const entryStats = lstatSync(candidatePath, { throwIfNoEntry: false })
  if (!entryStats) {
    report.issues.push(
      createIssue("error", "path-unreadable", "Component path is not readable", candidatePath)
    )
    return { exists: true, readable: false }
  }

  let resolvedStats: ReturnType<typeof statSync>
  try {
    resolvedStats = statSync(candidatePath)
  } catch {
    report.issues.push(
      createIssue("error", "path-unreadable", "Component path is not readable", candidatePath)
    )
    return { exists: true, readable: false }
  }

  const typeMismatch = expectedType === "directory" ? !resolvedStats.isDirectory() : !resolvedStats.isFile()
  if (typeMismatch) {
    const expected = expectedType === "directory" ? "directory" : "file"
    report.issues.push(
      createIssue(
        "error",
        "path-invalid-type",
        `Component path must be a ${expected}`,
        candidatePath
      )
    )
    return { exists: true, readable: false }
  }

  try {
    const realPath = realpathSync(candidatePath)
    if (!isPathInsideRoot(rootRealPath, realPath)) {
      report.issues.push(
        createIssue("error", "path-escape", "Component path escapes plugin root", candidatePath)
      )
      return { exists: true, readable: false }
    }
  } catch {
    report.issues.push(
      createIssue("error", "path-unreadable", "Component path cannot be resolved", candidatePath)
    )
    return { exists: true, readable: false }
  }

  return { exists: true, readable: true }
}

function validateManifest(
  report: PluginValidationReport,
  installPath: string,
  rootRealPath: string
): void {
  const manifestPath = join(installPath, ".claude-plugin", "plugin.json")

  if (!existsSync(manifestPath)) {
    report.issues.push(
      createIssue("error", "manifest-missing", "Missing plugin manifest (.claude-plugin/plugin.json)", manifestPath)
    )
    return
  }

  const manifestPathStatus = pushPathIssue(report, rootRealPath, manifestPath, "file")
  if (!manifestPathStatus.readable) {
    return
  }

  try {
    const content = readFileSync(manifestPath, "utf-8")
    const parsed = JSON.parse(content) as { name?: unknown }

    if (!parsed || typeof parsed !== "object") {
      report.issues.push(
        createIssue("error", "manifest-invalid-shape", "Manifest must be a JSON object", manifestPath)
      )
      return
    }

    if (typeof parsed.name !== "string" || parsed.name.trim().length === 0) {
      report.issues.push(
        createIssue("error", "manifest-invalid-name", "Manifest must include a non-empty string 'name'", manifestPath)
      )
    }
  } catch {
    report.issues.push(
      createIssue("error", "manifest-invalid-json", "Manifest contains invalid JSON", manifestPath)
    )
  }
}

function validateMarkdownFrontmatter(
  report: PluginValidationReport,
  rootRealPath: string,
  markdownPath: string,
  componentLabel: string
): void {
  const fileStatus = pushPathIssue(report, rootRealPath, markdownPath, "file")
  if (!fileStatus.readable) {
    return
  }

  try {
    const content = readFileSync(markdownPath, "utf-8")
    const parsed = parseFrontmatter(content)
    if (parsed.parseError) {
      report.issues.push(
        createIssue(
          "warn",
          "frontmatter-parse-failed",
          `Failed to parse frontmatter in ${componentLabel}`,
          markdownPath
        )
      )
    }
  } catch {
    report.issues.push(
      createIssue("error", "component-read-failed", `Failed to read ${componentLabel}`, markdownPath)
    )
  }
}

function validateMarkdownDirectory(
  report: PluginValidationReport,
  rootRealPath: string,
  directoryPath: string,
  componentLabel: string
): void {
  const directoryStatus = pushPathIssue(report, rootRealPath, directoryPath, "directory")
  if (!directoryStatus.exists || !directoryStatus.readable) {
    return
  }

  try {
    const entries = readdirSync(directoryPath, { withFileTypes: true })
    for (const entry of entries) {
      if (!isMarkdownFile(entry)) continue
      const markdownPath = join(directoryPath, entry.name)
      validateMarkdownFrontmatter(report, rootRealPath, markdownPath, `${componentLabel} file`)
    }
  } catch {
    report.issues.push(
      createIssue("error", "component-read-failed", `Failed to read ${componentLabel} directory`, directoryPath)
    )
  }
}

function validateSkills(
  report: PluginValidationReport,
  installPath: string,
  rootRealPath: string
): void {
  const skillsDir = join(installPath, "skills")
  const directoryStatus = pushPathIssue(report, rootRealPath, skillsDir, "directory")
  if (!directoryStatus.exists || !directoryStatus.readable) {
    return
  }

  try {
    const entries = readdirSync(skillsDir, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue

      const skillPath = join(skillsDir, entry.name)
      const resolvedSkillPath = resolveSymlink(skillPath)

      let resolvedRealPath: string
      try {
        resolvedRealPath = realpathSync(resolvedSkillPath)
      } catch {
        report.issues.push(
          createIssue("error", "path-unreadable", "Skill path cannot be resolved", skillPath)
        )
        continue
      }

      if (!isPathInsideRoot(rootRealPath, resolvedRealPath)) {
        report.issues.push(
          createIssue("error", "path-escape", "Skill path escapes plugin root", skillPath)
        )
        continue
      }

      const skillMarkdownPath = join(resolvedSkillPath, "SKILL.md")
      if (!existsSync(skillMarkdownPath)) {
        continue
      }

      validateMarkdownFrontmatter(report, rootRealPath, skillMarkdownPath, "skill metadata")
    }
  } catch {
    report.issues.push(
      createIssue("error", "component-read-failed", "Failed to read skills directory", skillsDir)
    )
  }
}

function validateJsonConfigFile(
  report: PluginValidationReport,
  rootRealPath: string,
  filePath: string,
  warningCode: string,
  warningMessage: string
): void {
  const fileStatus = pushPathIssue(report, rootRealPath, filePath, "file")
  if (!fileStatus.exists || !fileStatus.readable) {
    return
  }

  try {
    const content = readFileSync(filePath, "utf-8")
    JSON.parse(content)
  } catch {
    report.issues.push(createIssue("warn", warningCode, warningMessage, filePath))
  }
}

function validateSinglePlugin(plugin: LoadedPlugin): PluginValidationReport {
  const report: PluginValidationReport = {
    pluginKey: plugin.pluginKey,
    pluginName: plugin.name,
    installPath: plugin.installPath,
    issues: [],
  }

  if (!existsSync(plugin.installPath)) {
    report.issues.push(
      createIssue("error", "install-path-missing", "Plugin install path does not exist", plugin.installPath)
    )
    return report
  }

  const installStats = lstatSync(plugin.installPath, { throwIfNoEntry: false })
  if (!installStats || !installStats.isDirectory()) {
    report.issues.push(
      createIssue("error", "install-path-invalid-type", "Plugin install path must be a directory", plugin.installPath)
    )
    return report
  }

  let rootRealPath: string
  try {
    rootRealPath = realpathSync(plugin.installPath)
  } catch {
    report.issues.push(
      createIssue("error", "install-path-unreadable", "Plugin install path is not readable", plugin.installPath)
    )
    return report
  }

  validateManifest(report, plugin.installPath, rootRealPath)
  validateMarkdownDirectory(report, rootRealPath, join(plugin.installPath, "commands"), "commands")
  validateMarkdownDirectory(report, rootRealPath, join(plugin.installPath, "agents"), "agents")
  validateSkills(report, plugin.installPath, rootRealPath)

  validateJsonConfigFile(
    report,
    rootRealPath,
    join(plugin.installPath, "hooks", "hooks.json"),
    "hooks-invalid-json",
    "hooks/hooks.json contains invalid JSON"
  )

  validateJsonConfigFile(
    report,
    rootRealPath,
    join(plugin.installPath, ".mcp.json"),
    "mcp-invalid-json",
    ".mcp.json contains invalid JSON"
  )

  return report
}

export function validateDiscoveredPlugins(
  plugins: LoadedPlugin[],
  options: PluginValidationOptions = {}
): PluginValidationResult {
  const reports: PluginValidationReport[] = plugins.map((plugin) => validateSinglePlugin(plugin))

  for (const discoveryError of options.discoveryErrors ?? []) {
    reports.push({
      pluginKey: discoveryError.pluginKey,
      pluginName: derivePluginNameFromKey(discoveryError.pluginKey),
      installPath: discoveryError.installPath,
      issues: [
        createIssue("error", "discovery-error", discoveryError.error, discoveryError.installPath),
      ],
    })
  }

  const errorCount = reports
    .flatMap((report) => report.issues)
    .filter((issue) => issue.severity === "error").length

  const warningCount = reports
    .flatMap((report) => report.issues)
    .filter((issue) => issue.severity === "warn").length

  const skippedPlugins = reports.filter((report) => hasErrors(report)).length

  return {
    summary: {
      totalPlugins: reports.length,
      validPlugins: reports.length - skippedPlugins,
      skippedPlugins,
      errorCount,
      warningCount,
    },
    reports,
  }
}

export function hasPluginValidationErrors(report: PluginValidationReport): boolean {
  return hasErrors(report)
}
