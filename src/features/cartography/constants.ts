/**
 * Cartography Constants
 *
 * Configuration constants and defaults for the Cartography system.
 */

import { join } from "node:path"
import { getOpenCodeStorageDir } from "../../shared/data-path"

// ============================================================================
// Storage Paths
// ============================================================================

/** Base storage directory for OpenCode */
export const OPENCODE_STORAGE = getOpenCodeStorageDir()

/** Storage directory for cartography session data */
export const CARTOGRAPHY_STORAGE = join(OPENCODE_STORAGE, "cartography")

/** State file name (stored in project's .opencode directory) */
export const STATE_FILE_NAME = "cartography.json"

/** Codemap file name */
export const CODEMAP_FILE_NAME = "codemap.md"

/** Root project map file name */
export const ROOT_PROJECT_MAP_FILE_NAME = "project-map.md"

// ============================================================================
// Project-local paths (relative to project root)
// ============================================================================

/** Project-local storage directory */
export const PROJECT_STORAGE_DIR = ".opencode"

/** State file path (relative to project root) */
export function getStateFilePath(projectRoot: string): string {
  return join(projectRoot, PROJECT_STORAGE_DIR, STATE_FILE_NAME)
}

/** Codemap file path for a directory */
export function getCodemapPath(directory: string): string {
  return join(directory, CODEMAP_FILE_NAME)
}

/** Root project map path */
export function getProjectMapPath(projectRoot: string): string {
  return join(projectRoot, ROOT_PROJECT_MAP_FILE_NAME)
}

// ============================================================================
// Scoring Constants
// ============================================================================

/** Score threshold for generating codemap */
export const SCORE_THRESHOLD_GENERATE = 15

/** Score threshold for conditional generation (distinct domain check) */
export const SCORE_THRESHOLD_CONDITIONAL = 8

/** Scoring weights */
export const SCORING_WEIGHTS = {
  fileCount: 3,
  subdirCount: 2,
  codeRatio: 2,
  uniquePatterns: 1,
  moduleBoundary: 2,
  symbolDensity: 2,
  exportCount: 2,
  referenceCentrality: 3,
} as const

/** Score thresholds for high values */
export const SCORE_THRESHOLDS = {
  /** High file count */
  fileCountHigh: 20,
  /** High subdirectory count */
  subdirCountHigh: 5,
  /** High code ratio */
  codeRatioHigh: 0.7,
  /** High symbol density */
  symbolDensityHigh: 30,
  /** High export count */
  exportCountHigh: 10,
  /** High reference centrality */
  referenceCentralityHigh: 20,
} as const

// ============================================================================
// Analysis Constants
// ============================================================================

/** Maximum files to analyze in a single directory */
export const MAX_FILES_PER_DIRECTORY = 100

/** Maximum lines to read from a single file for analysis */
export const MAX_LINES_PER_FILE = 2000

/** Timeout for explorer tasks in milliseconds */
export const EXPLORER_TASK_TIMEOUT_MS = 120000 // 2 minutes

/** Polling interval for background tasks */
export const POLLING_INTERVAL_MS = 2000

/** Staleness threshold for codemap (percentage of changed files) */
export const STALENESS_THRESHOLD = 0.3 // 30%

// ============================================================================
// Module Boundary Patterns
// ============================================================================

/** Patterns indicating module boundaries (index files) */
export const MODULE_BOUNDARY_PATTERNS = [
  "index.ts",
  "index.tsx",
  "index.js",
  "index.jsx",
  "__init__.py",
  "mod.rs",
  "main.go",
  "lib.rs",
] as const

// ============================================================================
// Code File Extensions
// ============================================================================

/** Extensions considered as code files */
export const CODE_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".py",
  ".go",
  ".rs",
  ".java",
  ".kt",
  ".scala",
  ".rb",
  ".php",
  ".swift",
  ".c",
  ".cpp",
  ".h",
  ".hpp",
  ".cs",
])

/** Extensions to analyze (code + config) */
export const ANALYZABLE_EXTENSIONS = new Set([
  ...CODE_EXTENSIONS,
  ".json",
  ".yaml",
  ".yml",
  ".toml",
  ".md",
])

// ============================================================================
// Codemap Generation Constants
// ============================================================================

/** Maximum lines for root codemap */
export const MAX_ROOT_CODEMAP_LINES = 150

/** Minimum lines for root codemap */
export const MIN_ROOT_CODEMAP_LINES = 50

/** Maximum lines for subdirectory codemap */
export const MAX_SUBDIR_CODEMAP_LINES = 80

/** Minimum lines for subdirectory codemap */
export const MIN_SUBDIR_CODEMAP_LINES = 30

// ============================================================================
// Explorer Prompts
// ============================================================================

/** Base prompt for explorer analysis */
export const EXPLORER_BASE_PROMPT = `Analyze this directory for the Cartography system. Focus on:
1. RESPONSIBILITY: What does this directory/module do? (1-2 sentences)
2. DESIGN: Key patterns, abstractions, and design decisions
3. FLOW: How data/control flows through this module
4. INTEGRATION: How this connects to other parts of the codebase

Be concise and specific. Avoid generic advice. Focus on what's unique to THIS directory.`

/** Prompt suffix for responsibility analysis */
export const RESPONSIBILITY_PROMPT = `Focus on RESPONSIBILITY only:
- What is the single main purpose of this directory?
- What problems does it solve?
- What would break if this directory didn't exist?`

/** Prompt suffix for design analysis */
export const DESIGN_PROMPT = `Focus on DESIGN only:
- What architectural patterns are used?
- What are the core abstractions?
- What key design decisions were made?`

/** Prompt suffix for flow analysis */
export const FLOW_PROMPT = `Focus on FLOW only:
- What are the entry points?
- How does data flow through this module?
- What are the outputs/exit points?`

/** Prompt suffix for integration analysis */
export const INTEGRATION_PROMPT = `Focus on INTEGRATION only:
- What does this module depend on?
- What depends on this module?
- How does it connect to external systems?`

// ============================================================================
// Dynamic Agent Scaling
// ============================================================================

/**
 * Calculate number of additional explorers based on project scale
 */
export function calculateDynamicExplorerCount(metrics: {
  totalFiles: number
  totalLines: number
  maxDepth: number
  largeFilesCount: number
  packageCount: number
  languageCount: number
}): number {
  let additional = 0

  // +1 per 100 files (>100)
  if (metrics.totalFiles > 100) {
    additional += Math.floor(metrics.totalFiles / 100)
  }

  // +1 per 10k lines (>10k)
  if (metrics.totalLines > 10000) {
    additional += Math.floor(metrics.totalLines / 10000)
  }

  // +2 for deep exploration (depth >= 4)
  if (metrics.maxDepth >= 4) {
    additional += 2
  }

  // +1 for complexity hotspots (>10 large files)
  if (metrics.largeFilesCount > 10) {
    additional += 1
  }

  // +1 per package/workspace (monorepo)
  if (metrics.packageCount > 1) {
    additional += metrics.packageCount
  }

  // +1 per additional language (>1)
  if (metrics.languageCount > 1) {
    additional += metrics.languageCount - 1
  }

  return additional
}

// ============================================================================
// Trigger Keywords for Smart Injection
// ============================================================================

/** Keywords indicating architecture questions */
export const ARCHITECTURE_KEYWORDS = [
  "architecture",
  "design",
  "structure",
  "how does",
  "how do",
  "overview",
  "explain",
  "understand",
  "flow",
  "pattern",
  // Chinese equivalents
  "架构",
  "设计",
  "结构",
  "流程",
  "模式",
  "理解",
  "概览",
]

/** Keywords indicating navigation questions */
export const NAVIGATION_KEYWORDS = [
  "where",
  "which file",
  "find",
  "locate",
  "look for",
  // Chinese equivalents
  "在哪",
  "哪个文件",
  "找到",
  "定位",
]

/** Keywords indicating refactoring intent */
export const REFACTORING_KEYWORDS = [
  "refactor",
  "move",
  "split",
  "merge",
  "rename",
  "extract",
  "inline",
  // Chinese equivalents
  "重构",
  "移动",
  "拆分",
  "合并",
  "重命名",
  "提取",
]
