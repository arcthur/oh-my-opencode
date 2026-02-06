import type { OhMyOpenCodeConfig } from "../../../config/schema"
import type { Task } from "../../sisyphus-tasks/types"
import {
  sendMessage,
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
  updateTask,
  completeTask,
  reassignTask,
  getNextTaskForAgent,
  filterTasks,
  getPoolStats,
} from "./pool"
import type { TaskAssignmentResult } from "./types"
import {
  recordRunEvent,
  releaseSlot,
  resolveParallelRuntimeConfig,
  tryAcquireSlot,
} from "../../parallel-runtime"
import type { ParallelRuntimeConfig } from "../../parallel-runtime"

const META_PARALLEL_LEASE_ID = "parallelRuntimeLeaseId"
const META_PARALLEL_RUN_ID = "parallelRuntimeRunId"
const META_PARALLEL_SUBSYSTEM = "parallelRuntimeSubsystem"

function getMetadataString(
  metadata: Record<string, unknown> | undefined,
  key: string
): string | undefined {
  const value = metadata?.[key]
  return typeof value === "string" && value.trim().length > 0 ? value : undefined
}

function resolveRuntimeConfig(
  config: Partial<OhMyOpenCodeConfig>
): ParallelRuntimeConfig {
  return resolveParallelRuntimeConfig(config.parallel_runtime)
}

function releaseSwarmLeaseForTask(
  task: Task | null,
  config: Partial<OhMyOpenCodeConfig>,
  type: "completed" | "failed" | "cancelled" | "released",
  metadata?: Record<string, unknown>
): void {
  if (!task) return
  const runtimeConfig = resolveRuntimeConfig(config)
  if (!runtimeConfig.enabled) return

  const leaseId = getMetadataString(task.metadata, META_PARALLEL_LEASE_ID)
  const teamName = getMetadataString(task.metadata, "teamName") ?? "team"
  const runId =
    getMetadataString(task.metadata, META_PARALLEL_RUN_ID) ??
    `swarm:${teamName}:${task.id}`

  recordRunEvent(
    {
      runId,
      subsystem: "swarm",
      type,
      leaseId,
      metadata,
    },
    runtimeConfig
  ).catch(() => {})

  if (!leaseId) return
  releaseSlot(leaseId, runtimeConfig).catch(() => {})
}

/**
 * Coordinator assigns a task to a worker via mailbox
 */
export function coordinatorAssignTask(
  teamName: string,
  coordinatorId: string,
  taskId: string,
  workerId: string,
  config: Partial<OhMyOpenCodeConfig>,
  options?: {
    assignmentMetadata?: Record<string, unknown>
  }
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
  const assigned = assignTask(listId, taskId, workerId, config, {
    metadata: options?.assignmentMetadata,
  })
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

  releaseSwarmLeaseForTask(completed, config, "completed", {
    taskId,
    workerId,
  })

  // Clear parallel-runtime lease metadata from completed task record.
  updateTask(
    listId,
    {
      taskId,
      metadata: {
        [META_PARALLEL_LEASE_ID]: null,
        [META_PARALLEL_RUN_ID]: null,
        [META_PARALLEL_SUBSYSTEM]: null,
      },
    },
    config
  )

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
 * Auto-assign tasks with global parallel-runtime admission control.
 *
 * - shadow mode: still assigns when saturated, while recording would_block.
 * - enforce mode: stops assigning new tasks once global slots are exhausted.
 */
export async function autoAssignTasksWithRuntime(
  teamName: string,
  coordinatorId: string,
  config: Partial<OhMyOpenCodeConfig>
): Promise<TaskAssignmentResult[]> {
  if (!isCoordinator(teamName, coordinatorId, config)) {
    return []
  }

  const manifest = readManifest(teamName, config)
  if (!manifest) {
    return []
  }

  const runtimeConfig = resolveRuntimeConfig(config)
  const listId = manifest.taskListId ?? teamName
  const results: TaskAssignmentResult[] = []

  const idleWorkerIds = getIdleWorkers(teamName, coordinatorId, config)
  const workers = getWorkers(teamName, config)
  const workerMap = new Map(workers.map(w => [w.id, w]))

  for (const workerId of idleWorkerIds) {
    const worker = workerMap.get(workerId)
    if (!worker) continue

    const task = getNextTaskForAgent(
      listId,
      workerId,
      worker.capabilities,
      config,
      manifest.settings.assignmentStrategy
    )
    if (!task) continue

    let assignmentMetadata: Record<string, unknown> | undefined
    if (runtimeConfig.enabled) {
      const runId = `swarm:${teamName}:${task.id}`
      const lease = await tryAcquireSlot(
        {
          subsystem: "swarm",
          runId,
          ownerSessionId: worker.sessionId,
          metadata: {
            teamName,
            taskId: task.id,
            workerId,
          },
        },
        runtimeConfig
      )

      if (!lease && runtimeConfig.mode === "enforce") {
        // Stop new assignments while at capacity. Keep workers idle.
        break
      }

      if (lease) {
        assignmentMetadata = {
          [META_PARALLEL_LEASE_ID]: lease.leaseId,
          [META_PARALLEL_RUN_ID]: lease.runId,
          [META_PARALLEL_SUBSYSTEM]: "swarm",
          teamName,
        }
      }
    }

    const result = coordinatorAssignTask(
      teamName,
      coordinatorId,
      task.id,
      workerId,
      config,
      {
        assignmentMetadata,
      }
    )
    results.push(result)

    if (!result.success && assignmentMetadata) {
      const leaseId = getMetadataString(assignmentMetadata, META_PARALLEL_LEASE_ID)
      const runId = getMetadataString(assignmentMetadata, META_PARALLEL_RUN_ID)
      if (runId) {
        recordRunEvent(
          {
            runId,
            subsystem: "swarm",
            type: "failed",
            leaseId,
            metadata: {
              reason: result.reason ?? "assignment_failed",
            },
          },
          runtimeConfig
        ).catch(() => {})
      }
      if (leaseId) {
        releaseSlot(leaseId, runtimeConfig).catch(() => {})
      }
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
        releaseSwarmLeaseForTask(reassigned, config, "failed", {
          taskId: task.id,
          reason: "worker_unresponsive",
          workerId: worker.id,
        })
        updateTask(
          listId,
          {
            taskId: task.id,
            metadata: {
              [META_PARALLEL_LEASE_ID]: null,
              [META_PARALLEL_RUN_ID]: null,
              [META_PARALLEL_SUBSYSTEM]: null,
            },
          },
          config
        )
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
