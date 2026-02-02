import type { OhMyOpenCodeConfig } from "../../../config/schema"
import type { Task } from "../../sisyphus-tasks/types"
import {
  sendMessage,
  readUnreadByType,
  markAsRead,
  waitForMessage,
} from "../mailbox"
import {
  readManifest,
  getMember,
  isCoordinator,
  getWorkers,
  markWorkerBusy,
} from "../team/manifest"
import { getIdleWorkers } from "../team/membership"
import type { AgentIdentity } from "../team/types"
import {
  readTask,
  assignTask,
  completeTask,
  reassignTask,
  getNextTaskForAgent,
  getReadyTasks,
  filterTasks,
  getPoolStats,
} from "./pool"
import type { TaskAssignmentResult } from "./types"

/**
 * Coordinator assigns a task to a worker via mailbox
 */
export function coordinatorAssignTask(
  teamName: string,
  coordinatorId: string,
  taskId: string,
  workerId: string,
  config: Partial<OhMyOpenCodeConfig>
): TaskAssignmentResult {
  // Verify coordinator
  if (!isCoordinator(teamName, coordinatorId, config)) {
    return { success: false, reason: "Only coordinator can assign tasks" }
  }

  const manifest = readManifest(teamName, config)
  if (!manifest) {
    return { success: false, reason: "Team not found" }
  }

  const listId = manifest.taskListId ?? teamName

  // Read task
  const task = readTask(listId, taskId, config)
  if (!task) {
    return { success: false, reason: "Task not found" }
  }

  if (task.status !== "pending") {
    return { success: false, reason: `Task is not pending (status: ${task.status})` }
  }

  // Verify worker is a member
  const worker = getMember(teamName, workerId, config)
  if (!worker) {
    return { success: false, reason: "Worker is not a team member" }
  }

  // Assign in task pool
  const assigned = assignTask(listId, taskId, workerId, config)
  if (!assigned) {
    return { success: false, reason: "Failed to assign task" }
  }

  // Mark worker as busy (remove from idle list)
  markWorkerBusy(teamName, workerId, config)

  // Build parent context from assignment history
  const assignmentHistory = (task.metadata?.assignmentHistory as Array<{
    agentId: string
    assignedAt: number
    completedAt?: number
    result?: string
  }>) ?? []
  const parentContext = assignmentHistory.length > 0 ? {
    previousAttempts: assignmentHistory.length,
    lastError: task.metadata?.lastReassignReason as string | undefined,
    lastWorkerId: assignmentHistory[assignmentHistory.length - 1]?.agentId,
  } : undefined

  // Send assignment message to worker with full metadata
  sendMessage(teamName, coordinatorId, workerId, {
    type: "task_assignment",
    taskId: task.id,
    subject: task.subject,
    description: task.description,
    assignedBy: coordinatorId,
    timestamp: Date.now(),
    // Extended metadata for worker context
    contextSummary: task.metadata?.contextSummary as string | undefined,
    relevantFiles: task.metadata?.relevantFiles as string[] | undefined,
    parentContext,
    requiredCapabilities: task.metadata?.requiredCapabilities as string[] | undefined,
    priority: task.metadata?.priority as number | undefined,
  }, config)

  return { success: true, taskId: task.id, agentId: workerId }
}

/**
 * Extended task info returned by workerReceiveAssignment
 */
export interface ReceivedTaskInfo {
  id: string
  subject: string
  description: string
  contextSummary?: string
  relevantFiles?: string[]
  parentContext?: {
    previousAttempts: number
    lastError?: string
    lastWorkerId?: string
  }
  requiredCapabilities?: string[]
  priority?: number
}

/**
 * Worker receives task assignment
 */
export async function workerReceiveAssignment(
  teamName: string,
  workerId: string,
  config: Partial<OhMyOpenCodeConfig>,
  options?: { timeoutMs?: number }
): Promise<{
  task: ReceivedTaskInfo | null
  messageId: string | null
}> {
  try {
    const message = await waitForMessage(
      teamName,
      workerId,
      "task_assignment",
      config,
      options?.timeoutMs ?? 30000
    )

    if (message.payload.type === "task_assignment") {
      return {
        task: {
          id: message.payload.taskId,
          subject: message.payload.subject,
          description: message.payload.description,
          // Extended metadata
          contextSummary: message.payload.contextSummary,
          relevantFiles: message.payload.relevantFiles,
          parentContext: message.payload.parentContext,
          requiredCapabilities: message.payload.requiredCapabilities,
          priority: message.payload.priority,
        },
        messageId: message.id,
      }
    }

    return { task: null, messageId: null }
  } catch {
    return { task: null, messageId: null }
  }
}

/**
 * Worker reports task completion
 */
export function workerReportCompletion(
  teamName: string,
  workerId: string,
  taskId: string,
  config: Partial<OhMyOpenCodeConfig>
): boolean {
  const manifest = readManifest(teamName, config)
  if (!manifest) {
    return false
  }

  const listId = manifest.taskListId ?? teamName

  // Update task status
  const completed = completeTask(listId, taskId, workerId, config)
  if (!completed) {
    return false
  }

  // Notify coordinator
  sendMessage(teamName, workerId, manifest.coordinatorId, {
    type: "task_completed",
    taskId,
    agentId: workerId,
    timestamp: Date.now(),
  }, config)

  return true
}

/**
 * Coordinator receives completion notifications
 */
export function coordinatorReceiveCompletions(
  teamName: string,
  coordinatorId: string,
  config: Partial<OhMyOpenCodeConfig>
): Array<{ taskId: string; agentId: string; messageId: string }> {
  if (!isCoordinator(teamName, coordinatorId, config)) {
    return []
  }

  const messages = readUnreadByType(teamName, coordinatorId, "task_completed", config)

  const completions = messages.map(msg => {
    if (msg.payload.type === "task_completed") {
      return {
        taskId: msg.payload.taskId,
        agentId: msg.payload.agentId,
        messageId: msg.id,
      }
    }
    throw new Error("Unexpected message type")
  })

  // Mark as read
  markAsRead(teamName, coordinatorId, messages.map(m => m.id), config)

  return completions
}

/**
 * Auto-assign tasks to idle workers
 */
export function autoAssignTasks(
  teamName: string,
  coordinatorId: string,
  config: Partial<OhMyOpenCodeConfig>
): TaskAssignmentResult[] {
  if (!isCoordinator(teamName, coordinatorId, config)) {
    return []
  }

  const manifest = readManifest(teamName, config)
  if (!manifest) {
    return []
  }

  const listId = manifest.taskListId ?? teamName
  const results: TaskAssignmentResult[] = []

  // Get idle workers
  const idleWorkerIds = getIdleWorkers(teamName, coordinatorId, config)

  // Get all workers for capability matching
  const workers = getWorkers(teamName, config)
  const workerMap = new Map(workers.map(w => [w.id, w]))

  // Assign tasks to idle workers
  for (const workerId of idleWorkerIds) {
    const worker = workerMap.get(workerId)
    if (!worker) continue

    // Find next task for this worker
    const task = getNextTaskForAgent(
      listId,
      workerId,
      worker.capabilities,
      config,
      manifest.settings.assignmentStrategy
    )

    if (task) {
      const result = coordinatorAssignTask(
        teamName,
        coordinatorId,
        task.id,
        workerId,
        config
      )
      results.push(result)
    }
  }

  return results
}

/**
 * Reassign tasks from dead/stale workers
 *
 * Also removes stale workers from idleWorkers list to prevent
 * coordinator from assigning new tasks to them.
 */
export function reassignStaleTasks(
  teamName: string,
  coordinatorId: string,
  config: Partial<OhMyOpenCodeConfig>
): TaskAssignmentResult[] {
  if (!isCoordinator(teamName, coordinatorId, config)) {
    return []
  }

  const manifest = readManifest(teamName, config)
  if (!manifest) {
    return []
  }

  const listId = manifest.taskListId ?? teamName
  const results: TaskAssignmentResult[] = []
  const now = Date.now()
  const timeout = manifest.settings.heartbeatTimeoutMs

  // Find workers with stale heartbeats
  const staleWorkers = manifest.members.filter(m => {
    if (m.id === coordinatorId) return false
    if (!m.lastHeartbeat) return true
    return now - m.lastHeartbeat > timeout
  })

  // Reassign their tasks and remove from idleWorkers
  for (const worker of staleWorkers) {
    // Remove stale worker from idle list (they're not really idle if unresponsive)
    markWorkerBusy(teamName, worker.id, config)

    // Find in-progress tasks assigned to this worker
    const tasks = filterTasks(listId, {
      status: "in_progress",
      owner: worker.id,
    }, config)

    for (const task of tasks) {
      const reassigned = reassignTask(
        listId,
        task.id,
        `Worker ${worker.name} unresponsive`,
        config,
        { expectedOwnerId: worker.id }
      )

      if (reassigned) {
        results.push({
          success: true,
          taskId: task.id,
          reason: `Reassigned from unresponsive worker ${worker.name}`,
        })
      }
    }
  }

  return results
}

/**
 * Assignment status with task list and aggregate statistics
 */
export interface AssignmentStatusResult {
  /** Individual task statuses */
  tasks: Array<{
    taskId: string
    subject: string
    status: Task["status"]
    owner?: string
    ownerName?: string
  }>
  /** Aggregate statistics */
  stats: {
    total: number
    pending: number
    inProgress: number
    completed: number
    blocked: number
  }
}

/**
 * Get assignment status for all tasks with statistics
 */
export function getAssignmentStatus(
  teamName: string,
  config: Partial<OhMyOpenCodeConfig>
): AssignmentStatusResult {
  const manifest = readManifest(teamName, config)
  if (!manifest) {
    return {
      tasks: [],
      stats: { total: 0, pending: 0, inProgress: 0, completed: 0, blocked: 0 },
    }
  }

  const listId = manifest.taskListId ?? teamName
  const allTasks = filterTasks(listId, {}, config)
  const stats = getPoolStats(listId, config)

  const tasks = allTasks.map(task => {
    const owner = task.owner
      ? manifest.members.find(m => m.id === task.owner)
      : undefined

    return {
      taskId: task.id,
      subject: task.subject,
      status: task.status,
      owner: task.owner,
      ownerName: owner?.name,
    }
  })

  return {
    tasks,
    stats: {
      total: stats.total,
      pending: stats.pending,
      inProgress: stats.inProgress,
      completed: stats.completed,
      blocked: stats.blocked,
    },
  }
}
