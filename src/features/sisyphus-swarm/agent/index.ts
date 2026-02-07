/**
 * Sisyphus Swarm Agent Runtime
 *
 * Provides worker and coordinator agent implementations.
 */

import { WorkerAgent as WorkerAgentImpl, createWorker as createWorkerImpl } from "./worker"
import { CoordinatorAgent as CoordinatorAgentImpl, createCoordinator as createCoordinatorImpl } from "./coordinator"

// State machine
export {
  AgentStateSchema,
  type AgentState,
  PauseContextSchema,
  type PauseContext,
  type StateEvent,
  createInitialState,
  isValidTransition,
  applyEvent,
  AgentStateMachine,
} from "./state"

// Worker agent
export {
  type TaskInfo,
  type WorkerConfig,
  type PermissionResult,
  type PlanApprovalResult,
  type RiskLevel,
} from "./worker"

// Avoid live re-exports for these to keep Bun module mocks from patching ./worker exports.
export type WorkerAgent = WorkerAgentImpl
export const WorkerAgent = WorkerAgentImpl
export const createWorker = createWorkerImpl

// Coordinator agent
export {
  type CoordinatorConfig,
} from "./coordinator"

// Avoid live re-exports for these to keep Bun module mocks from patching ./coordinator exports.
export type CoordinatorAgent = CoordinatorAgentImpl
export const CoordinatorAgent = CoordinatorAgentImpl
export const createCoordinator = createCoordinatorImpl
