/**
 * Cartography Analyzer
 *
 * Analysis pipeline integrating LSP, AST-grep, and parallel Explorer agents
 * to gather comprehensive information about code directories.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative, extname, basename } from "node:path"
import type { PluginInput } from "@opencode-ai/plugin"
import type {
  DirectoryInfo,
  DirectoryScore,
  ScoreBreakdown,
  AnalysisResult,
  SymbolInfo,
  PatternInfo,
  FlowInfo,
  IntegrationInfo,
  ExplorerTaskInput,
  ExplorerTaskResult,
  CartographyConfig,
} from "./types"
import {
  SCORING_WEIGHTS,
  SCORE_THRESHOLDS,
  SCORE_THRESHOLD_GENERATE,
  SCORE_THRESHOLD_CONDITIONAL,
  MODULE_BOUNDARY_PATTERNS,
  CODE_EXTENSIONS,
  EXPLORER_TASK_TIMEOUT_MS,
  EXPLORER_BASE_PROMPT,
  MAX_FILES_PER_DIRECTORY,
  MAX_LINES_PER_FILE,
} from "./constants"
import { matchesPatterns, shouldTraverseDirectory } from "./pattern-matcher"
import { log } from "../../shared"

// ============================================================================
// Directory Discovery
// ============================================================================

/**
 * Discover all directories that need analysis
 */
export async function discoverDirectories(
  projectRoot: string,
  config: CartographyConfig
): Promise<DirectoryInfo[]> {
  const directories: DirectoryInfo[] = []
  const excludePatterns = config.exclude_patterns

  function traverse(dir: string, depth: number): void {
    if (depth > config.max_depth) return

    const info = analyzeDirectoryInfo(dir, projectRoot, depth, config)
    // Root should always be included (generation decision handled by scoring rules)
    if (info && (depth === 0 || info.fileCount >= config.min_files)) {
      directories.push(info)
    }

    // Traverse subdirectories
    try {
      const entries = readdirSync(dir, { withFileTypes: true })
      for (const entry of entries) {
        if (!entry.isDirectory()) continue
        if (entry.name.startsWith(".")) continue

        const fullPath = join(dir, entry.name)
        if (!shouldTraverseDirectory(fullPath, projectRoot, excludePatterns)) {
          continue
        }

        traverse(fullPath, depth + 1)
      }
    } catch {
      // Directory not readable
    }
  }

  traverse(projectRoot, 0)
  return directories
}

/**
 * Analyze basic directory information
 */
function analyzeDirectoryInfo(
  dir: string,
  projectRoot: string,
  depth: number,
  config: CartographyConfig
): DirectoryInfo | null {
  try {
    const entries = readdirSync(dir, { withFileTypes: true })
    const files: string[] = []
    const extensions = new Set<string>()
    let subdirCount = 0
    let totalLines = 0

    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!entry.name.startsWith(".") && !isIgnoredDir(entry.name)) {
          subdirCount++
        }
        continue
      }

      if (!entry.isFile()) continue

      const filePath = join(dir, entry.name)
      if (!matchesPatterns(filePath, projectRoot, {
        includePatterns: config.include_patterns,
        excludePatterns: config.exclude_patterns,
      })) {
        continue
      }

      files.push(entry.name)
      extensions.add(extname(entry.name))

      // Count lines for code files
      if (CODE_EXTENSIONS.has(extname(entry.name))) {
        try {
          const content = readFileSync(filePath, "utf8")
          totalLines += content.split("\n").length
        } catch {
          // Skip unreadable files
        }
      }
    }

    if (files.length === 0 && depth !== 0) return null

    return {
      path: dir,
      relativePath: relative(projectRoot, dir) || ".",
      name: basename(dir) || basename(projectRoot),
      depth,
      fileCount: files.length,
      lineCount: totalLines,
      extensions: [...extensions],
      hasSubdirs: subdirCount > 0,
      subdirCount,
    }
  } catch {
    return null
  }
}

/**
 * Check if directory name is commonly ignored
 */
function isIgnoredDir(name: string): boolean {
  const ignored = new Set([
    "node_modules",
    "dist",
    "build",
    ".next",
    ".nuxt",
    ".venv",
    "venv",
    "__pycache__",
    "target",
    "coverage",
    ".turbo",
  ])
  return ignored.has(name)
}

// ============================================================================
// Directory Scoring
// ============================================================================

/**
 * Score a directory for codemap generation
 */
export function scoreDirectory(
  info: DirectoryInfo,
  analysisResults?: AnalysisResult[]
): DirectoryScore {
  const breakdown = calculateScoreBreakdown(info, analysisResults)
  const score = calculateTotalScore(breakdown)
  const { shouldGenerate, reason } = determineGeneration(info, score)

  return {
    path: info.path,
    score,
    breakdown,
    shouldGenerate,
    reason,
  }
}

/**
 * Calculate score breakdown for a directory
 */
function calculateScoreBreakdown(
  info: DirectoryInfo,
  analysisResults?: AnalysisResult[]
): ScoreBreakdown {
  // File count score (3x weight)
  const fileCount = info.fileCount >= SCORE_THRESHOLDS.fileCountHigh ? 3 :
    Math.min(3, Math.floor(info.fileCount / 7))

  // Subdirectory count score (2x weight)
  const subdirCount = info.subdirCount >= SCORE_THRESHOLDS.subdirCountHigh ? 2 :
    Math.min(2, Math.floor(info.subdirCount / 2.5))

  // Code ratio score (2x weight)
  const codeRatio = 2 // Assume high for now, can be refined with actual analysis

  // Module boundary score (2x weight)
  const hasModuleBoundary = hasIndexFile(info.path)
  const moduleBoundary = hasModuleBoundary ? 2 : 0

  // Initialize analysis-based scores
  let symbolDensity = 0
  let exportCount = 0
  let referenceCentrality = 0
  let uniquePatterns = 0

  // Calculate from analysis results if available
  if (analysisResults && analysisResults.length > 0) {
    const allSymbols = analysisResults.flatMap(r => r.symbols)
    const allPatterns = analysisResults.flatMap(r => r.patterns)

    // Symbol density (2x weight)
    symbolDensity = allSymbols.length >= SCORE_THRESHOLDS.symbolDensityHigh ? 2 :
      Math.min(2, Math.floor(allSymbols.length / 15))

    // Export count (2x weight)
    const exports = allSymbols.filter(s => s.isExported)
    exportCount = exports.length >= SCORE_THRESHOLDS.exportCountHigh ? 2 :
      Math.min(2, Math.floor(exports.length / 5))

    // Reference centrality (3x weight)
    const totalRefs = allSymbols.reduce((sum, s) => sum + (s.referenceCount ?? 0), 0)
    referenceCentrality = totalRefs >= SCORE_THRESHOLDS.referenceCentralityHigh ? 3 :
      Math.min(3, Math.floor(totalRefs / 7))

    // Unique patterns (1x weight)
    uniquePatterns = allPatterns.length > 0 ? 1 : 0
  }

  return {
    fileCount,
    subdirCount,
    codeRatio,
    uniquePatterns,
    moduleBoundary,
    symbolDensity,
    exportCount,
    referenceCentrality,
  }
}

/**
 * Calculate total score from breakdown
 */
function calculateTotalScore(breakdown: ScoreBreakdown): number {
  return (
    breakdown.fileCount * SCORING_WEIGHTS.fileCount +
    breakdown.subdirCount * SCORING_WEIGHTS.subdirCount +
    breakdown.codeRatio * SCORING_WEIGHTS.codeRatio +
    breakdown.uniquePatterns * SCORING_WEIGHTS.uniquePatterns +
    breakdown.moduleBoundary * SCORING_WEIGHTS.moduleBoundary +
    breakdown.symbolDensity * SCORING_WEIGHTS.symbolDensity +
    breakdown.exportCount * SCORING_WEIGHTS.exportCount +
    breakdown.referenceCentrality * SCORING_WEIGHTS.referenceCentrality
  )
}

/**
 * Determine if codemap should be generated
 */
function determineGeneration(
  info: DirectoryInfo,
  score: number
): { shouldGenerate: boolean; reason: string } {
  // Root always gets a codemap
  if (info.relativePath === ".") {
    return { shouldGenerate: true, reason: "root directory" }
  }

  // High score always generates
  if (score >= SCORE_THRESHOLD_GENERATE) {
    return { shouldGenerate: true, reason: "high complexity score" }
  }

  // Conditional score with distinct domain check
  if (score >= SCORE_THRESHOLD_CONDITIONAL) {
    // Check for distinct domain indicators
    const hasModuleBoundary = hasIndexFile(info.path)
    const hasOwnConfig = hasConfigFile(info.path)

    if (hasModuleBoundary || hasOwnConfig) {
      return { shouldGenerate: true, reason: "distinct domain" }
    }
  }

  return { shouldGenerate: false, reason: "score below threshold" }
}

/**
 * Check if directory has an index file (module boundary)
 */
function hasIndexFile(dir: string): boolean {
  for (const pattern of MODULE_BOUNDARY_PATTERNS) {
    if (existsSync(join(dir, pattern))) {
      return true
    }
  }
  return false
}

/**
 * Check if directory has its own config file
 */
function hasConfigFile(dir: string): boolean {
  const configPatterns = [
    "package.json",
    "pyproject.toml",
    "setup.py",
    "Cargo.toml",
    "go.mod",
    "tsconfig.json",
    ".eslintrc.json",
    ".eslintrc.js",
  ]

  for (const pattern of configPatterns) {
    if (existsSync(join(dir, pattern))) {
      return true
    }
  }
  return false
}

// ============================================================================
// Analysis Orchestration
// ============================================================================

/**
 * Main analyzer class
 */
export class CartographyAnalyzer {
  private projectRoot: string
  private config: CartographyConfig
  private ctx?: PluginInput

  constructor(
    projectRoot: string,
    config: CartographyConfig,
    ctx?: PluginInput
  ) {
    this.projectRoot = projectRoot
    this.config = config
    this.ctx = ctx
  }

  /**
   * Analyze a directory comprehensively
   */
  async analyze(dir: DirectoryInfo): Promise<AnalysisResult[]> {
    const results: AnalysisResult[] = []

    // Run all analysis methods in parallel
    const [staticResult, explorerResult] = await Promise.all([
      this.runStaticAnalysis(dir),
      this.spawnExplorer(dir),
    ])

    if (staticResult) {
      results.push(staticResult)
    }

    if (explorerResult) {
      results.push(explorerResult)
    }

    return results
  }

  /**
   * Run static analysis (file parsing)
   */
  private async runStaticAnalysis(dir: DirectoryInfo): Promise<AnalysisResult | null> {
    try {
      const symbols: SymbolInfo[] = []
      const patterns: PatternInfo[] = []
      const flows: FlowInfo[] = []
      const integrations: IntegrationInfo[] = []

      // Read and analyze code files
      const entries = readdirSync(dir.path, { withFileTypes: true })
      let filesAnalyzed = 0

      for (const entry of entries) {
        if (!entry.isFile()) continue
        if (filesAnalyzed >= MAX_FILES_PER_DIRECTORY) break

        const ext = extname(entry.name)
        if (!CODE_EXTENSIONS.has(ext)) continue

        const filePath = join(dir.path, entry.name)
        const fileSymbols = this.extractSymbolsFromFile(filePath, dir.path)
        symbols.push(...fileSymbols)

        const fileIntegrations = this.extractIntegrationsFromFile(filePath, dir.path)
        integrations.push(...fileIntegrations)

        filesAnalyzed++
      }

      // Detect patterns from symbols
      patterns.push(...this.detectPatterns(symbols, dir.path))

      return {
        directory: dir.path,
        symbols,
        patterns,
        flows,
        integrations,
        source: "ast-grep",
      }
    } catch (error) {
      log("[cartography] Static analysis failed:", error)
      return null
    }
  }

  /**
   * Extract symbols from a file using regex (fallback when LSP unavailable)
   */
  private extractSymbolsFromFile(filePath: string, directory: string): SymbolInfo[] {
    const symbols: SymbolInfo[] = []

    try {
      const content = readFileSync(filePath, "utf8")
      const lines = content.split("\n")
      const relativePath = relative(directory, filePath)

      // Limit lines analyzed
      const maxLines = Math.min(lines.length, MAX_LINES_PER_FILE)

      for (let i = 0; i < maxLines; i++) {
        const line = lines[i]

        // TypeScript/JavaScript patterns
        const exportMatch = line.match(/^export\s+(const|function|class|interface|type|enum)\s+(\w+)/)
        if (exportMatch) {
          symbols.push({
            name: exportMatch[2],
            type: mapTypeKeyword(exportMatch[1]),
            filePath: relativePath,
            line: i + 1,
            isExported: true,
          })
          continue
        }

        // Non-exported declarations
        const declMatch = line.match(/^(const|function|class|interface|type|enum)\s+(\w+)/)
        if (declMatch) {
          symbols.push({
            name: declMatch[2],
            type: mapTypeKeyword(declMatch[1]),
            filePath: relativePath,
            line: i + 1,
            isExported: false,
          })
          continue
        }

        // Python patterns
        const pyClassMatch = line.match(/^class\s+(\w+)/)
        if (pyClassMatch) {
          symbols.push({
            name: pyClassMatch[1],
            type: "class",
            filePath: relativePath,
            line: i + 1,
            isExported: true, // Python classes are generally accessible
          })
          continue
        }

        const pyFuncMatch = line.match(/^def\s+(\w+)/)
        if (pyFuncMatch) {
          symbols.push({
            name: pyFuncMatch[1],
            type: "function",
            filePath: relativePath,
            line: i + 1,
            isExported: !pyFuncMatch[1].startsWith("_"),
          })
        }
      }
    } catch {
      // File not readable
    }

    return symbols
  }

  /**
   * Extract integration points from a file
   */
  private extractIntegrationsFromFile(filePath: string, directory: string): IntegrationInfo[] {
    const integrations: IntegrationInfo[] = []

    try {
      const content = readFileSync(filePath, "utf8")
      const relativePath = relative(directory, filePath)

      // Import statements
      const importMatches = content.matchAll(/import\s+.*?from\s+['"](.*?)['"]/g)
      for (const match of importMatches) {
        const target = match[1]
        // Skip relative imports within same directory
        if (!target.startsWith(".") || target.includes("..")) {
          integrations.push({
            name: target,
            type: "import",
            sourceFile: relativePath,
            target,
            direction: "incoming",
          })
        }
      }

      // API/HTTP calls
      const apiPatterns = [
        /fetch\(['"](.*?)['"]/g,
        /axios\.(get|post|put|delete)\(['"](.*?)['"]/g,
        /\.get\(['"](\/.*?)['"]/g,
        /\.post\(['"](\/.*?)['"]/g,
      ]

      for (const pattern of apiPatterns) {
        const matches = content.matchAll(pattern)
        for (const match of matches) {
          const target = match[1] || match[2]
          if (target && target.startsWith("/")) {
            integrations.push({
              name: `API: ${target}`,
              type: "api",
              sourceFile: relativePath,
              target,
              direction: "outgoing",
            })
          }
        }
      }
    } catch {
      // File not readable
    }

    return integrations
  }

  /**
   * Detect design patterns from symbols
   */
  private detectPatterns(symbols: SymbolInfo[], directory: string): PatternInfo[] {
    const patterns: PatternInfo[] = []
    const relativePath = relative(this.projectRoot, directory)

    // Singleton pattern detection
    const singletonNames = symbols
      .filter(s => s.name.toLowerCase().includes("singleton") ||
        s.name.toLowerCase().includes("instance"))
      .map(s => s.filePath)

    if (singletonNames.length > 0) {
      patterns.push({
        name: "Singleton",
        category: "creational",
        files: [...new Set(singletonNames)],
        description: "Singleton pattern detected",
        confidence: 0.7,
      })
    }

    // Factory pattern detection
    const factoryNames = symbols
      .filter(s => s.name.toLowerCase().includes("factory") ||
        s.name.toLowerCase().includes("create"))
      .map(s => s.filePath)

    if (factoryNames.length > 0) {
      patterns.push({
        name: "Factory",
        category: "creational",
        files: [...new Set(factoryNames)],
        description: "Factory pattern detected",
        confidence: 0.6,
      })
    }

    // Hook pattern (React)
    const hookSymbols = symbols.filter(s => s.name.startsWith("use") && s.type === "function")
    if (hookSymbols.length > 0) {
      patterns.push({
        name: "React Hooks",
        category: "behavioral",
        files: [...new Set(hookSymbols.map(s => s.filePath))],
        description: `${hookSymbols.length} custom hooks detected`,
        confidence: 0.9,
      })
    }

    return patterns
  }

  /**
   * Spawn an Explorer agent for deep analysis
   */
  private async spawnExplorer(dir: DirectoryInfo): Promise<AnalysisResult | null> {
    // If no plugin context, skip explorer
    if (!this.ctx) {
      log("[cartography] No plugin context, skipping explorer")
      return null
    }

    const input: ExplorerTaskInput = {
      directory: dir.path,
      focus: "full",
      context: `Directory: ${dir.relativePath}\nFiles: ${dir.fileCount}\nLines: ${dir.lineCount}`,
    }

    try {
      const prompt = this.buildExplorerPrompt(dir, input)

      // Note: In actual implementation, this would use the BackgroundManager
      // or delegate_task tool to spawn an explorer agent
      log("[cartography] Would spawn explorer for:", dir.relativePath)

      // For now, return null as we need integration with the tool system
      return null
    } catch (error) {
      log("[cartography] Explorer spawn failed:", error)
      return null
    }
  }

  /**
   * Build prompt for explorer agent
   */
  private buildExplorerPrompt(dir: DirectoryInfo, input: ExplorerTaskInput): string {
    const focusPrompts: Record<string, string> = {
      responsibility: `Focus on what this directory does. What is its single main purpose?`,
      design: `Focus on architectural patterns, abstractions, and design decisions.`,
      flow: `Focus on data/control flow: entry points, processing, and outputs.`,
      integration: `Focus on dependencies and how this connects to other modules.`,
      full: EXPLORER_BASE_PROMPT,
    }

    return `${focusPrompts[input.focus]}

Directory: ${dir.relativePath}
Files: ${dir.fileCount}
Lines: ${dir.lineCount}
Extensions: ${dir.extensions.join(", ")}
Has subdirectories: ${dir.hasSubdirs}

${input.context || ""}

Provide concise, specific analysis. Avoid generic advice.`
  }
}

/**
 * Map type keyword to SymbolInfo type
 */
function mapTypeKeyword(keyword: string): SymbolInfo["type"] {
  const mapping: Record<string, SymbolInfo["type"]> = {
    const: "const",
    function: "function",
    class: "class",
    interface: "interface",
    type: "type",
    enum: "type",
  }
  return mapping[keyword] ?? "variable"
}

/**
 * Merge multiple analysis results
 */
export function mergeAnalysisResults(results: AnalysisResult[]): AnalysisResult {
  const merged: AnalysisResult = {
    directory: results[0]?.directory ?? "",
    symbols: [],
    patterns: [],
    flows: [],
    integrations: [],
    source: "explorer",
  }

  for (const result of results) {
    merged.symbols.push(...result.symbols)
    merged.patterns.push(...result.patterns)
    merged.flows.push(...result.flows)
    merged.integrations.push(...result.integrations)
  }

  // Deduplicate symbols by name and file
  const seenSymbols = new Set<string>()
  merged.symbols = merged.symbols.filter(s => {
    const key = `${s.name}:${s.filePath}`
    if (seenSymbols.has(key)) return false
    seenSymbols.add(key)
    return true
  })

  // Deduplicate patterns by name
  const seenPatterns = new Set<string>()
  merged.patterns = merged.patterns.filter(p => {
    if (seenPatterns.has(p.name)) return false
    seenPatterns.add(p.name)
    return true
  })

  return merged
}

/**
 * Create an analyzer instance
 */
export function createAnalyzer(
  projectRoot: string,
  config: CartographyConfig,
  ctx?: PluginInput
): CartographyAnalyzer {
  return new CartographyAnalyzer(projectRoot, config, ctx)
}
