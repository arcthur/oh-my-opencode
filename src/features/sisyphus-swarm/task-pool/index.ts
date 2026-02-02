/**
 * Sisyphus Swarm Task Pool
 *
 * Manages shared task storage and assignment across Swarm agents.
 */

// Types
export {
  SwarmTaskSchema,
  type SwarmTask,
  type TaskAssignmentResult,
  type TaskPoolStats,
  type TaskFilterOptions,
} from "./types"

// Pool operations
export {
  generateTaskId,
  listTaskIds,
  readTask,
  readAllTasks,
  createTask,
  updateTask,
  deleteTask,
  isTaskBlocked,
  detectCycle,
  wouldCreateCycle,
  filterTasks,
  getReadyTasks,
  getPoolStats,
  assignTask,
  completeTask,
  reassignTask,
  getAgentTasks,
  getNextTaskForAgent,
} from "./pool"

// Assignment operations
export {
  coordinatorAssignTask,
  workerReceiveAssignment,
  workerReportCompletion,
  coordinatorReceiveCompletions,
  autoAssignTasks,
  reassignStaleTasks,
  getAssignmentStatus,
  type AssignmentStatusResult,
  type ReceivedTaskInfo,
} from "./assignment"
