import type { OhMyOpenCodeConfig } from "../../config/schema"
import {
  TASK_ERROR_CODES,
  TaskSystemError,
  canTransitionTaskState,
  deriveTaskReadiness,
  toTaskSummary,
  wouldCreateDependencyCycle,
  type TaskLease,
  type TaskLifecycleState,
  type TaskNode,
  type TaskScope,
  type TaskSummary,
} from "./domain"
import {
  generateTaskNodeId,
  readAllTaskNodes,
  readTaskNode,
  withTaskGraphLock,
  writeTaskNode,
} from "./storage"

export interface TaskContainerSelector {
  scope: TaskScope
  container_id: string
}

export interface TaskCreateInput extends TaskContainerSelector {
  title: string
  description?: string
  owner?: string
  priority?: number
  depends_on?: string[]
  metadata?: Record<string, unknown>
  lease?: TaskLease
}

export interface TaskUpdateInput extends TaskContainerSelector {
  id: string
  expected_revision: number
  title?: string
  description?: string
  owner?: string | null
  priority?: number
  add_depends_on?: string[]
  remove_depends_on?: string[]
  metadata?: Record<string, unknown>
  lease?: TaskLease | null
}

export interface TaskTransitionInput extends TaskContainerSelector {
  id: string
  expected_revision: number
  next_state: TaskLifecycleState
  lease?: TaskLease | null
}

export interface TaskListInput extends TaskContainerSelector {
  include_completed?: boolean
  ready_only?: boolean
  state?: TaskLifecycleState
}

function toTaskMap(tasks: TaskNode[]): Map<string, TaskNode> {
  return new Map(tasks.map((task) => [task.id, task]))
}

function removeDuplicateValues(values: string[] | undefined): string[] {
  if (!values || values.length === 0) {
    return []
  }

  const seen = new Set<string>()
  const next: string[] = []

  for (const value of values) {
    if (!value || seen.has(value)) continue
    seen.add(value)
    next.push(value)
  }

  return next
}

function ensureDependenciesExist(
  dependsOn: string[],
  taskMap: Map<string, TaskNode>
): void {
  for (const dependencyId of dependsOn) {
    if (!taskMap.has(dependencyId)) {
      throw new TaskSystemError(
        TASK_ERROR_CODES.dependency_not_found,
        `Dependency task not found: ${dependencyId}`,
        { dependencyId }
      )
    }
  }
}

function resolveTaskSummaryList(tasks: TaskNode[]): TaskSummary[] {
  const taskMap = toTaskMap(tasks)
  return tasks.map((task) =>
    toTaskSummary(task, (taskId) => taskMap.get(taskId)?.state)
  )
}

function loadTaskOrThrow(
  scope: TaskScope,
  containerId: string,
  taskId: string,
  config: Partial<OhMyOpenCodeConfig>
): TaskNode {
  const task = readTaskNode(scope, containerId, taskId, config)
  if (!task) {
    throw new TaskSystemError(
      TASK_ERROR_CODES.task_not_found,
      `Task not found: ${taskId}`,
      { taskId, scope, containerId }
    )
  }
  return task
}

function assertRevision(task: TaskNode, expectedRevision: number): void {
  if (task.revision !== expectedRevision) {
    throw new TaskSystemError(
      TASK_ERROR_CODES.revision_conflict,
      `Task revision conflict: expected ${expectedRevision}, got ${task.revision}`,
      { taskId: task.id, expectedRevision, actualRevision: task.revision }
    )
  }
}

function getNow(): number {
  return Date.now()
}

export function createTaskNode(
  input: TaskCreateInput,
  config: Partial<OhMyOpenCodeConfig>
): TaskNode {
  return withTaskGraphLock(input.scope, input.container_id, config, () => {
    const now = getNow()
    const allTasks = readAllTaskNodes(input.scope, input.container_id, config)
    const taskMap = toTaskMap(allTasks)
    const dependsOn = removeDuplicateValues(input.depends_on)

    ensureDependenciesExist(dependsOn, taskMap)

    const taskId = generateTaskNodeId()
    if (dependsOn.includes(taskId)) {
      throw new TaskSystemError(
        TASK_ERROR_CODES.invalid_dependency,
        `Task cannot depend on itself: ${taskId}`,
        { taskId }
      )
    }

    if (
      wouldCreateDependencyCycle(taskId, dependsOn, (id) => taskMap.get(id)?.depends_on ?? [])
    ) {
      throw new TaskSystemError(
        TASK_ERROR_CODES.dependency_cycle,
        `Dependency cycle detected for task ${taskId}`,
        { taskId, dependsOn }
      )
    }

    const node: TaskNode = {
      id: taskId,
      title: input.title,
      description: input.description ?? "",
      state: "open",
      scope: input.scope,
      container_id: input.container_id,
      owner: input.owner,
      priority: input.priority ?? 0,
      depends_on: dependsOn,
      metadata: input.metadata,
      revision: 1,
      lease: input.lease,
      created_at: now,
      updated_at: now,
    }

    writeTaskNode(node, config)
    return node
  })
}

export function getTaskNode(
  selector: TaskContainerSelector & { id: string },
  config: Partial<OhMyOpenCodeConfig>
): TaskNode | null {
  return readTaskNode(selector.scope, selector.container_id, selector.id, config)
}

export function listTaskNodes(
  input: TaskListInput,
  config: Partial<OhMyOpenCodeConfig>
): TaskSummary[] {
  const tasks = readAllTaskNodes(input.scope, input.container_id, config)
  const summaries = resolveTaskSummaryList(tasks)

  return summaries.filter((task) => {
    if (!input.include_completed && (task.state === "completed" || task.state === "cancelled")) {
      return false
    }
    if (input.state && task.state !== input.state) {
      return false
    }
    if (input.ready_only && task.readiness !== "ready") {
      return false
    }
    return true
  })
}

export function updateTaskNode(
  input: TaskUpdateInput,
  config: Partial<OhMyOpenCodeConfig>
): TaskNode {
  return withTaskGraphLock(input.scope, input.container_id, config, () => {
    const task = loadTaskOrThrow(input.scope, input.container_id, input.id, config)
    assertRevision(task, input.expected_revision)

    const allTasks = readAllTaskNodes(input.scope, input.container_id, config)
    const taskMap = toTaskMap(allTasks)

    const addDependencies = removeDuplicateValues(input.add_depends_on)
    const removeDependencies = new Set(removeDuplicateValues(input.remove_depends_on))

    let nextDependsOn = task.depends_on.filter((dependencyId) => !removeDependencies.has(dependencyId))
    for (const dependencyId of addDependencies) {
      if (!nextDependsOn.includes(dependencyId)) {
        nextDependsOn.push(dependencyId)
      }
    }

    if (nextDependsOn.includes(task.id)) {
      throw new TaskSystemError(
        TASK_ERROR_CODES.invalid_dependency,
        `Task cannot depend on itself: ${task.id}`,
        { taskId: task.id }
      )
    }

    ensureDependenciesExist(nextDependsOn, taskMap)

    if (
      wouldCreateDependencyCycle(task.id, nextDependsOn, (id) => {
        if (id === task.id) {
          return nextDependsOn
        }
        return taskMap.get(id)?.depends_on ?? []
      })
    ) {
      throw new TaskSystemError(
        TASK_ERROR_CODES.dependency_cycle,
        `Dependency cycle detected for task ${task.id}`,
        { taskId: task.id, dependsOn: nextDependsOn }
      )
    }

    if (input.title !== undefined) {
      task.title = input.title
    }
    if (input.description !== undefined) {
      task.description = input.description
    }
    if (input.owner !== undefined) {
      task.owner = input.owner ?? undefined
    }
    if (input.priority !== undefined) {
      task.priority = input.priority
    }

    if (input.metadata !== undefined) {
      task.metadata = { ...task.metadata, ...input.metadata }
      if (task.metadata) {
        for (const key of Object.keys(task.metadata)) {
          if (task.metadata[key] === null) {
            delete task.metadata[key]
          }
        }
      }
    }

    if (input.lease !== undefined) {
      task.lease = input.lease ?? undefined
    }

    task.depends_on = nextDependsOn
    task.revision += 1
    task.updated_at = getNow()

    writeTaskNode(task, config)
    return task
  })
}

export function transitionTaskNode(
  input: TaskTransitionInput,
  config: Partial<OhMyOpenCodeConfig>
): TaskNode {
  return withTaskGraphLock(input.scope, input.container_id, config, () => {
    const task = loadTaskOrThrow(input.scope, input.container_id, input.id, config)
    assertRevision(task, input.expected_revision)

    if (!canTransitionTaskState(task.state, input.next_state)) {
      throw new TaskSystemError(
        TASK_ERROR_CODES.invalid_transition,
        `Invalid transition ${task.state} -> ${input.next_state}`,
        { currentState: task.state, nextState: input.next_state }
      )
    }

    const taskMap = toTaskMap(readAllTaskNodes(input.scope, input.container_id, config))
    const readiness = deriveTaskReadiness(task, (id) => taskMap.get(id)?.state)
    if (input.next_state === "completed" && readiness.readiness === "blocked") {
      throw new TaskSystemError(
        TASK_ERROR_CODES.transition_blocked,
        `Task ${task.id} is blocked by unresolved dependencies`,
        { taskId: task.id, blocked_by_unresolved: readiness.blocked_by_unresolved }
      )
    }

    task.state = input.next_state
    if (input.lease !== undefined) {
      task.lease = input.lease ?? undefined
    }
    task.revision += 1
    task.updated_at = getNow()

    writeTaskNode(task, config)
    return task
  })
}
