/**
 * Org Memory - Project/Team Level Memory
 *
 * Stores team conventions, coding standards, and architectural decisions
 * at the project level. Unlike User Memory (per-user), Org Memory is shared
 * across all team members working on the same project.
 *
 * Storage: .opencode/memory/org.json (in project root)
 */

export interface CodingConvention {
  /** Rule name (e.g., "api-naming") */
  name: string
  /** Rule description */
  description: string
  /** Example of correct usage */
  example?: string
  /** When this rule was added */
  addedAt: number
}

export interface ArchitecturalDecision {
  /** Decision title (e.g., "Use Redux for state management") */
  title: string
  /** Why this decision was made */
  rationale: string
  /** Alternatives considered */
  alternatives?: string[]
  /** When this decision was made */
  decidedAt: number
  /** Who made this decision (optional) */
  decidedBy?: string
}

export interface ProjectPattern {
  /** Pattern name (e.g., "error-handling") */
  name: string
  /** Pattern description */
  description: string
  /** File glob pattern where this applies */
  appliesTo?: string
  /** Example code */
  example?: string
}

export interface OrgMemory {
  /** Project name */
  projectName: string
  /** Coding conventions and style rules */
  conventions: CodingConvention[]
  /** Architectural decisions (ADRs) */
  architecturalDecisions: ArchitecturalDecision[]
  /** Common patterns used in the project */
  patterns: ProjectPattern[]
  /** Important project-specific terminology */
  terminology: Record<string, string>
  /** Files/paths that should never be modified */
  protectedPaths: string[]
  /** Custom rules added via "remember for project" */
  customRules: string[]
  /** Last updated timestamp */
  updatedAt: number
  /** Schema version for migrations */
  version: number
}

export interface OrgMemoryConfig {
  /** Enable org memory (default: true) */
  enabled: boolean
  /** Auto-inject org memory into sessions (default: true) */
  auto_inject: boolean
  /** Max conventions to include in context (default: 10) */
  max_conventions: number
  /** Max architectural decisions to include (default: 5) */
  max_decisions: number
  /** Max patterns to include (default: 5) */
  max_patterns: number
  /** Max terminology entries to include (default: 10) */
  max_terminology: number
  /** Max custom rules to include (default: 20) */
  max_custom_rules: number
}

export const DEFAULT_CONFIG: OrgMemoryConfig = {
  enabled: true,
  auto_inject: true,
  max_conventions: 10,
  max_decisions: 5,
  max_patterns: 5,
  max_terminology: 10,
  max_custom_rules: 20,
}

export const DEFAULT_ORG_MEMORY: OrgMemory = {
  projectName: "",
  conventions: [],
  architecturalDecisions: [],
  patterns: [],
  terminology: {},
  protectedPaths: [],
  customRules: [],
  updatedAt: Date.now(),
  version: 1,
}
