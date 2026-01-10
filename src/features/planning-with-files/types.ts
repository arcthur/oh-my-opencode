/**
 * Planning with Files - Type Definitions
 *
 * Manus-style persistent planning: "Context Window = RAM; Filesystem = Disk"
 */

export type PhaseStatus = "pending" | "in_progress" | "complete" | "blocked"

/** Persisted state (saved to .planning-state.json) */
export interface PlanningState {
  planName: string
  actionCount: number
  lastFindingsMtime: number
  errorStrikes: Record<string, number>
  activatedAt: string
  lastActivityAt: string
}

/** Configuration - matches schema snake_case convention */
export interface PlanningWithFilesConfig {
  enabled: boolean
  directory: string
  two_action_rule: boolean
  three_strike_protocol: boolean
  auto_reread: boolean
  stop_verification: boolean
  reread_trigger_tools: string[]
  action_count_tools: string[]
  auto_from_multi_plan: boolean
}

export const DEFAULT_PLANNING_CONFIG: PlanningWithFilesConfig = {
  enabled: false,
  directory: "plans",
  two_action_rule: true,
  three_strike_protocol: true,
  auto_reread: true,
  stop_verification: true,
  reread_trigger_tools: ["Write", "Edit", "Bash", "NotebookEdit"],
  action_count_tools: ["Read", "WebFetch", "WebSearch", "Glob", "Grep", "Task"],
  auto_from_multi_plan: true,
}

// Legacy type aliases for compatibility
export type PlanningSession = PlanningState
export type TaskPhase = { id: number; name: string; status: PhaseStatus; description?: string }
export type Decision = { id: number; decision: string; rationale: string; phase?: number }
export type ErrorRecord = { id: number; error: string; attempt: number; action: string; resolution?: string }
