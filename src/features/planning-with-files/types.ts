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

/** Configuration */
export interface PlanningWithFilesConfig {
  enabled: boolean
  directory: string
  twoActionRule: boolean
  threeStrikeProtocol: boolean
  autoReread: boolean
  stopVerification: boolean
  rereadTriggerTools: string[]
  actionCountTools: string[]
  autoFromMultiPlan: boolean
}

export const DEFAULT_PLANNING_CONFIG: PlanningWithFilesConfig = {
  enabled: false,
  directory: "plans", // Unified with multi-plan output
  twoActionRule: true,
  threeStrikeProtocol: true,
  autoReread: true,
  stopVerification: true,
  rereadTriggerTools: ["Write", "Edit", "Bash", "NotebookEdit"],
  actionCountTools: ["Read", "WebFetch", "WebSearch", "Glob", "Grep", "Task"],
  autoFromMultiPlan: true,
}

// Legacy type aliases for compatibility
export type PlanningSession = PlanningState
export type TaskPhase = { id: number; name: string; status: PhaseStatus; description?: string }
export type Decision = { id: number; decision: string; rationale: string; phase?: number }
export type ErrorRecord = { id: number; error: string; attempt: number; action: string; resolution?: string }
export type Finding = { id: number; source: string; finding: string; relevance: string }
export type SessionLogEntry = { timestamp: Date; phase: number; action: string; filesModified?: string[] }
export type TestResult = { testCase: string; input: string; expected: string; actual: string; status: string }
export type TaskPlan = { goal: string; phases: TaskPhase[]; decisions: Decision[]; errors: ErrorRecord[] }
export type Findings = { research: Finding[]; resources: { name: string; url: string }[] }
export type ProgressLog = { sessionDate: Date; phaseLogs: any[]; testResults: TestResult[] }
