/**
 * Swarm TaskGraph Operations
 *
 * Swarm stores tasks in the global TaskGraph using:
 * - scope: "swarm"
 * - container_id: teamName
 */

export {
  createSwarmTask,
  readSwarmTaskNode,
  readSwarmTaskSummary,
  listSwarmTaskSummaries,
  getSwarmTaskPoolStats,
  updateSwarmTask,
  transitionSwarmTask,
  assignSwarmTask,
  completeSwarmTask,
  reassignSwarmTask,
  dependencyDepth,
  getNextSwarmTaskForAgent,
  type SwarmTaskCreateInput,
  type SwarmTaskUpdateInput,
  type SwarmTaskPoolStats,
} from "./pool"

export {
  coordinatorAssignTask,
  workerReceiveAssignment,
  workerReportCompletion,
  autoAssignTasksWithRuntime,
  reassignStaleTasks,
  getAssignmentStatus,
  releaseSwarmTaskLease,
  type TaskAssignmentResult,
  type AssignmentStatusResult,
  type ReceivedTaskInfo,
} from "./assignment"

