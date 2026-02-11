import type { WorkExecutor } from "../work-state"

/**
 * Execution mode has a single orchestrator owner.
 * Interactive orchestration can use other agents, but execution progression is Atlas-only.
 */
export const EXECUTION_OWNER = "atlas" as const
export type ExecutionOwner = typeof EXECUTION_OWNER

export function getExecutionOwner(): WorkExecutor {
  return EXECUTION_OWNER
}
