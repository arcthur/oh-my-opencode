/**
 * Planning with Files
 *
 * Implements the Manus-style persistent planning pattern for AI agents.
 *
 * Core Principles:
 * - "Context Window = RAM (volatile); Filesystem = Disk (persistent)"
 * - Three persistent files: task_plan.md, findings.md, progress.md
 * - 2-Action Rule: Update findings after every 2 search/view operations
 * - 3-Strike Protocol: Structured error handling and escalation
 * - Auto re-read: Re-read task plan before critical operations
 *
 * @module planning-with-files
 */

// Types
export type {
  PhaseStatus,
  TaskPhase,
  Decision,
  ErrorRecord,
  Finding,
  SessionLogEntry,
  TestResult,
  TaskPlan,
  Findings,
  ProgressLog,
  PlanningSession,
  PlanningWithFilesConfig,
} from "./types"

export { DEFAULT_PLANNING_CONFIG } from "./types"

// Templates
export {
  generateTaskPlanTemplate,
  parseTaskPlan,
  generateFindingsTemplate,
  updateFindingsActionCount,
  resetFindingsActionCount,
  getFindingsActionCount,
  generateProgressTemplate,
  addPhaseLogEntry,
  updatePhaseStatus as updateProgressPhaseStatus,
  updateLastActivity,
} from "./templates"

// Manager
export {
  initializePlanningSession,
  getPlanningSession,
  loadPlanningSession,
  readTaskPlan,
  readFindings,
  readProgress,
  incrementActionCount,
  resetActionCount,
  recordErrorStrike,
  getErrorStrikes,
  clearErrorStrikes,
  getStrikeGuidance,
  updatePhaseStatus,
  logAction,
  addDecision,
  addError,
  areAllPhasesComplete,
  getIncompletePhases,
  generateRereadContext,
  cleanupSession,
} from "./manager"
