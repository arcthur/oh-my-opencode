/**
 * Work State Types
 *
 * Runtime state is tracked in `.sisyphus/work.yaml` and points to a canonical
 * plan directory:
 *
 * `.sisyphus/plans/{plan_id}/`
 * - `plan.md` (execution source of truth)
 * - `ledger.yaml` (runtime ledger)
 * - `findings.md`
 * - `progress.md`
 */

import { z } from "zod"

// === Zod Schemas ===

export const ErrorRecordSchema = z.object({
  /** Unique key for deduplication (e.g., "Edit:type-mismatch") */
  key: z.string(),
  /** Number of times this error occurred (3-strike protocol) */
  strikes: z.number().default(1),
  /** Whether error has been recorded in plan file */
  recorded: z.boolean().default(false),
  /** Last occurrence timestamp */
  last_at: z.string(),
  /** Original error text (truncated) */
  error_text: z.string().optional(),
})

export const BlockerRecordSchema = z.object({
  /** Error text that triggered blocker detection */
  error_text: z.string(),
  /** When blocker was detected */
  detected_at: z.string(),
  /** Whether blocker has been resolved */
  resolved: z.boolean().default(false),
  /** Resolution notes */
  resolution: z.string().optional(),
})

export const PhaseCompletionSchema = z.object({
  /** Phase identifier */
  phase_id: z.string(),
  /** When phase was completed */
  completed_at: z.string(),
  /** Whether reflection prompt was shown */
  reflected: z.boolean().default(false),
})

export const DecisionSchema = z.object({
  /** When decision was made */
  timestamp: z.string(),
  /** The decision made */
  decision: z.string(),
  /** Rationale for the decision */
  rationale: z.string().optional(),
  /** Alternatives that were rejected */
  alternatives_rejected: z.array(z.string()).optional(),
})

/**
 * TaskSnapshot - cached progress from plan file.
 * Used for fast progress queries without re-parsing markdown.
 * Re-synced when plan file mtime changes.
 */
export const TaskSnapshotSchema = z.object({
  /** Total number of tasks (checkboxes or phases) */
  total: z.number(),
  /** Number of completed tasks */
  completed: z.number(),
  /** Plan file mtime when snapshot was taken */
  plan_mtime: z.number(),
  /** ISO timestamp when snapshot was last synced */
  last_sync: z.string(),
})

export const WorkStateSchema = z.object({
  // === Core work state ===
  /** Work state schema version (breaking state upgrades bump this value) */
  schema_version: z.literal(2),
  /** Stable plan identifier */
  plan_id: z.string().min(1),
  /** Canonical execution plan path (.sisyphus/plans/{plan_id}/plan.md) */
  execution_plan_path: z.string(),
  /** Canonical runtime ledger path (.sisyphus/plans/{plan_id}/ledger.yaml) */
  runtime_ledger_path: z.string(),
  /** ISO timestamp when work started */
  started_at: z.string(),
  /** Session IDs that have worked on this plan */
  session_ids: z.array(z.string()).default([]),

  // === From planning-with-files ===
  /** 2-action rule counter (reset when findings.md modified) */
  research_ops: z.number().default(0),
  /** Last mtime of findings.md for auto-reset */
  last_findings_mtime: z.number().default(0),

  // === Error tracking (3-strike protocol) ===
  errors: z.array(ErrorRecordSchema).default([]),

  // === Blocker tracking ===
  blockers: z.array(BlockerRecordSchema).default([]),

  // === Phase completion tracking ===
  phase_completions: z.array(PhaseCompletionSchema).default([]),

  // === Decision history ===
  decisions: z.array(DecisionSchema).default([]),

  // === Task snapshot (cached progress) ===
  /** Cached task progress from plan file for fast queries */
  task_snapshot: TaskSnapshotSchema.optional(),

  // === Metadata ===
  /** Last update timestamp */
  last_updated: z.string().optional(),
})

// === TypeScript Types ===

export type ErrorRecord = z.infer<typeof ErrorRecordSchema>
export type BlockerRecord = z.infer<typeof BlockerRecordSchema>
export type PhaseCompletion = z.infer<typeof PhaseCompletionSchema>
export type Decision = z.infer<typeof DecisionSchema>
export type TaskSnapshot = z.infer<typeof TaskSnapshotSchema>
export type WorkState = z.infer<typeof WorkStateSchema>

// === Plan Progress (computed from plan file) ===

export interface PlanProgress {
  /** Total number of checkboxes */
  total: number
  /** Number of completed checkboxes */
  completed: number
  /** Whether all tasks are done */
  isComplete: boolean
}

// === Phase Info (parsed from plan file) ===

export type PhaseStatus = "pending" | "in_progress" | "complete" | "blocked"

export interface Phase {
  id: string
  name: string
  status: PhaseStatus
  description?: string
}

// === Constants ===

export const WORK_STATE_DIR = ".sisyphus"
export const WORK_STATE_FILE = "work.yaml"
export const WORK_STATE_PATH = `${WORK_STATE_DIR}/${WORK_STATE_FILE}`
export const PLANS_DIR = `${WORK_STATE_DIR}/plans`
export const NOTEPADS_DIR = `${WORK_STATE_DIR}/notepads`
export const PLAN_FILE = "plan.md"
export const LEDGER_FILE = "ledger.yaml"
export const FINDINGS_FILE = "findings.md"
export const PROGRESS_FILE = "progress.md"
