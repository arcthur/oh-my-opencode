import type { BuiltinAgentName } from "../agents/types"

/**
 * Task type classification for delegation decisions
 */
export type TaskType =
  | "exploration"
  | "implementation"
  | "debugging"
  | "refactoring"
  | "documentation"
  | "architecture"
  | "research"

/**
 * Complexity level for delegation decisions
 */
export type Complexity = "trivial" | "simple" | "moderate" | "complex"

/**
 * Domain classification for delegation decisions
 */
export type Domain = "frontend" | "backend" | "external" | "general"

/**
 * LLM-generated delegation decision JSON structure.
 * Sisyphus outputs this before every sisyphus_task call.
 */
export interface DelegationDecision {
  /** Target agent for delegation */
  agent: BuiltinAgentName
  /** Classification of the task type */
  taskType: TaskType
  /** Estimated complexity of the task */
  complexity: Complexity
  /** Primary domain of the task */
  domain: Domain
  /** 1-2 sentence explanation of why this agent is the best choice */
  reason: string
  /** Signals detected in the request that influenced this decision */
  signals: string[]
}

/**
 * Validation warning types
 */
export type ValidationWarningType =
  | "overkill"
  | "underkill"
  | "domain_mismatch"
  | "task_type_mismatch"
  | "missing_declaration"

/**
 * A single validation warning
 */
export interface ValidationWarning {
  /** Type of the warning */
  type: ValidationWarningType
  /** Human-readable warning message */
  message: string
  /** Optional suggestion for a better choice */
  suggestion?: string
}

/**
 * Result of validating a delegation decision
 */
export interface ValidationResult {
  /** Whether the decision passed validation (no warnings) */
  valid: boolean
  /** List of validation warnings */
  warnings: ValidationWarning[]
}

/**
 * Agent validation rules for the validator
 */
export interface AgentValidationRules {
  /** Valid task types for this agent */
  validTaskTypes: TaskType[]
  /** Valid complexity levels for this agent */
  validComplexity: Complexity[]
  /** Valid domains for this agent */
  validDomains: Domain[]
  /** Minimum complexity required (for expensive agents) */
  minComplexity?: Complexity
}
