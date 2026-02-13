import type { OhMyOpenCodeConfig } from "../../../config/schema"
import {
  TASK_ERROR_CODES,
  TaskSystemError,
  canTransitionTaskState,
  createTaskNode,
  getTaskNode,
  listTaskNodes,
  transitionTaskNode,
  updateTaskNode,
  type TaskLease,
  type TaskLifecycleState,
  type TaskNode,
  type TaskSummary,
} from "../../task-system"
import { getTaskSummary, listIncompleteTasks } from "../../task-system/query"

const SWARM_SCOPE = "swarm" as const

export interface SwarmTaskSelector {
  teamName: string
}

export interface SwarmTaskCreateInput {
  title: string
  description: string
  owner?: string
  priority?: number
  depends_on?: string[]
  metadata?: Record<string, unknown>
  lease?: TaskLease
}

export interface SwarmTaskUpdateInput {
  id: string
  title?: string
  description?: string
  owner?: string | null
  priority?: number
  add_depends_on?: string[]
  remove_depends_on?: string[]
  metadata?: Record<string, unknown>
  lease?: TaskLease | null
}

export interface SwarmTaskPoolStats {
  total: number
  open: number
  in_progress: number
  completed: number
  failed: number
  cancelled: number
  blocked: number
}

function getSelector(teamName: string): { scope: typeof SWARM_SCOPE; container_id: string } {
  return {
    scope: SWARM_SCOPE,
    container_id: teamName,
  }
}

function isRevisionConflict(error: unknown): boolean {
  return error instanceof TaskSystemError && error.code === TASK_ERROR_CODES.revision_conflict
}

function mutateWithRetry<T>(fn: () => T): T {
  const maxAttempts = 3
  let lastError: unknown

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      return fn()
    } catch (error) {
      if (isRevisionConflict(error)) {
        lastError = error
        continue
      }
      throw error
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Task mutation failed after retries")
}

export function createSwarmTask(
  teamName: string,
  input: SwarmTaskCreateInput,
  config: Partial<OhMyOpenCodeConfig>
): TaskNode {
  return createTaskNode(
    {
      ...getSelector(teamName),
      title: input.title,
      description: input.description,
      owner: input.owner,
      priority: input.priority ?? 0,
      depends_on: input.depends_on,
      metadata: input.metadata,
      lease: input.lease,
    },
    config
  )
}

export function readSwarmTaskNode(
  teamName: string,
  taskId: string,
  config: Partial<OhMyOpenCodeConfig>
): TaskNode | null {
  return getTaskNode({ ...getSelector(teamName), id: taskId }, config)
}

export function readSwarmTaskSummary(
  teamName: string,
  taskId: string,
  config: Partial<OhMyOpenCodeConfig>
): TaskSummary | null {
  return getTaskSummary({ ...getSelector(teamName), id: taskId }, config)
}

export function listSwarmTaskSummaries(
  teamName: string,
  config: Partial<OhMyOpenCodeConfig>,
  options?: {
    include_completed?: boolean
  }
): TaskSummary[] {
  return listTaskNodes(
    {
      ...getSelector(teamName),
      include_completed: options?.include_completed ?? true,
    },
    config
  )
}

export function getSwarmTaskPoolStats(
  teamName: string,
  config: Partial<OhMyOpenCodeConfig>
): SwarmTaskPoolStats {
  const summaries = listSwarmTaskSummaries(teamName, config, { include_completed: true })

  let open = 0
  let inProgress = 0
  let completed = 0
  let failed = 0
  let cancelled = 0
  let blocked = 0

  for (const task of summaries) {
    if (task.state === "open") {
      open += 1
      if (task.readiness === "blocked") {
        blocked += 1
      }
    } else if (task.state === "in_progress") {
      inProgress += 1
    } else if (task.state === "completed") {
      completed += 1
    } else if (task.state === "failed") {
      failed += 1
    } else if (task.state === "cancelled") {
      cancelled += 1
    }
  }

  return {
    total: summaries.length,
    open,
    in_progress: inProgress,
    completed,
    failed,
    cancelled,
    blocked,
  }
}

export function updateSwarmTask(
  teamName: string,
  input: SwarmTaskUpdateInput,
  config: Partial<OhMyOpenCodeConfig>
): TaskNode | null {
  return mutateWithRetry(() => {
    const node = readSwarmTaskNode(teamName, input.id, config)
    if (!node) return null

    return updateTaskNode(
      {
        ...getSelector(teamName),
        id: input.id,
        expected_revision: node.revision,
        title: input.title,
        description: input.description,
        owner: input.owner,
        priority: input.priority,
        add_depends_on: input.add_depends_on,
        remove_depends_on: input.remove_depends_on,
        metadata: input.metadata,
        lease: input.lease,
      },
      config
    )
  })
}

export function transitionSwarmTask(
  teamName: string,
  input: {
    id: string
    next_state: TaskLifecycleState
    lease?: TaskLease | null
  },
  config: Partial<OhMyOpenCodeConfig>
): TaskNode | null {
  return mutateWithRetry(() => {
    const node = readSwarmTaskNode(teamName, input.id, config)
    if (!node) return null

    return transitionTaskNode(
      {
        ...getSelector(teamName),
        id: node.id,
        expected_revision: node.revision,
        next_state: input.next_state,
        lease: input.lease,
      },
      config
    )
  })
}

function appendAssignmentHistory(
  existing: unknown,
  entry: { agentId: string; assignedAt: number }
): Array<{ agentId: string; assignedAt: number; completedAt: number | undefined; result: string | undefined }> {
  const history = Array.isArray(existing) ? existing : []
  const normalized = history
    .filter((v) => v && typeof v === "object")
    .map((v) => v as Record<string, unknown>)
    .map((v) => ({
      agentId: typeof v.agentId === "string" ? v.agentId : "",
      assignedAt: typeof v.assignedAt === "number" ? v.assignedAt : 0,
      completedAt: typeof v.completedAt === "number" ? v.completedAt : undefined,
      result: typeof v.result === "string" ? v.result : undefined,
    }))
    .filter((v) => v.agentId.length > 0 && v.assignedAt > 0)

  normalized.push({ ...entry, completedAt: undefined, result: undefined })
  return normalized
}

export function assignSwarmTask(
  teamName: string,
  taskId: string,
  agentId: string,
  config: Partial<OhMyOpenCodeConfig>,
  options?: {
    metadata?: Record<string, unknown>
    lease?: TaskLease
  }
): TaskNode | null {
  return mutateWithRetry(() => {
    const summary = readSwarmTaskSummary(teamName, taskId, config)
    if (!summary) return null
    if (summary.state !== "open") return null
    if (summary.readiness !== "ready") return null

    const node = readSwarmTaskNode(teamName, taskId, config)
    if (!node) return null
    if (node.owner) return null

    const history = appendAssignmentHistory(node.metadata?.assignmentHistory, {
      agentId,
      assignedAt: Date.now(),
    })

    const updated = updateTaskNode(
      {
        ...getSelector(teamName),
        id: taskId,
        expected_revision: node.revision,
        owner: agentId,
        metadata: {
          ...(options?.metadata ?? {}),
          assignmentHistory: history,
        },
        lease: options?.lease,
      },
      config
    )

    if (updated.state === "in_progress") {
      return updated
    }

    if (!canTransitionTaskState(updated.state, "in_progress")) {
      return null
    }

    return transitionTaskNode(
      {
        ...getSelector(teamName),
        id: updated.id,
        expected_revision: updated.revision,
        next_state: "in_progress",
      },
      config
    )
  })
}

function markLastAssignmentResult(
  historyRaw: unknown,
  agentId: string,
  result: "completed" | "failed" | "reassigned"
): Array<{ agentId: string; assignedAt: number; completedAt?: number; result?: string }> {
  const history = Array.isArray(historyRaw) ? historyRaw : []
  const normalized = history
    .filter((v) => v && typeof v === "object")
    .map((v) => v as Record<string, unknown>)
    .map((v) => ({
      agentId: typeof v.agentId === "string" ? v.agentId : "",
      assignedAt: typeof v.assignedAt === "number" ? v.assignedAt : 0,
      completedAt: typeof v.completedAt === "number" ? v.completedAt : undefined,
      result: typeof v.result === "string" ? v.result : undefined,
    }))
    .filter((v) => v.agentId.length > 0 && v.assignedAt > 0)

  const last = normalized[normalized.length - 1]
  if (last && last.agentId === agentId) {
    last.completedAt = Date.now()
    last.result = result
  }

  return normalized
}

export function completeSwarmTask(
  teamName: string,
  taskId: string,
  agentId: string,
  config: Partial<OhMyOpenCodeConfig>
): TaskNode | null {
  return mutateWithRetry(() => {
    const node = readSwarmTaskNode(teamName, taskId, config)
    if (!node) return null
    if (node.state !== "in_progress") return null
    if (node.owner && node.owner !== agentId) return null

    const history = markLastAssignmentResult(
      node.metadata?.assignmentHistory,
      agentId,
      "completed"
    )

    const updated = updateTaskNode(
      {
        ...getSelector(teamName),
        id: taskId,
        expected_revision: node.revision,
        metadata: { assignmentHistory: history },
      },
      config
    )

    return transitionTaskNode(
      {
        ...getSelector(teamName),
        id: updated.id,
        expected_revision: updated.revision,
        next_state: "completed",
      },
      config
    )
  })
}

export function reassignSwarmTask(
  teamName: string,
  taskId: string,
  reason: string,
  config: Partial<OhMyOpenCodeConfig>,
  options?: { expectedOwnerId?: string }
): TaskNode | null {
  return mutateWithRetry(() => {
    const node = readSwarmTaskNode(teamName, taskId, config)
    if (!node) return null
    if (options?.expectedOwnerId && node.owner && node.owner !== options.expectedOwnerId) {
      return null
    }

    const history = markLastAssignmentResult(
      node.metadata?.assignmentHistory,
      node.owner ?? options?.expectedOwnerId ?? "",
      "reassigned"
    )

    const updated = updateTaskNode(
      {
        ...getSelector(teamName),
        id: taskId,
        expected_revision: node.revision,
        owner: null,
        metadata: {
          assignmentHistory: history,
          lastReassignReason: reason,
        },
      },
      config
    )

    if (updated.state === "open") {
      return updated
    }

    if (!canTransitionTaskState(updated.state, "open")) {
      return null
    }

    return transitionTaskNode(
      {
        ...getSelector(teamName),
        id: updated.id,
        expected_revision: updated.revision,
        next_state: "open",
      },
      config
    )
  })
}

export function dependencyDepth(
  teamName: string,
  taskId: string,
  config: Partial<OhMyOpenCodeConfig>,
  memo: Map<string, number> = new Map()
): number {
  if (memo.has(taskId)) return memo.get(taskId)!

  const task = readSwarmTaskNode(teamName, taskId, config)
  if (!task || task.depends_on.length === 0) {
    memo.set(taskId, 0)
    return 0
  }

  let maxDepth = 0
  for (const dependencyId of task.depends_on) {
    const depth = dependencyDepth(teamName, dependencyId, config, memo)
    maxDepth = Math.max(maxDepth, depth)
  }

  const computed = maxDepth + 1
  memo.set(taskId, computed)
  return computed
}

function taskNodeRequiresCapabilities(task: TaskNode, agentCapabilities: string[]): boolean {
  const requiredRaw = task.metadata?.requiredCapabilities
  const required = Array.isArray(requiredRaw)
    ? (requiredRaw.filter((v) => typeof v === "string") as string[])
    : []
  if (required.length === 0) return true
  return required.every((cap) => agentCapabilities.includes(cap))
}

export function getNextSwarmTaskForAgent(
  teamName: string,
  _agentId: string,
  capabilities: string[],
  config: Partial<OhMyOpenCodeConfig>,
  _strategy: "round-robin" | "capability-match" | "load-balance" = "capability-match"
): TaskNode | null {
  const summaries = listIncompleteTasks(getSelector(teamName), config).filter(
    (task) => task.state === "open" && task.readiness === "ready" && !task.owner
  )

  const candidates: TaskNode[] = []
  for (const summary of summaries) {
    const node = readSwarmTaskNode(teamName, summary.id, config)
    if (!node) continue
    if (!taskNodeRequiresCapabilities(node, capabilities)) continue
    candidates.push(node)
  }

  if (candidates.length === 0) return null

  const depthMemo = new Map<string, number>()
  candidates.sort((a, b) => {
    if (a.priority !== b.priority) {
      return b.priority - a.priority
    }

    const depthA = dependencyDepth(teamName, a.id, config, depthMemo)
    const depthB = dependencyDepth(teamName, b.id, config, depthMemo)
    if (depthA !== depthB) {
      return depthA - depthB
    }

    return a.id.localeCompare(b.id)
  })

  return candidates[0] ?? null
}
