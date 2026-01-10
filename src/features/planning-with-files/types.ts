/**
 * Planning with Files - Type Definitions
 *
 * Implements the Manus-style persistent planning pattern:
 * "Context Window = RAM (volatile, limited); Filesystem = Disk (persistent, unlimited)"
 */

/** Phase status for task tracking */
export type PhaseStatus = "pending" | "in_progress" | "complete" | "blocked"

/** Individual phase in a task plan */
export interface TaskPhase {
  id: number
  name: string
  status: PhaseStatus
  description?: string
  startedAt?: Date
  completedAt?: Date
}

/** Decision record for tracking choices */
export interface Decision {
  id: number
  decision: string
  rationale: string
  madeAt: Date
  phase?: number
}

/** Error record for the 3-strike protocol */
export interface ErrorRecord {
  id: number
  error: string
  attempt: number
  action: string
  resolution?: string
  timestamp: Date
}

/** Research finding entry */
export interface Finding {
  id: number
  source: string
  finding: string
  relevance: string
  timestamp: Date
}

/** Session log entry */
export interface SessionLogEntry {
  timestamp: Date
  phase: number
  action: string
  filesModified?: string[]
  notes?: string
}

/** Test result entry */
export interface TestResult {
  testCase: string
  input: string
  expected: string
  actual: string
  status: "pass" | "fail" | "pending"
}

/** Complete task plan structure */
export interface TaskPlan {
  goal: string
  phases: TaskPhase[]
  decisions: Decision[]
  errors: ErrorRecord[]
  keyQuestions: string[]
  createdAt: Date
  updatedAt: Date
}

/** Findings document structure */
export interface Findings {
  requirements: string[]
  research: Finding[]
  technicalDecisions: Decision[]
  issuesEncountered: ErrorRecord[]
  resources: { name: string; url: string; notes?: string }[]
  visualFindings: { source: string; description: string; timestamp: Date }[]
  updatedAt: Date
}

/** Progress log structure */
export interface ProgressLog {
  sessionDate: Date
  phaseLogs: {
    phase: number
    status: PhaseStatus
    timestamp: Date
    actions: string[]
    filesModified: string[]
  }[]
  testResults: TestResult[]
  errorLog: ErrorRecord[]
  rebootCheck?: {
    currentLocation: string
    direction: string
    goals: string
    learnings: string
    completed: string
  }
  updatedAt: Date
}

/** Planning session state */
export interface PlanningSession {
  id: string
  planName: string
  taskPlanPath: string
  findingsPath: string
  progressPath: string
  actionCount: number
  lastFindingsUpdate: Date
  errorStrikes: Map<string, number>
  createdAt: Date
  updatedAt: Date
}

/** Configuration for planning-with-files */
export interface PlanningWithFilesConfig {
  /** Enable the planning-with-files pattern (default: false) */
  enabled: boolean
  /** Directory for planning files relative to .sisyphus/ (default: "planning") */
  directory: string
  /** Enable 2-action rule for findings updates (default: true) */
  twoActionRule: boolean
  /** Enable 3-strike error protocol (default: true) */
  threeStrikeProtocol: boolean
  /** Enable auto re-read of task_plan before tool use (default: true) */
  autoReread: boolean
  /** Enable stop hook verification (default: true) */
  stopVerification: boolean
  /** Tools that trigger plan re-read */
  rereadTriggerTools: string[]
  /** Tools that count toward the 2-action rule */
  actionCountTools: string[]
}

/** Default configuration */
export const DEFAULT_PLANNING_CONFIG: PlanningWithFilesConfig = {
  enabled: false,
  directory: "planning",
  twoActionRule: true,
  threeStrikeProtocol: true,
  autoReread: true,
  stopVerification: true,
  rereadTriggerTools: ["Write", "Edit", "Bash", "NotebookEdit"],
  actionCountTools: ["Read", "WebFetch", "WebSearch", "Glob", "Grep"],
}
