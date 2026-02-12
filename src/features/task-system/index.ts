export {
  TASK_ERROR_CODES,
  TaskLifecycleStateSchema,
  TaskReadinessSchema,
  TaskScopeSchema,
  TaskLeaseSchema,
  TaskNodeSchema,
  TaskSystemError,
  canTransitionTaskState,
  deriveTaskReadiness,
  toTaskSummary,
  wouldCreateDependencyCycle,
  type TaskErrorCode,
  type TaskLease,
  type TaskLifecycleState,
  type TaskNode,
  type TaskReadiness,
  type TaskReadinessResult,
  type TaskScope,
  type TaskSummary,
} from "./domain"

export {
  deleteTaskNode,
  ensureTaskGraphDir,
  generateTaskNodeId,
  getTaskGraphDir,
  getTaskGraphRoot,
  getTaskNodePath,
  listTaskNodeIds,
  readAllTaskNodes,
  readTaskNode,
  sanitizeTaskPathSegment,
  withTaskGraphLock,
  writeTaskNode,
} from "./storage"

export {
  createTaskNode,
  getTaskNode,
  listTaskNodes,
  transitionTaskNode,
  updateTaskNode,
  type TaskContainerSelector,
  type TaskCreateInput,
  type TaskListInput,
  type TaskTransitionInput,
  type TaskUpdateInput,
} from "./service"

export {
  countIncompleteTasks,
  countIncompleteSessionTasks,
  getTaskSummary,
  hasIncompleteTasks,
  hasIncompleteSessionTasks,
  listIncompleteTasks,
  listIncompleteSessionTasks,
  listReadyTasks,
  listSessionTasks,
} from "./query"

export {
  findPlanBddAlignmentIssues,
  parsePlanTasksFromMarkdown,
  type PlanBddAlignmentIssue,
  type PlanTaskDefinition,
} from "./plan-markdown"

export {
  syncPlanTasksToTaskGraph,
  type SyncPlanTasksInput,
  type SyncPlanTasksResult,
} from "./plan-sync"
