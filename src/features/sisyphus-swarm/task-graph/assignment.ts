import type { OhMyOpenCodeConfig } from "../../../config/schema"
import type { TaskLease, TaskLifecycleState, TaskNode, TaskReadiness } from "../../task-system"
import {
  createFsMailboxTransport,
  type MailboxTransport,
} from "../mailbox"
import {
  readManifest,
  getMember,
  isCoordinator,
  getWorkers,
  markWorkerBusy,
} from "../team/manifest"
import { getCoordinatorEpoch } from "../team/coordinator-lease"
import { getIdleWorkers } from "../team/membership"
import {
  recordRunEvent,
  releaseSlot,
  resolveParallelRuntimeConfig,
  tryAcquireSlot,
} from "../../parallel-runtime"
import type { ParallelRuntimeConfig } from "../../parallel-runtime"
import { log } from "../../../shared/logger"
import {
  assignSwarmTask,
  completeSwarmTask,
  getNextSwarmTaskForAgent,
  getSwarmTaskPoolStats,
  listSwarmTaskSummaries,
  readSwarmTaskNode,
  reassignSwarmTask,
  updateSwarmTask,
} from "./pool"

export interface TaskAssignmentResult {
  success: boolean
  taskId?: string
  agentId?: string
  reason?: string
}

function resolveMailboxTransport(
  config: Partial<OhMyOpenCodeConfig>,
  transport?: MailboxTransport
): MailboxTransport {
  return transport ?? createFsMailboxTransport(config)
}

function resolveRuntimeConfig(config: Partial<OhMyOpenCodeConfig>): ParallelRuntimeConfig {
  return resolveParallelRuntimeConfig(config.parallel_runtime)
}

function buildRuntimeRunId(teamName: string, taskId: string): string {
  return `swarm:${teamName}:${taskId}`
}

function normalizeRequiredCapabilities(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const items = value.filter((v) => typeof v === "string") as string[]
  return items.map((v) => v.trim()).filter((v) => v.length > 0)
}

function normalizeStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const items = value.filter((v) => typeof v === "string") as string[]
  const trimmed = items.map((v) => v.trim()).filter((v) => v.length > 0)
  return trimmed.length > 0 ? trimmed : undefined
}

function extractMetadataString(metadata: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = metadata?.[key]
  return typeof value === "string" && value.trim().length > 0 ? value : undefined
}

function extractTaskLease(task: TaskNode | null): TaskLease | undefined {
  return task?.lease
}

function clearTaskLease(
  teamName: string,
  taskId: string,
  config: Partial<OhMyOpenCodeConfig>
): void {
  updateSwarmTask(teamName, { id: taskId, lease: null }, config)
}

function releaseSwarmLease(
  teamName: string,
  taskId: string,
  lease: TaskLease | undefined,
  config: Partial<OhMyOpenCodeConfig>,
  type: "completed" | "failed" | "cancelled" | "released",
  metadata?: Record<string, unknown>
): void {
  if (!lease) return

  const runtimeConfig = resolveRuntimeConfig(config)
  if (!runtimeConfig.enabled) return

  const runId = lease.run_id ?? buildRuntimeRunId(teamName, taskId)
  const leaseId = lease.lease_id

  recordRunEvent(
    {
      runId,
      subsystem: "swarm",
      type,
      leaseId,
      metadata,
    },
    runtimeConfig
  ).catch((err) => {
    log("[swarm] recordRunEvent failed", {
      teamName,
      taskId,
      type,
      error: err instanceof Error ? err.message : String(err),
    })
  })

  releaseSlot(leaseId, runtimeConfig).catch((err) => {
    log("[swarm] releaseSlot failed", {
      teamName,
      taskId,
      leaseId,
      error: err instanceof Error ? err.message : String(err),
    })
  })
}

export function releaseSwarmTaskLease(
  teamName: string,
  taskId: string,
  config: Partial<OhMyOpenCodeConfig>,
  outcome: "completed" | "failed" | "cancelled" | "released",
  metadata?: Record<string, unknown>
): void {
  const task = readSwarmTaskNode(teamName, taskId, config)
  const lease = extractTaskLease(task)
  releaseSwarmLease(teamName, taskId, lease, config, outcome, metadata)
  clearTaskLease(teamName, taskId, config)
}

export function coordinatorAssignTask(
  teamName: string,
  coordinatorId: string,
  taskId: string,
  workerId: string,
  config: Partial<OhMyOpenCodeConfig>,
  options?: {
    lease?: TaskLease
    assignmentMetadata?: Record<string, unknown>
    mailboxTransport?: MailboxTransport
  }
): TaskAssignmentResult {
  if (!isCoordinator(teamName, coordinatorId, config)) {
    return { success: false, reason: "Only coordinator can assign tasks" }
  }

  const manifest = readManifest(teamName, config, { includeHeartbeats: false })
  if (!manifest) {
    return { success: false, reason: "Team not found" }
  }

  const task = readSwarmTaskNode(teamName, taskId, config)
  if (!task) {
    return { success: false, reason: "Task not found" }
  }

  if (task.state !== "open") {
    return { success: false, reason: `Task is not open (state: ${task.state})` }
  }

  const worker = getMember(teamName, workerId, config)
  if (!worker) {
    return { success: false, reason: "Worker is not a team member" }
  }

  const history = (task.metadata?.assignmentHistory as Array<{
    agentId: string
    assignedAt: number
    completedAt?: number
    result?: string
  }> | undefined) ?? []
  const parentContext = history.length > 0
    ? {
        previousAttempts: history.length,
        lastError: extractMetadataString(task.metadata, "lastReassignReason"),
        lastWorkerId: history[history.length - 1]?.agentId,
      }
    : undefined

  const assigned = assignSwarmTask(teamName, taskId, workerId, config, {
    metadata: options?.assignmentMetadata,
    lease: options?.lease,
  })
  if (!assigned) {
    return { success: false, reason: "Failed to assign task" }
  }

  markWorkerBusy(teamName, workerId, config)

  const requiredCapabilities = normalizeRequiredCapabilities(task.metadata?.requiredCapabilities)
  const contextSummary = extractMetadataString(task.metadata, "contextSummary")
  const relevantFiles = normalizeStringArray(task.metadata?.relevantFiles)

  const mailboxTransport = resolveMailboxTransport(config, options?.mailboxTransport)
  mailboxTransport.sendMessage(
    teamName,
    coordinatorId,
    workerId,
    {
      type: "task_assignment",
      taskId: task.id,
      title: task.title,
      description: task.description,
      assignedBy: coordinatorId,
      timestamp: Date.now(),
      contextSummary,
      relevantFiles,
      parentContext,
      requiredCapabilities: requiredCapabilities.length > 0 ? requiredCapabilities : undefined,
      priority: task.priority,
    }
  )

  return { success: true, taskId: task.id, agentId: workerId }
}

export function workerReportCompletion(
  teamName: string,
  workerId: string,
  taskId: string,
  config: Partial<OhMyOpenCodeConfig>,
  options?: { mailboxTransport?: MailboxTransport }
): boolean {
  const manifest = readManifest(teamName, config, { includeHeartbeats: false })
  if (!manifest) {
    return false
  }

  const completed = completeSwarmTask(teamName, taskId, workerId, config)
  if (!completed) {
    return false
  }

  const mailboxTransport = resolveMailboxTransport(config, options?.mailboxTransport)
  mailboxTransport.sendMessage(
    teamName,
    workerId,
    manifest.coordinatorId,
    {
      type: "task_completed",
      taskId,
      agentId: workerId,
      timestamp: Date.now(),
    },
    {
      epoch: getCoordinatorEpoch(teamName, config) ?? undefined,
    }
  )

  return true
}

export async function autoAssignTasksWithRuntime(
  teamName: string,
  coordinatorId: string,
  config: Partial<OhMyOpenCodeConfig>,
  options?: { mailboxTransport?: MailboxTransport }
): Promise<TaskAssignmentResult[]> {
  if (!isCoordinator(teamName, coordinatorId, config)) {
    return []
  }

  const manifest = readManifest(teamName, config, { includeHeartbeats: false })
  if (!manifest) {
    return []
  }

  const runtimeConfig = resolveRuntimeConfig(config)
  const results: TaskAssignmentResult[] = []

  const idleWorkerIds = getIdleWorkers(teamName, coordinatorId, config, {
    mailboxTransport: options?.mailboxTransport,
  })
  const workers = getWorkers(teamName, config)
  const workerMap = new Map(workers.map((w) => [w.id, w]))

  for (const workerId of idleWorkerIds) {
    const worker = workerMap.get(workerId)
    if (!worker) continue

    const nextTask = getNextSwarmTaskForAgent(
      teamName,
      workerId,
      worker.capabilities,
      config,
      manifest.settings.assignmentStrategy
    )
    if (!nextTask) continue

    let lease: TaskLease | undefined
    if (runtimeConfig.enabled) {
      const runId = buildRuntimeRunId(teamName, nextTask.id)
      const acquired = await tryAcquireSlot(
        {
          subsystem: "swarm",
          runId,
          ownerSessionId: worker.sessionId,
          metadata: {
            teamName,
            taskId: nextTask.id,
            workerId,
          },
        },
        runtimeConfig
      )

      if (!acquired && runtimeConfig.mode === "enforce") {
        break
      }

      if (acquired) {
        lease = {
          lease_id: acquired.leaseId,
          run_id: acquired.runId,
          subsystem: "swarm",
          acquired_at: Date.now(),
        }
      }
    }

    const result = coordinatorAssignTask(teamName, coordinatorId, nextTask.id, workerId, config, {
      lease,
      mailboxTransport: options?.mailboxTransport,
    })
    results.push(result)

    if (!result.success && lease) {
      const runId = lease.run_id ?? buildRuntimeRunId(teamName, nextTask.id)
      recordRunEvent(
        {
          runId,
          subsystem: "swarm",
          type: "failed",
          leaseId: lease.lease_id,
          metadata: {
            reason: result.reason ?? "assignment_failed",
          },
        },
        runtimeConfig
      ).catch((err) => {
        log("[swarm] recordRunEvent failed (assignment_failed)", {
          teamName,
          taskId: nextTask.id,
          error: err instanceof Error ? err.message : String(err),
        })
      })

      releaseSlot(lease.lease_id, runtimeConfig).catch((err) => {
        log("[swarm] releaseSlot failed (assignment_failed)", {
          teamName,
          taskId: nextTask.id,
          leaseId: lease.lease_id,
          error: err instanceof Error ? err.message : String(err),
        })
      })
    }
  }

  return results
}

export function reassignStaleTasks(
  teamName: string,
  coordinatorId: string,
  config: Partial<OhMyOpenCodeConfig>
): TaskAssignmentResult[] {
  if (!isCoordinator(teamName, coordinatorId, config)) {
    return []
  }

  const manifest = readManifest(teamName, config, { includeHeartbeats: false })
  if (!manifest) {
    return []
  }

  const results: TaskAssignmentResult[] = []
  const now = Date.now()
  const timeout = manifest.settings.heartbeatTimeoutMs

  const staleWorkers = manifest.members.filter((m) => {
    if (m.id === coordinatorId) return false
    if (!m.lastHeartbeat) return true
    return now - m.lastHeartbeat > timeout
  })

  for (const worker of staleWorkers) {
    markWorkerBusy(teamName, worker.id, config)

    const inProgress = listSwarmTaskSummaries(teamName, config, { include_completed: true })
      .filter((t) => t.state === "in_progress" && t.owner === worker.id)

    for (const task of inProgress) {
      const reassigned = reassignSwarmTask(
        teamName,
        task.id,
        `Worker ${worker.name} unresponsive`,
        config,
        { expectedOwnerId: worker.id }
      )
      if (!reassigned) continue
      releaseSwarmTaskLease(teamName, task.id, config, "failed", {
        taskId: task.id,
        reason: "worker_unresponsive",
        workerId: worker.id,
      })

      results.push({
        success: true,
        taskId: task.id,
        reason: `Reassigned from unresponsive worker ${worker.name}`,
      })
    }
  }

  return results
}

export interface AssignmentStatusResult {
  tasks: Array<{
    taskId: string
    title: string
    state: TaskLifecycleState
    readiness: TaskReadiness
    owner?: string
    ownerName?: string
  }>
  stats: ReturnType<typeof getSwarmTaskPoolStats>
}

export function getAssignmentStatus(
  teamName: string,
  config: Partial<OhMyOpenCodeConfig>
): AssignmentStatusResult {
  const manifest = readManifest(teamName, config, { includeHeartbeats: false })
  if (!manifest) {
    return {
      tasks: [],
      stats: {
        total: 0,
        open: 0,
        in_progress: 0,
        completed: 0,
        failed: 0,
        cancelled: 0,
        blocked: 0,
      },
    }
  }

  const summaries = listSwarmTaskSummaries(teamName, config, { include_completed: true })
  const stats = getSwarmTaskPoolStats(teamName, config)

  const tasks = summaries.map((task) => {
    const owner = task.owner
      ? manifest.members.find((m) => m.id === task.owner)
      : undefined

    return {
      taskId: task.id,
      title: task.title,
      state: task.state,
      readiness: task.readiness,
      owner: task.owner,
      ownerName: owner?.name,
    }
  })

  return {
    tasks,
    stats,
  }
}
