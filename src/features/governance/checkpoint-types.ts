/**
 * Semantic Checkpoint Types
 *
 * Type definitions for semantic checkpoints with environment awareness.
 * Implements layered state model for development task recovery.
 *
 * Layer 0: Task Intent - The task definition itself
 * Layer 1: Affected Files - Code files involved in the task
 * Layer 2: Dependencies - Environment dependencies
 * Layer 3: System State - Git status, branch information
 *
 * @see docs/governance-orchestration-design.md Section 2.1
 */

// ============================================================================
// Task Phase Model
// ============================================================================

/**
 * Coarse-grained task phases for partial-rerun decisions
 *
 * Phase progression: Perception -> Planning -> Execution -> Verification -> Delivery
 *
 * Each phase has:
 * - Defined inputs (what it needs to start)
 * - Defined outputs (what it produces)
 * - Re-run semantics (what happens if re-executed)
 */
export type TaskPhase =
  | "perception"   // Understanding codebase, reading files, gathering context
  | "planning"     // Deciding what to do, creating implementation plan
  | "execution"    // Writing code, making changes
  | "verification" // Running tests, validating changes
  | "delivery"     // Committing, creating PR, finalizing

/**
 * Phase metadata for replay semantics
 */
export interface PhaseDefinition {
  /** Phase identifier */
  phase: TaskPhase

  /** Required inputs to start this phase */
  requiredInputs: string[]

  /** Outputs produced by this phase */
  producedOutputs: string[]

  /** Whether this phase can be safely re-run */
  idempotent: boolean

  /** Actions that are part of this phase */
  actions: string[]
}

/**
 * Default phase definitions
 */
export const PHASE_DEFINITIONS: Record<TaskPhase, PhaseDefinition> = {
  perception: {
    phase: "perception",
    requiredInputs: ["task_description"],
    producedOutputs: ["codebase_understanding", "file_inventory"],
    idempotent: true,
    actions: ["read_file", "search_code", "list_directory"],
  },
  planning: {
    phase: "planning",
    requiredInputs: ["codebase_understanding", "task_description"],
    producedOutputs: ["implementation_plan", "affected_files_list"],
    idempotent: true,
    actions: ["create_plan", "analyze_dependencies"],
  },
  execution: {
    phase: "execution",
    requiredInputs: ["implementation_plan"],
    producedOutputs: ["modified_files", "new_files"],
    idempotent: false, // File writes may not be idempotent
    actions: ["write_file", "edit_file", "create_file", "delete_file"],
  },
  verification: {
    phase: "verification",
    requiredInputs: ["modified_files"],
    producedOutputs: ["test_results", "lint_results"],
    idempotent: true,
    actions: ["run_tests", "run_linter", "run_build"],
  },
  delivery: {
    phase: "delivery",
    requiredInputs: ["test_results", "modified_files"],
    producedOutputs: ["commit", "pull_request"],
    idempotent: false, // Git operations may not be idempotent
    actions: ["git_commit", "git_push", "create_pr"],
  },
}

/**
 * Get phases that need to be re-run after a given phase
 */
export function getPhasesAfter(phase: TaskPhase): TaskPhase[] {
  const order: TaskPhase[] = ["perception", "planning", "execution", "verification", "delivery"]
  const index = order.indexOf(phase)
  return index >= 0 ? order.slice(index + 1) : []
}

// ============================================================================
// Core Checkpoint Types
// ============================================================================

/**
 * Semantic checkpoint for development tasks
 * Tracks task state with environment awareness
 */
export interface SemanticCheckpoint {
  /** Unique identifier for this checkpoint */
  id: string

  /** Timestamp of checkpoint creation */
  createdAt: number

  /** Layer 0: Semantic fingerprint of task intent */
  taskIntent: TaskIntent

  /** Layer 1: Tracked files with their roles */
  affectedFiles: Map<string, FileState>

  /** Layer 2: Critical dependency versions */
  criticalDeps: CriticalDeps

  /** Layer 3: Git context */
  gitContext: GitContext

  /** Completed phases and their outputs */
  completedPhases: PhaseRecord[]

  /** Pending work */
  pendingPhases: string[]
}

/**
 * Task intent (Layer 0)
 */
export interface TaskIntent {
  /** Content hash of task description */
  hash: string

  /** Human-readable summary */
  summary: string

  /** Expected affected paths (glob patterns) */
  affectedScope: string[]
}

/**
 * Critical dependencies (Layer 2)
 */
export interface CriticalDeps {
  /** package-lock.json / bun.lockb hash */
  lockfileHash?: string

  /** Config file hashes (tsconfig, etc.) */
  configHashes: Map<string, string>
}

/**
 * Git context (Layer 3)
 */
export interface GitContext {
  /** Current branch name */
  branch: string

  /** Base commit hash */
  baseCommit: string

  /** Whether there are uncommitted changes */
  hasUncommittedChanges: boolean
}

/**
 * Phase completion record
 */
export interface PhaseRecord {
  /** Phase identifier (use TaskPhase for standard phases) */
  phaseId: TaskPhase | string

  /** Completion timestamp */
  completedAt: number

  /** Summary of phase output */
  outputSummary: string

  /** Files produced by this phase */
  outputFiles: string[]

  /** Inputs consumed by this phase */
  consumedInputs?: string[]
}

// ============================================================================
// File State Types
// ============================================================================

/**
 * File state tracking
 */
export interface FileState {
  /** Content hash */
  contentHash: string

  /** AST-level semantic hash (ignores formatting) */
  semanticHash: string

  /** Export fingerprint for impact propagation */
  exportFingerprint?: ExportFingerprint

  /** Role in this task (access intent) */
  role: FileRole

  /**
   * Validity status (separate from role)
   * - valid: File state matches checkpoint, no re-perception needed
   * - stale: File may have changed, should re-read before using
   * - invalid: File definitely changed in breaking way, must re-perceive
   */
  validity: FileValidity

  /** Last known modification time */
  mtime: number

  /** Files that import/depend on this file */
  consumers?: string[]
}

/**
 * File validity status
 * Separate from role to avoid semantic confusion
 */
export type FileValidity = "valid" | "stale" | "invalid"

/**
 * File role in the task
 */
export type FileRole = "read" | "write" | "both"

/**
 * Export fingerprint for tracking API surface changes
 * Used for impact propagation when public API changes
 */
export interface ExportFingerprint {
  /** Hash of exported function signatures */
  functionSignatures: string

  /** Hash of exported type definitions */
  typeDefinitions: string

  /** Hash of exported constants/values */
  exportedValues: string

  /** List of exported identifiers */
  exportedNames: string[]
}

// ============================================================================
// Change Detection Types
// ============================================================================

/**
 * Fingerprint strategy modes
 */
export type FingerprintMode = "fast" | "precise"

/**
 * Change analysis result
 */
export interface ChangeAnalysis {
  /** Whether the change is semantically significant */
  isSignificant: boolean

  /** Type of change detected */
  changeType: ChangeType

  /** If api-change, list affected consumers */
  affectedConsumers?: string[]

  /** Confidence level of analysis */
  confidence: ConfidenceLevel
}

/**
 * Types of changes detected
 */
export type ChangeType =
  | "formatting-only" // AST unchanged, safe to ignore
  | "internal-refactor" // AST changed but exports unchanged
  | "api-change" // Export fingerprint changed
  | "value-change" // Constant/config value changed
  | "file-added" // New file
  | "file-deleted" // File removed

/**
 * Confidence levels for change analysis
 */
export type ConfidenceLevel = "high" | "medium" | "low"

/**
 * Change detection result for a single file
 */
export interface FileChangeResult {
  /** File path */
  path: string

  /** Whether file changed */
  changed: boolean

  /** Change analysis (if changed) */
  analysis?: ChangeAnalysis

  /** Previous state */
  previousState?: FileState

  /** Current state */
  currentState?: FileState
}

// ============================================================================
// Recovery Types
// ============================================================================

/**
 * Recovery decision types
 */
export type RecoveryDecision =
  | RecoveryContinue
  | RecoveryPartialRerun
  | RecoveryFullRerun
  | RecoveryUserDecision

export interface RecoveryContinue {
  action: "continue"
  reason: string
}

export interface RecoveryPartialRerun {
  action: "partial-rerun"
  /** Phase to re-run from (use TaskPhase for standard phases) */
  fromPhase: TaskPhase | string
  /** Reason for partial re-run */
  reason: string
  /** Phases that will be re-executed */
  affectedPhases: TaskPhase[]
}

export interface RecoveryFullRerun {
  action: "full-rerun"
  reason: string
}

export interface RecoveryUserDecision {
  action: "user-decision"
  changes: ChangeReport
}

/**
 * Change report for recovery decisions
 */
export interface ChangeReport {
  /** Which layer detected the change */
  layer: 0 | 1 | 2 | 3

  /** Human-readable description */
  description: string

  /** Phases affected by this change */
  affectedPhases: string[]

  /** Recommended recovery action */
  recommendation: RecoveryDecision
}

/**
 * Layer change summary
 */
export interface LayerChangeSummary {
  /** Layer number */
  layer: 0 | 1 | 2 | 3

  /** Layer name */
  layerName: "task-intent" | "affected-files" | "dependencies" | "git-context"

  /** Whether this layer has changes */
  hasChanges: boolean

  /** List of changed items */
  changedItems: string[]

  /** Impact level */
  impact: "none" | "minor" | "major" | "critical"
}

// ============================================================================
// Checkpoint Events
// ============================================================================

/**
 * Checkpoint event types
 */
export type CheckpointEvent =
  | CheckpointCreatedEvent
  | CheckpointRestoredEvent
  | CheckpointInvalidatedEvent
  | EnvironmentDriftDetectedEvent

export interface CheckpointCreatedEvent {
  type: "checkpoint-created"
  checkpointId: string
  taskSummary: string
  trackedFiles: number
}

export interface CheckpointRestoredEvent {
  type: "checkpoint-restored"
  checkpointId: string
  recoveryDecision: RecoveryDecision
}

export interface CheckpointInvalidatedEvent {
  type: "checkpoint-invalidated"
  checkpointId: string
  reason: string
  layerChanges: LayerChangeSummary[]
}

export interface EnvironmentDriftDetectedEvent {
  type: "environment-drift"
  driftType: DriftType
  affected: string[]
  impact: "none" | "minor" | "major" | "critical"
  recommendedAction: string
}

/**
 * Types of environment drift
 */
export type DriftType =
  | "file-changed"
  | "dependency-changed"
  | "branch-switched"
  | "external-commit"

// ============================================================================
// Configuration
// ============================================================================

/**
 * Checkpoint manager configuration
 */
export interface CheckpointConfig {
  /** Enable semantic checkpoints */
  enabled: boolean

  /** Auto-checkpoint interval (in tool calls) */
  autoCheckpointInterval: number

  /** File patterns to track for change detection */
  trackPatterns: string[]

  /** Config files to track for dependency changes */
  configFiles: string[]

  /** Recovery strategy preference */
  recoveryStrategy: RecoveryStrategyPreference

  /** Enable AST-based semantic hashing */
  enableSemanticHash: boolean

  /** Enable export fingerprinting */
  enableExportFingerprint: boolean

  /** Storage directory for checkpoints */
  storageDir: string
}

export type RecoveryStrategyPreference = "conservative" | "aggressive" | "user-choice"

/**
 * Default checkpoint configuration
 */
export const DEFAULT_CHECKPOINT_CONFIG: CheckpointConfig = {
  enabled: true,
  autoCheckpointInterval: 10,
  trackPatterns: ["src/**/*", "lib/**/*", "test/**/*"],
  configFiles: ["package.json", "tsconfig.json", "bun.lockb", "package-lock.json"],
  recoveryStrategy: "conservative",
  enableSemanticHash: false, // Requires AST parsing, disabled by default
  enableExportFingerprint: false, // Requires AST parsing, disabled by default
  storageDir: ".opencode/checkpoints",
}

// ============================================================================
// Recovery Strategy Table
// ============================================================================

/**
 * Recovery strategy based on change layer and type
 * Maps (layer, changeType) -> RecoveryDecision
 */
export const RECOVERY_STRATEGY_TABLE: Record<
  string,
  (affected: string[]) => RecoveryDecision
> = {
  // Layer 0: Task intent changed
  "0:any": () => ({
    action: "full-rerun",
    reason: "Task intent changed - full rerun required",
  }),

  // Layer 1: Write file externally modified
  "1:write-modified": (affected) => ({
    action: "partial-rerun",
    fromPhase: "affected",
    reason: `Write files externally modified: ${affected.join(", ")}`,
    affectedPhases: ["execution", "verification"] as const,
  }),

  // Layer 1: Read file changed
  "1:read-modified": (affected) => ({
    action: "continue",
    reason: `Read files changed but may not affect outcome: ${affected.join(", ")}`,
  }),

  // Layer 1: API change in dependency
  "1:api-change": (affected) => ({
    action: "partial-rerun",
    fromPhase: "consumers",
    reason: `API changed in: ${affected.join(", ")} - consumers need re-validation`,
    affectedPhases: ["execution", "verification"] as const,
  }),

  // Layer 2: Dependency version changed
  "2:dependency": (affected) => ({
    action: "user-decision",
    changes: {
      layer: 2,
      description: `Dependency versions changed: ${affected.join(", ")}`,
      affectedPhases: ["all"],
      recommendation: {
        action: "continue",
        reason: "Dependency change may or may not affect task",
      },
    },
  }),

  // Layer 3: Branch switched
  "3:branch-switch": () => ({
    action: "full-rerun",
    reason: "Git branch switched - context may be invalid",
  }),

  // Layer 3: New commits on base
  "3:new-commits": (affected) => ({
    action: "user-decision",
    changes: {
      layer: 3,
      description: `New commits detected on base branch`,
      affectedPhases: ["validation"],
      recommendation: {
        action: "continue",
        reason: "New commits may or may not conflict with current work",
      },
    },
  }),
}

// ============================================================================
// Utility Types
// ============================================================================

/**
 * Checkpoint creation options
 */
export interface CreateCheckpointOptions {
  /** Task description */
  taskDescription: string

  /** Files to track */
  files: string[]

  /** Initial phase (if any) */
  initialPhase?: string
}

/**
 * Checkpoint validation result
 */
export interface CheckpointValidation {
  /** Whether checkpoint is still valid */
  valid: boolean

  /** Layer changes detected */
  layerChanges: LayerChangeSummary[]

  /** Recommended recovery action */
  recommendedAction: RecoveryDecision

  /** Detailed change reports */
  changeReports: ChangeReport[]
}

/**
 * Serializable checkpoint for storage
 */
export interface SerializedCheckpoint {
  /** Checkpoint data */
  checkpoint: Omit<SemanticCheckpoint, "affectedFiles" | "criticalDeps"> & {
    affectedFiles: Array<[string, FileState]>
    criticalDeps: {
      lockfileHash?: string
      configHashes: Array<[string, string]>
    }
  }

  /** Schema version for migration */
  schemaVersion: number

  /** Serialization timestamp */
  serializedAt: number
}

/**
 * Current schema version
 */
export const CHECKPOINT_SCHEMA_VERSION = 1
