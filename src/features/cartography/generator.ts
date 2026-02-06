/**
 * Cartography Generator
 *
 * Generates codemap.md files from analysis results.
 */

import { existsSync, writeFileSync, readFileSync, mkdirSync } from "node:fs"
import { dirname, relative, basename, join } from "node:path"
import { execSync } from "node:child_process"
import type {
  DirectoryInfo,
  AnalysisResult,
  Codemap,
  CodemapSections,
  CodemapMeta,
  SymbolInfo,
  PatternInfo,
  FlowInfo,
  IntegrationInfo,
  DesignSection,
  FlowSection,
  IntegrationSection,
} from "./types"
import {
  CODEMAP_FILE_NAME,
  ROOT_PROJECT_MAP_FILE_NAME,
  MAX_ROOT_CODEMAP_LINES,
  MIN_ROOT_CODEMAP_LINES,
  MAX_SUBDIR_CODEMAP_LINES,
  MIN_SUBDIR_CODEMAP_LINES,
} from "./constants"
import { hashDirectory } from "./hash-utils"
import { log } from "../../shared"

// ============================================================================
// Main Generator
// ============================================================================

/**
 * Generate codemap for a directory
 */
export function generateCodemap(
  dir: DirectoryInfo,
  analysisResults: AnalysisResult[],
  projectRoot: string,
  options?: {
    includePatterns?: string[]
    excludePatterns?: string[]
    maxDepth?: number
  }
): { content: string; meta: CodemapMeta } {
  const isRoot = dir.relativePath === "."

  // Build sections from analysis
  const sections = buildSections(analysisResults, dir)

  // Generate markdown content
  const content = formatCodemap(dir, sections, projectRoot, isRoot)

  const sourceHash = hashDirectory(dir.path, {
    includePatterns: options?.includePatterns
      ? new Set(options.includePatterns)
      : undefined,
    excludePatterns: options?.excludePatterns
      ? new Set(options.excludePatterns)
      : undefined,
    maxDepth: options?.maxDepth,
  })

  // Create metadata
  const meta: CodemapMeta = {
    directory: dir.path,
    filePath: join(dir.path, CODEMAP_FILE_NAME),
    generatedAt: Date.now(),
    sourceHash,
    lineCount: content.split("\n").length,
    isRoot,
  }

  return { content, meta }
}

/**
 * Write codemap to disk
 */
export function writeCodemap(content: string, meta: CodemapMeta): void {
  const dir = dirname(meta.filePath)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }

  writeFileSync(meta.filePath, content, "utf8")
  log(`[cartography] Wrote codemap: ${meta.filePath}`)
}

/**
 * Generate project map (aggregation of all codemaps)
 */
export function generateProjectMap(
  projectRoot: string,
  codemaps: CodemapMeta[]
): string {
  const lines: string[] = []

  // Header
  lines.push("# PROJECT MAP")
  lines.push("")
  lines.push(`> Generated: ${new Date().toISOString()}`)
  lines.push(`> Codemaps: ${codemaps.length}`)
  lines.push("")

  // Quick overview
  lines.push("## STRUCTURE")
  lines.push("")
  lines.push("```")

  // Build tree structure
  const tree = buildTreeStructure(projectRoot, codemaps)
  lines.push(...tree)

  lines.push("```")
  lines.push("")

  // Codemap index
  lines.push("## CODEMAPS")
  lines.push("")
  lines.push("| Directory | Lines | Generated |")
  lines.push("|-----------|-------|-----------|")

  for (const meta of codemaps.sort((a, b) => a.directory.localeCompare(b.directory))) {
    const relPath = relative(projectRoot, meta.directory) || "."
    const date = new Date(meta.generatedAt).toLocaleDateString()
    lines.push(`| ${relPath} | ${meta.lineCount} | ${date} |`)
  }

  lines.push("")

  return lines.join("\n")
}

// ============================================================================
// Section Building
// ============================================================================

/**
 * Build codemap sections from analysis results
 */
function buildSections(
  results: AnalysisResult[],
  dir: DirectoryInfo
): CodemapSections {
  const allSymbols = results.flatMap(r => r.symbols)
  const allPatterns = results.flatMap(r => r.patterns)
  const allFlows = results.flatMap(r => r.flows)
  const allIntegrations = results.flatMap(r => r.integrations)
  const explorerOutput = results.find(r => r.source === "explorer")?.explorerOutput

  return {
    responsibility: buildResponsibilitySection(dir, allSymbols, explorerOutput),
    design: buildDesignSection(allPatterns, allSymbols),
    flow: buildFlowSection(allFlows, allSymbols, dir),
    integration: buildIntegrationSection(allIntegrations),
    antiPatterns: [],
    conventions: [],
    notes: [],
  }
}

/**
 * Build responsibility section
 */
function buildResponsibilitySection(
  dir: DirectoryInfo,
  symbols: SymbolInfo[],
  explorerOutput?: string
): string {
  // If we have explorer output, use it
  if (explorerOutput) {
    const respMatch = explorerOutput.match(/RESPONSIBILITY:?\s*(.+?)(?=\n\n|DESIGN|FLOW|INTEGRATION|$)/is)
    if (respMatch) {
      return respMatch[1].trim()
    }
  }

  // Infer from symbols
  const exportedSymbols = symbols.filter(s => s.isExported)
  const classes = symbols.filter(s => s.type === "class")
  const functions = symbols.filter(s => s.type === "function")

  const parts: string[] = []

  if (classes.length > 0) {
    parts.push(`Core classes: ${classes.slice(0, 3).map(c => c.name).join(", ")}`)
  }

  if (functions.length > 0) {
    const publicFuncs = functions.filter(f => f.isExported)
    if (publicFuncs.length > 0) {
      parts.push(`Key functions: ${publicFuncs.slice(0, 3).map(f => f.name).join(", ")}`)
    }
  }

  if (parts.length === 0) {
    return `Contains ${dir.fileCount} files with ${symbols.length} symbols.`
  }

  return parts.join(". ") + "."
}

/**
 * Build design section
 */
function buildDesignSection(
  patterns: PatternInfo[],
  symbols: SymbolInfo[]
): DesignSection | undefined {
  if (patterns.length === 0 && symbols.length === 0) {
    return undefined
  }

  const patternNames = patterns.map(p => p.name)
  const abstractions: string[] = []
  const decisions: string[] = []

  // Extract abstractions from interfaces and abstract classes
  const interfaces = symbols.filter(s => s.type === "interface")
  const types = symbols.filter(s => s.type === "type")

  if (interfaces.length > 0) {
    abstractions.push(`Interfaces: ${interfaces.slice(0, 5).map(i => i.name).join(", ")}`)
  }

  if (types.length > 0) {
    abstractions.push(`Types: ${types.slice(0, 5).map(t => t.name).join(", ")}`)
  }

  // Infer decisions from patterns
  for (const pattern of patterns) {
    if (pattern.confidence > 0.7) {
      decisions.push(`Uses ${pattern.name} pattern`)
    }
  }

  return {
    patterns: patternNames,
    abstractions,
    decisions,
  }
}

/**
 * Build flow section
 */
function buildFlowSection(
  flows: FlowInfo[],
  symbols: SymbolInfo[],
  dir: DirectoryInfo
): FlowSection | undefined {
  const entryPoints: string[] = []
  const flowDescriptions: string[] = []
  const outputs: string[] = []

  // Detect entry points from common patterns
  const indexSymbols = symbols.filter(s =>
    s.filePath.includes("index") && s.isExported
  )

  if (indexSymbols.length > 0) {
    entryPoints.push(...indexSymbols.slice(0, 3).map(s => s.name))
  }

  // Add explicit flows
  for (const flow of flows) {
    entryPoints.push(flow.entryPoint)
    outputs.push(...flow.exitPoints)
    flowDescriptions.push(flow.name)
  }

  // Deduplicate
  const uniqueEntryPoints = [...new Set(entryPoints)]
  const uniqueOutputs = [...new Set(outputs)]

  if (uniqueEntryPoints.length === 0 && flowDescriptions.length === 0) {
    return undefined
  }

  return {
    entryPoints: uniqueEntryPoints,
    flows: flowDescriptions,
    outputs: uniqueOutputs,
  }
}

/**
 * Build integration section
 */
function buildIntegrationSection(
  integrations: IntegrationInfo[]
): IntegrationSection | undefined {
  if (integrations.length === 0) {
    return undefined
  }

  const dependencies: string[] = []
  const dependents: string[] = []
  const external: string[] = []

  for (const integration of integrations) {
    switch (integration.type) {
      case "import":
        if (integration.target && !integration.target.startsWith(".")) {
          dependencies.push(integration.target)
        }
        break
      case "api":
        external.push(integration.name)
        break
      case "event":
      case "hook":
      case "plugin":
        external.push(`${integration.type}: ${integration.name}`)
        break
    }
  }

  const uniqueDeps = [...new Set(dependencies)].slice(0, 10)
  const uniqueExternal = [...new Set(external)].slice(0, 5)

  if (uniqueDeps.length === 0 && uniqueExternal.length === 0) {
    return undefined
  }

  return {
    dependencies: uniqueDeps,
    dependents,
    external: uniqueExternal,
  }
}

// ============================================================================
// Markdown Formatting
// ============================================================================

/**
 * Format codemap as markdown
 */
function formatCodemap(
  dir: DirectoryInfo,
  sections: CodemapSections,
  projectRoot: string,
  isRoot: boolean
): string {
  const lines: string[] = []
  const maxLines = isRoot ? MAX_ROOT_CODEMAP_LINES : MAX_SUBDIR_CODEMAP_LINES

  // Header
  const title = isRoot ? "PROJECT CODEMAP" : `CODEMAP: ${dir.name}`
  lines.push(`# ${title}`)
  lines.push("")

  // Metadata
  lines.push(`> Generated: ${new Date().toISOString()}`)

  const gitInfo = getGitInfo(projectRoot)
  if (gitInfo.branch) {
    lines.push(`> Branch: ${gitInfo.branch}`)
  }
  if (gitInfo.commit) {
    lines.push(`> Commit: ${gitInfo.commit}`)
  }

  lines.push("")

  // Responsibility
  if (sections.responsibility) {
    lines.push("## RESPONSIBILITY")
    lines.push("")
    lines.push(sections.responsibility)
    lines.push("")
  }

  // Structure (for root only)
  if (isRoot) {
    lines.push("## STRUCTURE")
    lines.push("")
    lines.push("```")
    lines.push(formatDirectoryTree(projectRoot, dir))
    lines.push("```")
    lines.push("")
  }

  // Design
  if (sections.design) {
    lines.push("## DESIGN")
    lines.push("")

    if (sections.design.patterns.length > 0) {
      lines.push(`**Patterns:** ${sections.design.patterns.join(", ")}`)
      lines.push("")
    }

    if (sections.design.abstractions.length > 0) {
      lines.push("**Abstractions:**")
      for (const abstraction of sections.design.abstractions) {
        lines.push(`- ${abstraction}`)
      }
      lines.push("")
    }

    if (sections.design.decisions.length > 0) {
      lines.push("**Decisions:**")
      for (const decision of sections.design.decisions) {
        lines.push(`- ${decision}`)
      }
      lines.push("")
    }
  }

  // Flow
  if (sections.flow) {
    lines.push("## FLOW")
    lines.push("")

    if (sections.flow.entryPoints.length > 0) {
      lines.push(`**Entry points:** ${sections.flow.entryPoints.join(", ")}`)
    }

    if (sections.flow.flows.length > 0) {
      for (const flow of sections.flow.flows) {
        lines.push(`- ${flow}`)
      }
    }

    if (sections.flow.outputs.length > 0) {
      lines.push(`**Outputs:** ${sections.flow.outputs.join(", ")}`)
    }

    lines.push("")
  }

  // Integration
  if (sections.integration) {
    lines.push("## INTEGRATION")
    lines.push("")

    if (sections.integration.dependencies.length > 0) {
      lines.push(`**Dependencies:** ${sections.integration.dependencies.join(", ")}`)
    }

    if (sections.integration.external.length > 0) {
      lines.push("**External:**")
      for (const ext of sections.integration.external) {
        lines.push(`- ${ext}`)
      }
    }

    lines.push("")
  }

  // Anti-patterns
  if (sections.antiPatterns && sections.antiPatterns.length > 0) {
    lines.push("## ANTI-PATTERNS")
    lines.push("")
    for (const ap of sections.antiPatterns) {
      lines.push(`- ${ap}`)
    }
    lines.push("")
  }

  // Conventions
  if (sections.conventions && sections.conventions.length > 0) {
    lines.push("## CONVENTIONS")
    lines.push("")
    for (const conv of sections.conventions) {
      lines.push(`- ${conv}`)
    }
    lines.push("")
  }

  // Notes
  if (sections.notes && sections.notes.length > 0) {
    lines.push("## NOTES")
    lines.push("")
    for (const note of sections.notes) {
      lines.push(`- ${note}`)
    }
    lines.push("")
  }

  // Trim if exceeds max lines
  let result = lines.join("\n")
  const lineCount = result.split("\n").length

  if (lineCount > maxLines) {
    // Truncate sections while keeping header and responsibility
    const truncatedLines = lines.slice(0, maxLines - 5)
    truncatedLines.push("")
    truncatedLines.push(`> [Truncated: ${lineCount - maxLines + 5} lines omitted]`)
    result = truncatedLines.join("\n")
  }

  return result
}

/**
 * Format directory tree
 */
function formatDirectoryTree(projectRoot: string, dir: DirectoryInfo): string {
  const lines: string[] = []
  const baseName = basename(projectRoot)
  lines.push(`${baseName}/`)

  try {
    const entries = require("node:fs").readdirSync(projectRoot, { withFileTypes: true })

    // Filter and sort
    const dirs = entries
      .filter((e: { isDirectory: () => boolean; name: string }) =>
        e.isDirectory() && !e.name.startsWith(".") && !isIgnoredForTree(e.name))
      .sort((a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name))

    const files = entries
      .filter((e: { isFile: () => boolean; name: string }) =>
        e.isFile() && isImportantFile(e.name))
      .sort((a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name))

    // Limit to reasonable number
    const maxItems = 15
    let itemCount = 0

    for (const d of dirs.slice(0, 10)) {
      if (itemCount >= maxItems) break
      lines.push(`├── ${d.name}/`)
      itemCount++
    }

    for (const f of files.slice(0, 5)) {
      if (itemCount >= maxItems) break
      const isLast = itemCount === maxItems - 1 ||
        (files.indexOf(f) === files.length - 1 && dirs.length <= 10)
      lines.push(`${isLast ? "└──" : "├──"} ${f.name}`)
      itemCount++
    }
  } catch {
    lines.push("  (unable to read)")
  }

  return lines.join("\n")
}

/**
 * Check if directory should be ignored in tree
 */
function isIgnoredForTree(name: string): boolean {
  const ignored = new Set([
    "node_modules",
    "dist",
    "build",
    ".git",
    "__pycache__",
    ".next",
    "coverage",
    ".turbo",
    "target",
    ".venv",
    "venv",
  ])
  return ignored.has(name)
}

/**
 * Check if file is important enough to show in tree
 */
function isImportantFile(name: string): boolean {
  const important = new Set([
    "package.json",
    "tsconfig.json",
    "README.md",
    "AGENTS.md",
    "index.ts",
    "index.js",
    "main.ts",
    "main.py",
    "go.mod",
    "Cargo.toml",
    "pyproject.toml",
    "Makefile",
    ".env.example",
  ])
  return important.has(name)
}

/**
 * Build tree structure for project map
 */
function buildTreeStructure(projectRoot: string, codemaps: CodemapMeta[]): string[] {
  const lines: string[] = []
  const baseName = basename(projectRoot)
  lines.push(`${baseName}/`)

  // Sort codemaps by path depth
  const sorted = codemaps
    .filter(c => c.directory !== projectRoot)
    .sort((a, b) => a.directory.localeCompare(b.directory))

  for (const codemap of sorted) {
    const relPath = relative(projectRoot, codemap.directory)
    const depth = relPath.split("/").length
    const indent = "  ".repeat(depth)
    lines.push(`${indent}├── ${basename(codemap.directory)}/ [codemap]`)
  }

  return lines
}

/**
 * Get git info
 */
function getGitInfo(projectRoot: string): { branch?: string; commit?: string } {
  try {
    const branch = execSync("git rev-parse --abbrev-ref HEAD", {
      cwd: projectRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim()

    const commit = execSync("git rev-parse --short HEAD", {
      cwd: projectRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim()

    return { branch, commit }
  } catch {
    return {}
  }
}

// ============================================================================
// Codemap Parsing
// ============================================================================

/**
 * Parse an existing codemap file
 */
export function parseCodemap(filePath: string): Codemap | null {
  try {
    const content = readFileSync(filePath, "utf8")
    return parseCodemapContent(content, dirname(filePath))
  } catch {
    return null
  }
}

/**
 * Parse codemap content
 */
function parseCodemapContent(content: string, directory: string): Codemap {
  const sections: CodemapSections = {}

  // Parse responsibility
  const respMatch = content.match(/## RESPONSIBILITY\n\n(.+?)(?=\n##|\n$)/s)
  if (respMatch) {
    sections.responsibility = respMatch[1].trim()
  }

  // Parse generated timestamp
  const genMatch = content.match(/> Generated: (.+)/)
  const generatedAt = genMatch ? new Date(genMatch[1]).getTime() : Date.now()

  // Parse git info
  const branchMatch = content.match(/> Branch: (.+)/)
  const commitMatch = content.match(/> Commit: (.+)/)

  return {
    directory,
    generatedAt,
    branch: branchMatch?.[1],
    commitHash: commitMatch?.[1],
    sections,
  }
}

/**
 * Extract summary from codemap for context injection
 */
export function extractCodemapSummary(codemap: Codemap, maxLength: number = 400): string {
  const parts: string[] = []

  if (codemap.sections.responsibility) {
    parts.push(`**${basename(codemap.directory)}:** ${codemap.sections.responsibility}`)
  }

  if (codemap.sections.design?.patterns.length) {
    parts.push(`Patterns: ${codemap.sections.design.patterns.join(", ")}`)
  }

  if (codemap.sections.flow?.entryPoints.length) {
    parts.push(`Entry: ${codemap.sections.flow.entryPoints.join(", ")}`)
  }

  let summary = parts.join("\n")

  if (summary.length > maxLength) {
    summary = summary.slice(0, maxLength - 3) + "..."
  }

  return summary
}
