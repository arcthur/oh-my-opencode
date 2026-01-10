/**
 * Planning Templates Index
 *
 * Re-exports all template generators for the 3-file planning pattern.
 */

export {
  generateTaskPlanTemplate,
  parseTaskPlan,
  type TaskPlanTemplateOptions,
} from "./task-plan"

export {
  generateFindingsTemplate,
  updateFindingsActionCount,
  resetFindingsActionCount,
  getFindingsActionCount,
  type FindingsTemplateOptions,
} from "./findings"

export {
  generateProgressTemplate,
  addPhaseLogEntry,
  updatePhaseStatus,
  updateLastActivity,
  type ProgressTemplateOptions,
} from "./progress"
