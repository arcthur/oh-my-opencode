/**
 * Cartography Types
 *
 * Defines core types for the Cartography system which generates hierarchical
 * codemap.md files for codebase understanding and context injection.
 */

// ============================================================================
// Core Types
// ============================================================================

/**
 * Cartography operation mode
 */
export type CartographyMode = "init" | "update" | "changes"

/**
 * Options for cartography operations
 */
export interface CartographyOptions {
  /** Operation mode */
  mode: CartographyMode

  /** Maximum directory depth to analyze (default: 4) */
  maxDepth?: number

  /** Number of parallel explorers to spawn (default: 5) */
  parallelExplorers?: number

  /** Glob patterns to include */
  includePatterns?: string[]

  /** Glob patterns to exclude */
  excludePatterns?: string[]

  /** Force regeneration ignoring hashes */
  force?: boolean

  /** Minimum files in directory to generate codemap (default: 3) */
  minFiles?: number
}

/**
 * Result of a cartography operation
 */
export interface CartographyResult {
  /** Operation that was performed */
  mode: CartographyMode

  /** Directories that were analyzed */
  analyzedDirs: string[]

  /** Codemaps that were created */
  createdCodemaps: string[]

  /** Codemaps that were updated */
  updatedCodemaps: string[]

  /** Directories that were skipped (no changes) */
  skippedDirs: string[]

  /** Errors encountered */
  errors: CartographyError[]

  /** Total duration in milliseconds */
  durationMs: number
}

/**
 * Error during cartography operation
 */
export interface CartographyError {
  /** Directory where error occurred */
  directory: string

  /** Error message */
  message: string

  /** Error phase */
  phase: "discovery" | "analysis" | "generation"
}

// ============================================================================
// Directory Analysis Types
// ============================================================================

/**
 * Information about a directory to analyze
 */
export interface DirectoryInfo {
  /** Absolute path to directory */
  path: string

  /** Relative path from project root */
  relativePath: string

  /** Directory name */
  name: string

  /** Depth from project root */
  depth: number

  /** Number of code files */
  fileCount: number

  /** Total lines of code */
  lineCount: number

  /** File extensions present */
  extensions: string[]

  /** Whether directory has subdirectories */
  hasSubdirs: boolean

  /** Number of subdirectories */
  subdirCount: number
}

/**
 * Complexity score for a directory
 */
export interface DirectoryScore {
  /** Directory path */
  path: string

  /** Total complexity score */
  score: number

  /** Score breakdown */
  breakdown: ScoreBreakdown

  /** Whether codemap should be generated */
  shouldGenerate: boolean

  /** Reason for decision */
  reason: string
}

/**
 * Score breakdown by factor
 */
export interface ScoreBreakdown {
  /** File count contribution (3x weight, >20 files = high) */
  fileCount: number

  /** Subdirectory count contribution (2x weight, >5 = high) */
  subdirCount: number

  /** Code ratio contribution (2x weight, >70% = high) */
  codeRatio: number

  /** Unique patterns contribution (1x weight) */
  uniquePatterns: number

  /** Module boundary contribution (2x weight, has index = high) */
  moduleBoundary: number

  /** Symbol density contribution (2x weight, >30 = high) */
  symbolDensity: number

  /** Export count contribution (2x weight, >10 = high) */
  exportCount: number

  /** Reference centrality contribution (3x weight, >20 refs = high) */
  referenceCentrality: number
}

// ============================================================================
// Analysis Result Types
// ============================================================================

/**
 * Result from an analysis pass (LSP, AST, Explorer)
 */
export interface AnalysisResult {
  /** Directory that was analyzed */
  directory: string

  /** Symbols discovered */
  symbols: SymbolInfo[]

  /** Patterns detected */
  patterns: PatternInfo[]

  /** Flows identified */
  flows: FlowInfo[]

  /** Integration points */
  integrations: IntegrationInfo[]

  /** Raw explorer output (if applicable) */
  explorerOutput?: string

  /** Analysis source */
  source: "lsp" | "ast-grep" | "explorer"
}

/**
 * Information about a code symbol
 */
export interface SymbolInfo {
  /** Symbol name */
  name: string

  /** Symbol type */
  type: "class" | "function" | "interface" | "type" | "const" | "variable" | "export"

  /** File path */
  filePath: string

  /** Line number */
  line: number

  /** Reference count (if known) */
  referenceCount?: number

  /** Whether this is exported */
  isExported: boolean

  /** Symbol documentation */
  documentation?: string
}

/**
 * Design pattern detected
 */
export interface PatternInfo {
  /** Pattern name */
  name: string

  /** Pattern category */
  category: "architectural" | "behavioral" | "structural" | "creational"

  /** Files involved */
  files: string[]

  /** Description */
  description: string

  /** Confidence (0-1) */
  confidence: number
}

/**
 * Control flow information
 */
export interface FlowInfo {
  /** Flow name/description */
  name: string

  /** Entry point */
  entryPoint: string

  /** Steps in the flow */
  steps: FlowStep[]

  /** Exit points */
  exitPoints: string[]
}

/**
 * A step in a control flow
 */
export interface FlowStep {
  /** Step description */
  description: string

  /** File involved */
  file: string

  /** Function/method name */
  handler: string
}

/**
 * Integration point with external systems
 */
export interface IntegrationInfo {
  /** Integration name */
  name: string

  /** Integration type */
  type: "api" | "event" | "hook" | "plugin" | "import"

  /** Source file */
  sourceFile: string

  /** Target (if known) */
  target?: string

  /** Direction */
  direction: "incoming" | "outgoing" | "bidirectional"
}

// ============================================================================
// Codemap Types
// ============================================================================

/**
 * Parsed codemap structure
 */
export interface Codemap {
  /** Directory path */
  directory: string

  /** Generation timestamp */
  generatedAt: number

  /** Commit hash at generation */
  commitHash?: string

  /** Branch name */
  branch?: string

  /** Sections in the codemap */
  sections: CodemapSections
}

/**
 * Codemap sections
 */
export interface CodemapSections {
  /** Responsibility: what this directory/module does */
  responsibility?: string

  /** Design: patterns and architecture */
  design?: DesignSection

  /** Flow: control flow and data flow */
  flow?: FlowSection

  /** Integration: how this connects to other parts */
  integration?: IntegrationSection

  /** Anti-patterns: things to avoid */
  antiPatterns?: string[]

  /** Conventions: specific to this directory */
  conventions?: string[]

  /** Notes: miscellaneous important information */
  notes?: string[]
}

/**
 * Design section of codemap
 */
export interface DesignSection {
  /** Key patterns used */
  patterns: string[]

  /** Core abstractions */
  abstractions: string[]

  /** Design decisions */
  decisions: string[]
}

/**
 * Flow section of codemap
 */
export interface FlowSection {
  /** Entry points */
  entryPoints: string[]

  /** Main flows */
  flows: string[]

  /** Exit points / outputs */
  outputs: string[]
}

/**
 * Integration section of codemap
 */
export interface IntegrationSection {
  /** Dependencies (incoming) */
  dependencies: string[]

  /** Dependents (outgoing) */
  dependents: string[]

  /** External integrations */
  external: string[]
}

/**
 * Metadata for a generated codemap
 */
export interface CodemapMeta {
  /** Directory path */
  directory: string

  /** Codemap file path */
  filePath: string

  /** Generation timestamp */
  generatedAt: number

  /** Composite hash of source files */
  sourceHash: string

  /** Line count */
  lineCount: number

  /** Whether this is the root codemap */
  isRoot: boolean
}

// ============================================================================
// State Types
// ============================================================================

/**
 * Persistent state for cartography
 * Stored in .opencode/cartography.json
 */
export interface CartographyState {
  /** State version for migrations */
  version: number

  /** Last run timestamp */
  lastRun: number

  /** Project root path */
  projectRoot: string

  /** Configuration used */
  config: CartographyStateConfig

  /** File hashes for change detection */
  fileHashes: Record<string, string>

  /** Folder composite hashes */
  folderHashes: Record<string, string>

  /** Generated codemaps metadata */
  codemaps: Record<string, CodemapMeta>
}

/**
 * Configuration stored in state
 */
export interface CartographyStateConfig {
  /** Include patterns */
  includePatterns: string[]

  /** Exclude patterns */
  excludePatterns: string[]

  /** Directories with exceptions (force include/exclude) */
  exceptions: string[]
}

/**
 * Change detection report
 */
export interface ChangeReport {
  /** Directories with changes */
  changedDirs: string[]

  /** New directories (not in state) */
  newDirs: string[]

  /** Deleted directories (in state but not on disk) */
  deletedDirs: string[]

  /** Directories with stale codemaps */
  staleCodemaps: string[]

  /** Summary statistics */
  stats: {
    totalDirs: number
    changedCount: number
    newCount: number
    deletedCount: number
    upToDateCount: number
  }
}

// ============================================================================
// Explorer Task Types
// ============================================================================

/**
 * Input for an explorer task
 */
export interface ExplorerTaskInput {
  /** Directory to analyze */
  directory: string

  /** Analysis focus */
  focus: "responsibility" | "design" | "flow" | "integration" | "full"

  /** Additional context */
  context?: string

  /** File patterns to focus on */
  filePatterns?: string[]
}

/**
 * Result from an explorer task
 */
export interface ExplorerTaskResult {
  /** Task ID */
  taskId: string

  /** Directory analyzed */
  directory: string

  /** Status */
  status: "completed" | "failed" | "timeout"

  /** Analysis result */
  result?: AnalysisResult

  /** Error message (if failed) */
  error?: string

  /** Duration in milliseconds */
  durationMs: number
}

// ============================================================================
// Configuration Types (matches schema)
// ============================================================================

/**
 * Cartography configuration
 */
export interface CartographyConfig {
  /** Enable cartography (default: true) */
  enabled: boolean

  /** Maximum directory depth (default: 4) */
  max_depth: number

  /** Minimum files to generate codemap (default: 3) */
  min_files: number

  /** Maximum parallel explorers (default: 5) */
  max_parallel_explorers: number

  /** Include patterns */
  include_patterns: string[]

  /** Exclude patterns */
  exclude_patterns: string[]
}

/**
 * Codemap injector configuration
 */
export interface CodemapInjectorConfig {
  /** Enable injector (default: true) */
  enabled: boolean

  /** Token budget for injected content (default: 600) */
  budget: number

  /** Maximum tokens per codemap (default: 400) */
  max_per_codemap: number

  /** Suggest running cartography for unmapped dirs (default: true) */
  suggest_cartography: boolean

  /** Use semantic search for relevance (default: false) */
  semantic_search: boolean
}

// ============================================================================
// Default Configurations
// ============================================================================

/**
 * Default cartography configuration
 */
export const DEFAULT_CARTOGRAPHY_CONFIG: CartographyConfig = {
  enabled: true,
  max_depth: 4,
  min_files: 3,
  max_parallel_explorers: 5,
  include_patterns: [
    "**/*.ts",
    "**/*.tsx",
    "**/*.py",
    "**/*.go",
    "**/*.rs",
    "**/*.js",
    "**/*.jsx",
  ],
  exclude_patterns: [
    "**/node_modules/**",
    "**/.git/**",
    "**/dist/**",
    "**/build/**",
    "**/*.test.ts",
    "**/*.spec.ts",
    "**/tests/**",
    "**/__tests__/**",
    "**/.venv/**",
    "**/venv/**",
    "**/target/**",
    "**/__pycache__/**",
  ],
}

/**
 * Default codemap injector configuration
 */
export const DEFAULT_CODEMAP_INJECTOR_CONFIG: CodemapInjectorConfig = {
  enabled: true,
  budget: 600,
  max_per_codemap: 400,
  suggest_cartography: true,
  semantic_search: false,
}

/**
 * Current state version
 */
export const CARTOGRAPHY_STATE_VERSION = 1

/**
 * Empty state template
 */
export const EMPTY_CARTOGRAPHY_STATE: CartographyState = {
  version: CARTOGRAPHY_STATE_VERSION,
  lastRun: 0,
  projectRoot: "",
  config: {
    includePatterns: DEFAULT_CARTOGRAPHY_CONFIG.include_patterns,
    excludePatterns: DEFAULT_CARTOGRAPHY_CONFIG.exclude_patterns,
    exceptions: [],
  },
  fileHashes: {},
  folderHashes: {},
  codemaps: {},
}
