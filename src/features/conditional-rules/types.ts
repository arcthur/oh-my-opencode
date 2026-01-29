/**
 * Conditional Rules Types
 *
 * Path-sensitive rule injection based on working context.
 * Rules can be sourced from AGENTS.md files or configuration.
 */

// ============================================================================
// Core Rule Types
// ============================================================================

/**
 * A conditional rule that may be injected based on context
 */
export interface ConditionalRule {
  /** Unique identifier */
  id: string

  /** Human-readable name */
  name: string

  /** Rule source */
  source: RuleSource

  /** Match conditions (ALL must match - AND logic) */
  conditions: RuleCondition[]

  /** Rule content to inject */
  content: string

  /** Priority (higher = injected first) */
  priority: number

  /** Whether rule is enabled */
  enabled: boolean
}

/**
 * Rule source information
 */
export type RuleSource =
  | { type: "agents-md"; path: string; depth: number }
  | { type: "config"; section: string }
  | { type: "inline" }

// ============================================================================
// Condition Types
// ============================================================================

/**
 * Union of all condition types
 */
export type RuleCondition =
  | GlobCondition
  | DirectoryCondition
  | ContentCondition
  | ContextCondition

/**
 * Match files by glob pattern
 */
export interface GlobCondition {
  type: "glob"

  /** Glob pattern (e.g., "**\/*.tsx", "src/api/**") */
  pattern: string

  /**
   * Match any file (true) or all files (false)
   * @default true
   */
  matchAny?: boolean
}

/**
 * Match by directory path
 */
export interface DirectoryCondition {
  type: "directory"

  /** Directory path relative to project root */
  path: string

  /**
   * Include subdirectories
   * @default true
   */
  recursive?: boolean
}

/**
 * Match by file content
 */
export interface ContentCondition {
  type: "content"

  /** Regex pattern to match in file content */
  pattern: string

  /**
   * Only check files in current context
   * @default true
   */
  relevantFilesOnly?: boolean
}

/**
 * Match by execution context
 */
export interface ContextCondition {
  type: "context"

  /** Context matcher */
  match: ContextMatcher
}

/**
 * Context matchers
 */
export type ContextMatcher =
  | { agent: string }
  | { category: string }
  | { task: TaskPhase }
  | { skill: string }

export type TaskPhase = "planning" | "implementation" | "review" | "debugging"

// ============================================================================
// Matching Types
// ============================================================================

/**
 * Context for rule matching
 */
export interface RuleMatchContext {
  /** Files currently being worked on (relative to cwd) */
  files: string[]

  /** Current working directory */
  cwd: string

  /** Current agent (if any) */
  agent?: string

  /** Current delegation category (if any) */
  category?: string

  /** Current task phase */
  taskPhase?: TaskPhase

  /** Active skill (if any) */
  skill?: string
}

/**
 * Result of a successful rule match
 */
export interface MatchedRule {
  /** The matched rule */
  rule: ConditionalRule

  /** Which conditions matched */
  matchedConditions: RuleCondition[]

  /** Files that triggered the match */
  matchedFiles: string[]
}

/**
 * Result of matching a single condition
 */
export interface ConditionMatchResult {
  /** Whether condition matched */
  matched: boolean

  /** Files that matched (for file-based conditions) */
  files?: string[]
}

// ============================================================================
// AGENTS.md Parsing Types
// ============================================================================

/**
 * Parsed AGENTS.md file
 */
export interface ParsedAgentsMd {
  /** Global rules (no conditions) */
  globalRules: string

  /** Conditional blocks */
  conditionalBlocks: ConditionalBlock[]

  /** Source file path (absolute) */
  sourcePath: string

  /** Directory depth (for priority calculation) */
  depth: number
}

/**
 * A conditional block within AGENTS.md
 */
export interface ConditionalBlock {
  /** Glob pattern from include directive */
  pattern: string

  /** Rule content */
  content: string

  /** Line range in source file */
  lineStart: number
  lineEnd: number
}

// ============================================================================
// Configuration Types
// ============================================================================

/**
 * AGENTS.md discovery configuration
 */
export interface AgentsMdConfig {
  /**
   * Enable AGENTS.md file discovery
   * @default true
   */
  enabled: boolean

  /**
   * File names to search for
   * @default ["AGENTS.md", "AGENTS.local.md"]
   */
  file_names: string[]

  /**
   * Directories to ignore
   * @default ["node_modules", ".git", "dist", "coverage"]
   */
  ignore: string[]

  /**
   * Maximum directory depth to search
   * @default 10
   */
  max_depth: number
}

/**
 * Config-defined rule
 */
export interface ConfigRule {
  /** Unique rule ID */
  id: string

  /** Human-readable name */
  name: string

  /** Match conditions */
  conditions: RuleCondition[]

  /** Rule content (string or file reference) */
  content: string | { file: string }

  /**
   * Priority
   * @default 0
   */
  priority?: number

  /**
   * Enabled
   * @default true
   */
  enabled?: boolean
}

/**
 * Complete conditional rules configuration
 */
export interface ConditionalRulesConfig {
  /** AGENTS.md discovery settings */
  agents_md: AgentsMdConfig

  /** Config-defined rules */
  conditional_rules?: ConfigRule[]
}

// ============================================================================
// Default Values
// ============================================================================

export const DEFAULT_AGENTS_MD_CONFIG: AgentsMdConfig = {
  enabled: true,
  file_names: ["AGENTS.md", "AGENTS.local.md"],
  ignore: ["node_modules", ".git", "dist", "coverage", "vendor", ".next", "build", "__pycache__", ".venv", "venv", "target"],
  max_depth: 10,
}

export const DEFAULT_CONDITIONAL_RULES_CONFIG: ConditionalRulesConfig = {
  agents_md: DEFAULT_AGENTS_MD_CONFIG,
  conditional_rules: [],
}
