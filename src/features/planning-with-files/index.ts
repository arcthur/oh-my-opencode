/**
 * Planning with Files
 *
 * Manus-style persistent planning pattern for AI agents.
 *
 * Core Features:
 * - 3-file pattern: task_plan.md, findings.md, progress.md
 * - Full task_plan.md re-read for KV-cache optimization
 * - Auto-detection of findings.md updates via mtime
 * - State persistence via .planning-state.json
 * - 2-Action Rule with auto-reset
 * - 3-Strike Error Protocol
 */

export type {
  PhaseStatus,
  PlanningState,
  PlanningWithFilesConfig,
  PlanningSession,
  TaskPhase,
  Decision,
  ErrorRecord,
} from "./types"

export { DEFAULT_PLANNING_CONFIG } from "./types"

export {
  getPlanDir,
  loadState,
  saveState,
  readTaskPlan,
  writeTaskPlan,
  detectActivePlan,
  wasFindingsModified,
  initializePlan,
  parsePhases,
  getStrikeGuidance,
  cleanupSession,
  // Reflection and error handling
  detectPhaseCompletion,
  generateReflectionPrompt,
  generateErrorRecordingPrompt,
  generateBlockerPrompt,
  getCurrentPhase,
  isErrorRecorded,
  // Legacy exports
  initializePlanningSession,
  getPlanningSession,
  loadPlanningSession,
  readFindings,
  readProgress,
  areAllPhasesComplete,
  getIncompletePhases,
} from "./manager"
