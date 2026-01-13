/**
 * Normalized planning model (internal use - always has name and model)
 */
export interface NormalizedPlanningModel {
  /** Display name, auto-derived from model ID (e.g., "claude-opus-4-5", "gpt-5.2") */
  name: string
  /** Model ID, e.g., "anthropic/claude-opus-4-5" */
  model: string
}

/**
 * Internal normalized planning config (after processing string/array input)
 */
export interface NormalizedPlanningConfig {
  models: NormalizedPlanningModel[]
}

/**
 * Status of a plan generation task
 */
export type PlanGenerationStatus = "pending" | "running" | "completed" | "error"

/**
 * A single plan generation task for one model
 */
export interface PlanGenerationTask {
  /** Display name for this model (e.g., "claude-opus-4-5", "gpt-5.2") */
  modelName: string
  /** Background task ID */
  taskId: string
  /** Session ID for the background task */
  sessionId: string
  /** Current status */
  status: PlanGenerationStatus
  /** Output file path for the generated plan */
  outputPath: string
  /** When the task started */
  startedAt?: Date
  /** When the task completed */
  completedAt?: Date
  /** Error message if failed */
  error?: string
}

/**
 * Overall status of a multi-plan session
 */
export type MultiPlanSessionStatus =
  | "generating"   // Plans being generated in parallel
  | "reviewing"    // Plan Synthesizer reviewing all plans
  | "debating"     // Debate round: rebuttals being generated
  | "finalizing"   // Synthesizer reviewing rebuttals
  | "complete"     // All done
  | "error"        // Something failed

/**
 * A rebuttal from a rejected model
 */
export interface PlanRebuttal {
  /** Model name that was rejected */
  modelName: string
  /** Conflicts this rebuttal addresses */
  conflictIds: string[]
  /** The rebuttal content */
  content: string
  /** Task ID for the rebuttal generation */
  taskId?: string
  /** Status of rebuttal generation */
  status: "pending" | "generating" | "completed" | "error"
  /** Error if failed */
  error?: string
}

/**
 * A multi-plan session tracking all tasks and results
 */
export interface MultiPlanSession {
  /** Unique session ID */
  id: string
  /** Plan name (used in file paths) */
  planName: string
  /** Original request context from Prometheus interview */
  requestContext: string
  /** Models participating in this session (normalized) */
  models: NormalizedPlanningModel[]
  /** Generation tasks for each model */
  tasks: PlanGenerationTask[]
  /** Path to the comparison report (after synthesis) */
  comparisonReportPath?: string
  /** Path to the final unified plan */
  finalPlanPath?: string
  /** Current session status */
  status: MultiPlanSessionStatus
  /** When the session started */
  startedAt: Date
  /** When the session completed */
  completedAt?: Date
  /** Error message if failed */
  error?: string
  /** Whether debate mode is enabled */
  debateEnabled?: boolean
  /** Rebuttals from rejected models (if debate enabled) */
  rebuttals?: PlanRebuttal[]
}

/**
 * Input for starting a multi-plan session
 */
export interface StartMultiPlanInput {
  /** Plan name (e.g., "add-authentication") */
  planName: string
  /** Context from Prometheus interview */
  requestContext: string
  /** Parent session ID */
  parentSessionId: string
  /** Normalized configuration with models array */
  config: NormalizedPlanningConfig
  /** Enable debate mode - rejected plans can rebut */
  debateEnabled?: boolean
}

/**
 * Result of a multi-plan session
 */
export interface MultiPlanResult {
  /** Session details */
  session: MultiPlanSession
  /** Path to comparison report */
  comparisonReportPath: string
  /** Path to final unified plan */
  finalPlanPath: string
  /** Summary message */
  summary: string
}
