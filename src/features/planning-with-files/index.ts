/**
 * Planning with Files
 *
 * Manus-style persistent planning pattern for AI agents.
 *
 * Core Features:
 * - 4-file pattern: plan.md, ledger.yaml, findings.md, progress.md
 * - Full plan.md re-read for KV-cache optimization
 * - Auto-detection of findings.md updates via mtime
 * - Protocol state persistence via .orchestrator/work.yaml (WorkStateManager)
 * - 2-Action Rule with auto-reset
 * - 3-Strike Error Protocol
 */

export type {
  PlanningWithFilesConfig,
} from "./types"

export { DEFAULT_PLANNING_CONFIG } from "./types"

export {
  getPlanDir,
  getExecutionPlanPath,
  getLedgerPath,
  readPlan,
  writePlan,
  readLedger,
  writeLedger,
  detectActivePlan,
  initializePlan,
  isErrorRecorded,
  readFindings,
  readProgress,
} from "./manager"
