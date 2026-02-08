import { z } from "zod"

export const TaskLifecycleStateSchema = z.enum([
  "open",
  "in_progress",
  "completed",
  "cancelled",
  "failed",
])
export type TaskLifecycleState = z.infer<typeof TaskLifecycleStateSchema>

export const TaskReadinessSchema = z.enum(["ready", "blocked"])
export type TaskReadiness = z.infer<typeof TaskReadinessSchema>

export const TaskScopeSchema = z.enum(["session", "plan", "swarm"])
export type TaskScope = z.infer<typeof TaskScopeSchema>

export const TaskLeaseSchema = z.object({
  lease_id: z.string().min(1),
  run_id: z.string().min(1).optional(),
  subsystem: z.string().min(1).optional(),
  acquired_at: z.number(),
})
export type TaskLease = z.infer<typeof TaskLeaseSchema>

export const TaskNodeSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().default(""),
  state: TaskLifecycleStateSchema,
  scope: TaskScopeSchema,
  container_id: z.string().min(1),
  owner: z.string().optional(),
  priority: z.number().default(0),
  depends_on: z.array(z.string()).default([]),
  metadata: z.record(z.string(), z.unknown()).optional(),
  revision: z.number().int().min(1),
  lease: TaskLeaseSchema.optional(),
  created_at: z.number(),
  updated_at: z.number(),
})
export type TaskNode = z.infer<typeof TaskNodeSchema>

export interface TaskReadinessResult {
  readiness: TaskReadiness
  blocked_by_unresolved: string[]
}

export const TASK_ERROR_CODES = {
  task_not_found: "TASK_NOT_FOUND",
  revision_conflict: "TASK_REVISION_CONFLICT",
  invalid_transition: "TASK_INVALID_TRANSITION",
  transition_blocked: "TASK_TRANSITION_BLOCKED",
  invalid_input: "TASK_INVALID_INPUT",
  dependency_cycle: "TASK_DEPENDENCY_CYCLE",
  dependency_not_found: "TASK_DEPENDENCY_NOT_FOUND",
  invalid_dependency: "TASK_INVALID_DEPENDENCY",
} as const

export type TaskErrorCode = typeof TASK_ERROR_CODES[keyof typeof TASK_ERROR_CODES]

export class TaskSystemError extends Error {
  code: TaskErrorCode
  details?: Record<string, unknown>

  constructor(code: TaskErrorCode, message: string, details?: Record<string, unknown>) {
    super(message)
    this.name = "TaskSystemError"
    this.code = code
    this.details = details
  }
}

const ALLOWED_TRANSITIONS: Record<TaskLifecycleState, TaskLifecycleState[]> = {
  open: ["in_progress", "completed", "cancelled", "failed"],
  in_progress: ["open", "completed", "cancelled", "failed"],
  failed: ["open", "cancelled"],
  completed: [],
  cancelled: [],
}

export function canTransitionTaskState(
  currentState: TaskLifecycleState,
  nextState: TaskLifecycleState
): boolean {
  if (currentState === nextState) {
    return true
  }
  return ALLOWED_TRANSITIONS[currentState].includes(nextState)
}

function isDependencyResolved(state: TaskLifecycleState | undefined): boolean {
  return state === "completed"
}

export function deriveTaskReadiness(
  task: Pick<TaskNode, "depends_on">,
  resolveDependencyState: (taskId: string) => TaskLifecycleState | undefined
): TaskReadinessResult {
  const unresolvedDependencyIds: string[] = []

  for (const dependencyId of task.depends_on) {
    const dependencyState = resolveDependencyState(dependencyId)
    if (!isDependencyResolved(dependencyState)) {
      unresolvedDependencyIds.push(dependencyId)
    }
  }

  return {
    readiness: unresolvedDependencyIds.length === 0 ? "ready" : "blocked",
    blocked_by_unresolved: unresolvedDependencyIds,
  }
}

export function wouldCreateDependencyCycle(
  taskId: string,
  nextDependsOn: string[],
  resolveDependencies: (id: string) => string[]
): boolean {
  const seen = new Set<string>()

  const visit = (currentId: string): boolean => {
    if (currentId === taskId) {
      return true
    }
    if (seen.has(currentId)) {
      return false
    }

    seen.add(currentId)
    const dependencies = resolveDependencies(currentId)

    for (const dependencyId of dependencies) {
      if (visit(dependencyId)) {
        return true
      }
    }

    return false
  }

  for (const dependencyId of nextDependsOn) {
    if (visit(dependencyId)) {
      return true
    }
  }

  return false
}

export interface TaskSummary {
  id: string
  title: string
  description: string
  state: TaskLifecycleState
  readiness: TaskReadiness
  blocked_by_unresolved: string[]
  scope: TaskScope
  container_id: string
  owner?: string
  priority: number
  depends_on: string[]
  revision: number
  created_at: number
  updated_at: number
}

export function toTaskSummary(
  task: TaskNode,
  resolveDependencyState: (taskId: string) => TaskLifecycleState | undefined
): TaskSummary {
  const readiness = deriveTaskReadiness(task, resolveDependencyState)

  return {
    id: task.id,
    title: task.title,
    description: task.description,
    state: task.state,
    readiness: readiness.readiness,
    blocked_by_unresolved: readiness.blocked_by_unresolved,
    scope: task.scope,
    container_id: task.container_id,
    owner: task.owner,
    priority: task.priority,
    depends_on: [...task.depends_on],
    revision: task.revision,
    created_at: task.created_at,
    updated_at: task.updated_at,
  }
}
