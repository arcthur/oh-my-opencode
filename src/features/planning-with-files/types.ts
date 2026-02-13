/**
 * Planning with Files - Type Definitions
 *
 * Canonical layout:
 * .orchestrator/plans/{plan_id}/plan.md
 * .orchestrator/plans/{plan_id}/ledger.yaml
 * .orchestrator/plans/{plan_id}/findings.md
 * .orchestrator/plans/{plan_id}/progress.md
 */

/** Configuration - matches schema snake_case convention */
export type BddAlignmentMode = "off" | "warn" | "required"

export interface PlanningWithFilesConfig {
  enabled: boolean
  /** BDD alignment gate for task-level Scenario Ref coverage. */
  bdd_alignment: BddAlignmentMode
  two_action_rule: boolean
  three_strike_protocol: boolean
  auto_reread: boolean
  stop_verification: boolean
  reread_trigger_tools: string[]
  action_count_tools: string[]
}

export const DEFAULT_PLANNING_CONFIG: PlanningWithFilesConfig = {
  enabled: false,
  bdd_alignment: "warn",
  two_action_rule: true,
  three_strike_protocol: true,
  auto_reread: true,
  stop_verification: true,
  reread_trigger_tools: ["Write", "Edit", "Bash", "NotebookEdit"],
  action_count_tools: ["Read", "WebFetch", "WebSearch", "Glob", "Grep", "Task"],
}
