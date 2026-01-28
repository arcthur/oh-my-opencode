/**
 * Budget Monitor Types
 *
 * Type definitions for token budget monitoring and circuit breaker.
 * Implements the "hidden budget" strategy from design doc.
 *
 * @see docs/governance-orchestration-design.md Section 2.6
 */

// ============================================================================
// Core Budget Types
// ============================================================================

/**
 * Token budget allocation for a task/session
 */
export interface TokenBudget {
  /** Total allocated budget (tokens) */
  allocated: number

  /** Currently consumed (tokens) */
  consumed: number

  /** Warning threshold (default: 0.7 = 70%) */
  warningThreshold: number

  /** Force refactor threshold (default: 0.9 = 90%) */
  refactorThreshold: number

  /** Hard limit (default: 0.95 = 95%) */
  hardLimit: number
}

/**
 * Default budget thresholds
 */
export const DEFAULT_BUDGET_THRESHOLDS = {
  warningThreshold: 0.7,
  refactorThreshold: 0.9,
  hardLimit: 0.95,
} as const

/**
 * Budget status phases
 */
export type BudgetPhase = "healthy" | "midpoint" | "wrapUp" | "critical"

/**
 * Current budget status
 */
export interface BudgetStatus {
  /** Tokens consumed */
  consumed: number

  /** Total allocated tokens */
  allocated: number

  /** Usage percentage (0-1) */
  percentage: number

  /** Tokens remaining */
  remaining: number

  /** Current phase */
  phase: BudgetPhase

  /** Estimated remaining steps (hidden budget) */
  estimatedSteps: number
}

// ============================================================================
// Budget Events
// ============================================================================

/**
 * Budget monitor event types
 */
export type BudgetMonitorEvent =
  | BudgetConsumptionEvent
  | BudgetWarningEvent
  | BudgetGCTriggeredEvent
  | BudgetGCDegradedEvent
  | BudgetRefactorTriggeredEvent
  | BudgetHardLimitEvent

export interface BudgetConsumptionEvent {
  type: "consumption"
  amount: number
  total: number
  percentage: number
}

export interface BudgetWarningEvent {
  type: "warning"
  percentage: number
  remaining: number
  phase: BudgetPhase
  estimatedSteps: number
}

export interface BudgetGCTriggeredEvent {
  type: "gc-triggered"
  percentage: number
  reason: string
}

export interface BudgetGCDegradedEvent {
  type: "gc-degraded"
  percentage: number
  reason: string
  message: string
}

export interface BudgetRefactorTriggeredEvent {
  type: "refactor-triggered"
  percentage: number
  reason: string
}

export interface BudgetHardLimitEvent {
  type: "hard-limit-reached"
  consumed: number
  allocated: number
}

// ============================================================================
// Garbage Collection Types
// ============================================================================

/**
 * Target for garbage collection
 */
export interface GCTarget {
  /** Type of item to collect */
  type: "tool_output" | "intermediate" | "verbose_log" | "stale_context"

  /** Maximum age in turns (for age-based collection) */
  maxAge?: number

  /** Predicate for conditional collection */
  predicate?: (item: unknown) => boolean

  /** Collect all items of this type */
  all?: boolean
}

/**
 * Result of garbage collection
 */
export interface GCResult {
  /** Tokens freed */
  freedTokens: number

  /** Items removed by type */
  removedItems: Array<{
    type: GCTarget["type"]
    count: number
  }>

  /** Items preserved (not collected) */
  preservedItems: string[]

  /** Timestamp of GC */
  timestamp: number

  /** Whether GC degraded to hint-only mode */
  degraded?: boolean

  /** Reason for degradation (if degraded) */
  degradeReason?: string
}

/**
 * Default GC targets
 */
export const DEFAULT_GC_TARGETS: GCTarget[] = [
  { type: "tool_output", maxAge: 10 },
  { type: "intermediate", predicate: (item: any) => item?.verbose === true },
  { type: "verbose_log", all: true },
]

/**
 * Items to always preserve during GC
 */
export const ALWAYS_PRESERVE = [
  "task_definition",
  "current_plan",
  "key_decisions",
  "latest_file_states",
  "error_context",
] as const

// ============================================================================
// Context Summary Types (for Session Fork)
// ============================================================================

/**
 * Summary of current task progress (for session fork)
 */
export interface ContextSummary {
  /** Compressed representation of current progress */
  progressSummary: string

  /** Key decisions made so far */
  keyDecisions: Array<{
    decision: string
    rationale: string
    timestamp: number
  }>

  /** Files modified with change summaries */
  fileChanges: Array<{
    path: string
    changeType: "created" | "modified" | "deleted"
    summary: string
  }>

  /** Remaining work items */
  remainingTasks: string[]

  /** Blockers or issues */
  blockers: string[]
}

/**
 * Critical context to carry forward to new session
 */
export interface CriticalContext {
  /** Minimal context summary */
  summary: string

  /** Last checkpoint ID for recovery */
  checkpointId?: string

  /** Essential file contents to carry */
  essentialFiles: Map<string, string>

  /** Next action to take */
  nextAction: string
}

/**
 * Result of session fork
 */
export interface ForkResult {
  /** New session ID */
  newSessionId: string

  /** Transfer manifest */
  manifest: TransferManifest

  /** Handoff prompt for new session */
  handoffPrompt: string

  /** Budget allocated to new session */
  newBudget: TokenBudget
}

/**
 * Transfer manifest for session handoff
 */
export interface TransferManifest {
  /** Task progress percentage */
  progressPercentage: number

  /** Completed milestones */
  completedMilestones: string[]

  /** Remaining work items */
  remainingWork: string[]

  /** Critical context */
  criticalContext: {
    keyDecisions: string[]
    currentState: string
    blockers: string[]
  }

  /** Files to carry forward */
  essentialFiles: string[]

  /** Timestamp of fork */
  timestamp: number

  /** Original session ID */
  originalSessionId: string
}

// ============================================================================
// Phase Descriptions (Hidden Budget Strategy)
// ============================================================================

/**
 * Phase descriptions for LLM (hidden budget strategy)
 * Never expose raw token counts - use qualitative descriptions
 */
export const PHASE_DESCRIPTIONS: Record<BudgetPhase, string> = {
  healthy: "You have plenty of capacity to explore thoroughly.",
  midpoint: "Good progress. Continue with your current approach.",
  wrapUp: "Begin consolidating your work toward deliverables.",
  critical: "Focus only on essential remaining tasks.",
}

/**
 * Generate convergence hint for LLM
 */
export function generateConvergenceHint(
  phase: BudgetPhase,
  estimatedSteps: number
): string {
  const lines: string[] = [
    `[Progress Update] ${PHASE_DESCRIPTIONS[phase]}`,
    `Estimated capacity: approximately ${estimatedSteps} more actions.`,
  ]

  if (phase === "wrapUp") {
    lines.push("")
    lines.push("Please:")
    lines.push("1. Identify the 2-3 most critical remaining items")
    lines.push("2. Begin producing deliverable outputs")
    lines.push("3. Defer non-essential improvements")
  }

  if (phase === "critical") {
    lines.push("")
    lines.push("IMPORTANT:")
    lines.push("- Complete only essential tasks")
    lines.push("- Skip optional optimizations")
    lines.push("- Produce final deliverables now")
  }

  return lines.join("\n")
}

// ============================================================================
// Configuration Types
// ============================================================================

/**
 * Budget monitor configuration
 */
export interface BudgetMonitorConfig {
  /** Default token budget per task */
  defaultAllocation: number

  /** Warning threshold (0-1) */
  warningThreshold: number

  /** Refactor threshold (0-1) */
  refactorThreshold: number

  /** Hard limit (0-1) */
  hardLimit: number

  /** Enable automatic GC at warning threshold */
  autoGC: boolean

  /** Enable automatic session fork at refactor threshold */
  autoFork: boolean

  /** GC targets */
  gcTargets: GCTarget[]

  /** Items to always preserve during GC */
  preserveItems: string[]
}

export const DEFAULT_BUDGET_CONFIG: BudgetMonitorConfig = {
  defaultAllocation: 100000,
  warningThreshold: 0.7,
  refactorThreshold: 0.9,
  hardLimit: 0.95,
  autoGC: true,
  autoFork: false, // Requires manual approval by default
  gcTargets: DEFAULT_GC_TARGETS,
  preserveItems: [...ALWAYS_PRESERVE],
}

// ============================================================================
// Error Types
// ============================================================================

/**
 * Error thrown when budget is exhausted
 */
export class BudgetExhaustedError extends Error {
  readonly consumed: number
  readonly allocated: number

  constructor(message: string, consumed: number, allocated: number) {
    super(message)
    this.name = "BudgetExhaustedError"
    this.consumed = consumed
    this.allocated = allocated
  }
}

/**
 * Error thrown when session fork is required
 */
export class SessionForkRequiredError extends Error {
  readonly manifest: TransferManifest
  readonly criticalContext: CriticalContext

  constructor(message: string, manifest: TransferManifest, context: CriticalContext) {
    super(message)
    this.name = "SessionForkRequiredError"
    this.manifest = manifest
    this.criticalContext = context
  }
}
