/**
 * Work State Types
 *
 * Runtime state is tracked in `.sisyphus/work.yaml`.
 * It binds sessions to a single active plan directory:
 *
 * `.sisyphus/plans/{plan_id}/`
 * - `plan.md` (human-readable plan artifact)
 * - `ledger.yaml` (runtime ledger)
 * - `findings.md`
 * - `progress.md`
 *
 * Note: TaskGraph is the execution source of truth for tasks.
 */

import { z } from "zod"

// === Zod Schemas ===

export const ErrorRecordSchema = z.object({
  /** Unique key for deduplication (e.g., "Edit:type-mismatch") */
  key: z.string(),
  /** Number of times this error occurred (3-strike protocol) */
  strikes: z.number().default(1),
  /** Whether error has been recorded in ledger.yaml */
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

export const WorkExecutorSchema = z.literal("atlas")

export const WorkStateProtocolSchema = z.object({
  /** 2-action rule counter (reset when findings.md modified) */
  research_ops: z.number().default(0),
  /** Last mtime of findings.md for auto-reset */
  last_findings_mtime: z.number().default(0),
  /** Session-level stop verification prompt timestamp cache */
  stop_verification_last_prompt_at_by_session: z.record(z.string(), z.number()).default({}),
})

const WorkStateCommonFields = {
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
  errors: z.array(ErrorRecordSchema).default([]),
  blockers: z.array(BlockerRecordSchema).default([]),
  decisions: z.array(DecisionSchema).default([]),
  /** Last update timestamp */
  last_updated: z.string().optional(),
} as const

export const WorkStateSchema = z.object({
  /** Work state schema version (breaking state upgrades bump this value) */
  schema_version: z.literal(6),
  /** Active execution orchestrator profile */
  executor: WorkExecutorSchema,
  /** Protocol-scoped transient state */
  protocol: WorkStateProtocolSchema.default({
    research_ops: 0,
    last_findings_mtime: 0,
    stop_verification_last_prompt_at_by_session: {},
  }),
  ...WorkStateCommonFields,
})

export const LegacyWorkStateV5Schema = z.object({
  schema_version: z.literal(5),
  executor: WorkExecutorSchema,
  ...WorkStateCommonFields,
  research_ops: z.number().default(0),
  last_findings_mtime: z.number().default(0),
})

// === TypeScript Types ===

export type ErrorRecord = z.infer<typeof ErrorRecordSchema>
export type BlockerRecord = z.infer<typeof BlockerRecordSchema>
export type Decision = z.infer<typeof DecisionSchema>
export type WorkExecutor = z.infer<typeof WorkExecutorSchema>
export type WorkStateProtocol = z.infer<typeof WorkStateProtocolSchema>
export type WorkState = z.infer<typeof WorkStateSchema>
export type LegacyWorkStateV5 = z.infer<typeof LegacyWorkStateV5Schema>

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
