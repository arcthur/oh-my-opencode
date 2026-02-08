/**
 * Work State
 *
 * Unified state management for orchestrator workflows.
 * Single source of truth: .sisyphus/work.yaml
 */

export { WorkStateManager, createWorkStateManager } from "./manager"
export { resolveActiveTaskSelector, type ActiveTaskSelectorResult, type ActiveTaskSelectorSource } from "./task-selector"
export type {
  WorkState,
  ErrorRecord,
  BlockerRecord,
  Decision,
} from "./types"
export {
  WorkStateSchema,
  WORK_STATE_DIR,
  WORK_STATE_FILE,
  WORK_STATE_PATH,
  PLANS_DIR,
  NOTEPADS_DIR,
  PLAN_FILE,
  LEDGER_FILE,
  FINDINGS_FILE,
  PROGRESS_FILE,
} from "./types"
