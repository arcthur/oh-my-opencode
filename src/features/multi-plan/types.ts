import type { MultiPlanConfig, MultiPlanModel } from "../../config/schema"

export type { MultiPlanConfig, MultiPlanModel }

/**
 * Status of a plan generation task
 */
export type PlanGenerationStatus = "pending" | "running" | "completed" | "error"

/**
 * A single plan generation task for one model
 */
export interface PlanGenerationTask {
  /** Display name for this model (e.g., "strategist", "creative") */
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
  | "complete"     // All done
  | "error"        // Something failed

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
  /** Models participating in this session */
  models: MultiPlanModel[]
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
  /** Configuration */
  config: MultiPlanConfig
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
