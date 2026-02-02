import { existsSync, readdirSync, unlinkSync } from "fs"
import { join } from "path"
import { randomUUID } from "crypto"
import type { OhMyOpenCodeConfig } from "../../../config/schema"
import { getTaskDir, getTaskPath, ensureDir, writeJsonAtomic, readJsonSafe } from "../../sisyphus-tasks/storage"
import { TaskSchema, type Task, type TaskCreateInput, type TaskUpdateInput } from "../../sisyphus-tasks/types"
import { withLockSync } from "../sync/semaphore"
import type { SwarmTask, TaskPoolStats, TaskFilterOptions } from "./types"

/**
 * Generate a unique task ID
 */
export function generateTaskId(): string {
  return `task_${randomUUID().slice(0, 8)}`
}

/**
 * Get all task IDs in a list
 */
export function listTaskIds(
  listId: string,
  config: Partial<OhMyOpenCodeConfig>
): string[] {
  const taskDir = getTaskDir(listId, config)

  if (!existsSync(taskDir)) {
    return []
  }

  return readdirSync(taskDir)
    .filter(f => f.endsWith(".json"))
    .map(f => f.replace(".json", ""))
}

/**
 * Read a single task
 */
export function readTask(
  listId: string,
  taskId: string,
  config: Partial<OhMyOpenCodeConfig>
): Task | null {
  const taskPath = getTaskPath(listId, taskId, config)
  return readJsonSafe(taskPath, TaskSchema)
}

/**
 * Read all tasks in a list
 */
export function readAllTasks(
  listId: string,
  config: Partial<OhMyOpenCodeConfig>
): Task[] {
  const taskIds = listTaskIds(listId, config)
  const tasks: Task[] = []

  for (const taskId of taskIds) {
    const task = readTask(listId, taskId, config)
    if (task) {
      tasks.push(task)
    }
  }

  return tasks
}

/**
 * Create a new task
 */
export function createTask(
  listId: string,
  input: TaskCreateInput,
  config: Partial<OhMyOpenCodeConfig>
): Task {
  const taskId = generateTaskId()
  const taskDir = getTaskDir(listId, config)
  ensureDir(taskDir)

  const task: Task = {
    id: taskId,
    subject: input.subject,
    description: input.description,
    activeForm: input.activeForm,
    status: "pending",
    blocks: [],
    blockedBy: [],
    metadata: input.metadata,
  }

  const taskPath = getTaskPath(listId, taskId, config)
  writeJsonAtomic(taskPath, task)

  return task
}

/**
 * Update a task
 */
export function updateTask(
  listId: string,
  input: TaskUpdateInput,
  config: Partial<OhMyOpenCodeConfig>
): Task | null {
  const taskPath = getTaskPath(listId, input.taskId, config)

  return withLockSync(taskPath, () => {
    const task = readTask(listId, input.taskId, config)
    if (!task) {
      return null
    }

    // Apply updates
    if (input.subject !== undefined) task.subject = input.subject
    if (input.description !== undefined) task.description = input.description
    if (input.activeForm !== undefined) task.activeForm = input.activeForm
    if (input.status !== undefined) {
      if (input.status === "deleted") {
        deleteTask(listId, input.taskId, config)
        return null
      }
      task.status = input.status
    }
    if (input.owner !== undefined) task.owner = input.owner
    if (input.metadata !== undefined) {
      task.metadata = { ...task.metadata, ...input.metadata }
      // Remove null values
      for (const key of Object.keys(task.metadata)) {
        if (task.metadata[key] === null) {
          delete task.metadata[key]
        }
      }
    }

    // Handle dependency updates
    if (input.addBlocks) {
      task.blocks = [...new Set([...task.blocks, ...input.addBlocks])]
    }
    if (input.addBlockedBy) {
      // Check for potential cycles before adding dependencies
      for (const blockerId of input.addBlockedBy) {
        if (wouldCreateCycle(listId, input.taskId, blockerId, config)) {
          throw new Error(
            `Cannot add dependency: ${input.taskId} blocked by ${blockerId} would create a cycle`
          )
        }
      }
      task.blockedBy = [...new Set([...task.blockedBy, ...input.addBlockedBy])]
    }

    writeJsonAtomic(taskPath, task)

    return task
  })
}

/**
 * Delete a task
 */
export function deleteTask(
  listId: string,
  taskId: string,
  config: Partial<OhMyOpenCodeConfig>
): boolean {
  const taskPath = getTaskPath(listId, taskId, config)

  if (!existsSync(taskPath)) {
    return false
  }

  unlinkSync(taskPath)
  return true
}

/**
 * Check if a task is blocked
 */
export function isTaskBlocked(
  listId: string,
  taskId: string,
  config: Partial<OhMyOpenCodeConfig>
): boolean {
  const task = readTask(listId, taskId, config)
  if (!task || task.blockedBy.length === 0) {
    return false
  }

  // Check if all blocking tasks are completed
  for (const blockerId of task.blockedBy) {
    const blocker = readTask(listId, blockerId, config)
    if (blocker && blocker.status !== "completed") {
      return true
    }
  }

  return false
}

/**
 * Detect circular dependencies in task blockedBy relationships
 *
 * Uses DFS to find cycles. Returns the cycle path if found, null otherwise.
 *
 * @param listId Task list ID
 * @param taskId Starting task ID to check
 * @param config OpenCode config
 * @returns Array of task IDs forming the cycle, or null if no cycle
 *
 * @example
 * // If task A blocks B, B blocks C, C blocks A:
 * detectCycle(listId, "A", config) // returns ["A", "B", "C", "A"]
 */
export function detectCycle(
  listId: string,
  taskId: string,
  config: Partial<OhMyOpenCodeConfig>
): string[] | null {
  const visited = new Set<string>()
  const path: string[] = []

  function dfs(currentId: string): boolean {
    // If we've seen this task in the current path, we found a cycle
    const pathIndex = path.indexOf(currentId)
    if (pathIndex !== -1) {
      // Return the cycle portion of the path
      path.push(currentId)
      return true
    }

    // If already fully explored, no cycle through this node
    if (visited.has(currentId)) {
      return false
    }

    path.push(currentId)

    const task = readTask(listId, currentId, config)
    if (task) {
      for (const blockerId of task.blockedBy) {
        if (dfs(blockerId)) {
          return true
        }
      }
    }

    path.pop()
    visited.add(currentId)
    return false
  }

  if (dfs(taskId)) {
    // Extract just the cycle portion
    const cycleStart = path.indexOf(path[path.length - 1])
    return path.slice(cycleStart)
  }

  return null
}

/**
 * Calculate the dependency depth of a task
 *
 * The depth is the maximum number of transitive blockedBy relationships.
 * A task with no dependencies has depth 0.
 * A task blocked by one task with depth 0 has depth 1, etc.
 *
 * Used for task prioritization: shallower tasks (lower depth) should be
 * done first as they unblock other work sooner.
 *
 * @param listId Task list ID
 * @param taskId Task to calculate depth for
 * @param config OpenCode config
 * @param memo Memoization map to avoid recalculating
 * @returns The dependency depth (0 = no dependencies)
 */
export function dependencyDepth(
  listId: string,
  taskId: string,
  config: Partial<OhMyOpenCodeConfig>,
  memo: Map<string, number> = new Map()
): number {
  if (memo.has(taskId)) return memo.get(taskId)!

  const task = readTask(listId, taskId, config)
  if (!task || task.blockedBy.length === 0) {
    memo.set(taskId, 0)
    return 0
  }

  let maxBlockerDepth = 0
  for (const blockerId of task.blockedBy) {
    const blockerDepth = dependencyDepth(listId, blockerId, config, memo)
    maxBlockerDepth = Math.max(maxBlockerDepth, blockerDepth)
  }

  const depth = maxBlockerDepth + 1
  memo.set(taskId, depth)
  return depth
}

/**
 * Check if adding a dependency would create a cycle
 *
 * @param listId Task list ID
 * @param taskId Task that would be blocked
 * @param blockerId Task that would block it
 * @param config OpenCode config
 * @returns true if adding this dependency would create a cycle
 */
export function wouldCreateCycle(
  listId: string,
  taskId: string,
  blockerId: string,
  config: Partial<OhMyOpenCodeConfig>
): boolean {
  // Adding taskId -> blockedBy: [blockerId] would create a cycle if
  // blockerId is already (transitively) blocked by taskId
  const visited = new Set<string>()

  function canReach(fromId: string, targetId: string): boolean {
    if (fromId === targetId) {
      return true
    }

    if (visited.has(fromId)) {
      return false
    }

    visited.add(fromId)

    const task = readTask(listId, fromId, config)
    if (!task) {
      return false
    }

    for (const depId of task.blockedBy) {
      if (canReach(depId, targetId)) {
        return true
      }
    }

    return false
  }

  // If blockerId can reach taskId through blockedBy chain,
  // then adding taskId.blockedBy = blockerId would create a cycle
  return canReach(blockerId, taskId)
}

/**
 * Get tasks filtered by options
 */
export function filterTasks(
  listId: string,
  options: TaskFilterOptions,
  config: Partial<OhMyOpenCodeConfig>
): Task[] {
  let tasks = readAllTasks(listId, config)

  if (options.status !== undefined) {
    tasks = tasks.filter(t => t.status === options.status)
  }

  if (options.owner !== undefined) {
    tasks = tasks.filter(t => t.owner === options.owner)
  }

  if (options.excludeBlocked) {
    tasks = tasks.filter(t => !isTaskBlocked(listId, t.id, config))
  }

  if (options.minPriority !== undefined) {
    tasks = tasks.filter(t => {
      const priority = (t.metadata?.priority as number) ?? 0
      return priority >= options.minPriority!
    })
  }

  if (options.hasCapability && options.hasCapability.length > 0) {
    tasks = tasks.filter(t => {
      const required = (t.metadata?.requiredCapabilities as string[]) ?? []
      if (required.length === 0) return true
      return required.every(cap => options.hasCapability!.includes(cap))
    })
  }

  return tasks
}

/**
 * Get pending tasks that are ready to work on (not blocked)
 */
export function getReadyTasks(
  listId: string,
  config: Partial<OhMyOpenCodeConfig>
): Task[] {
  return filterTasks(listId, {
    status: "pending",
    excludeBlocked: true,
  }, config)
}

/**
 * Get task pool statistics
 */
export function getPoolStats(
  listId: string,
  config: Partial<OhMyOpenCodeConfig>
): TaskPoolStats {
  const tasks = readAllTasks(listId, config)

  let blocked = 0
  for (const task of tasks) {
    if (task.status === "pending" && isTaskBlocked(listId, task.id, config)) {
      blocked++
    }
  }

  return {
    total: tasks.length,
    pending: tasks.filter(t => t.status === "pending").length,
    inProgress: tasks.filter(t => t.status === "in_progress").length,
    completed: tasks.filter(t => t.status === "completed").length,
    blocked,
  }
}

/**
 * Assign a task to an agent
 *
 * Uses file locking to prevent race conditions when multiple
 * coordinators try to assign the same task.
 */
export function assignTask(
  listId: string,
  taskId: string,
  agentId: string,
  config: Partial<OhMyOpenCodeConfig>
): Task | null {
  const taskPath = getTaskPath(listId, taskId, config)

  return withLockSync(taskPath, () => {
    const task = readTask(listId, taskId, config)
    if (!task) {
      return null
    }

    // Check if already assigned
    if (task.owner && task.status === "in_progress") {
      return null // Already assigned
    }

    // Update task
    task.status = "in_progress"
    task.owner = agentId

    // Track assignment history
    const history = (task.metadata?.assignmentHistory as Array<{
      agentId: string
      assignedAt: number
    }>) ?? []
    history.push({
      agentId,
      assignedAt: Date.now(),
    })
    task.metadata = { ...task.metadata, assignmentHistory: history }

    writeJsonAtomic(taskPath, task)

    return task
  })
}

/**
 * Mark a task as completed
 */
export function completeTask(
  listId: string,
  taskId: string,
  agentId: string,
  config: Partial<OhMyOpenCodeConfig>
): Task | null {
  const taskPath = getTaskPath(listId, taskId, config)

  return withLockSync(taskPath, () => {
    const task = readTask(listId, taskId, config)
    if (!task) {
      return null
    }

    // Only current owner can complete an in-progress task
    if (task.status !== "in_progress") {
      return null
    }
    if (task.owner && task.owner !== agentId) {
      return null
    }

    task.status = "completed"

    // Update assignment history
    const history = (task.metadata?.assignmentHistory as Array<{
      agentId: string
      assignedAt: number
      completedAt?: number
      result?: string
    }>) ?? []

    const lastAssignment = history[history.length - 1]
    if (lastAssignment && lastAssignment.agentId === agentId) {
      lastAssignment.completedAt = Date.now()
      lastAssignment.result = "completed"
    }

    task.metadata = { ...task.metadata, assignmentHistory: history }

    writeJsonAtomic(taskPath, task)

    return task
  })
}

/**
 * Reassign a task (e.g., when worker fails or becomes unresponsive)
 */
export function reassignTask(
  listId: string,
  taskId: string,
  reason: string,
  config: Partial<OhMyOpenCodeConfig>,
  options?: { expectedOwnerId?: string }
): Task | null {
  const taskPath = getTaskPath(listId, taskId, config)

  return withLockSync(taskPath, () => {
    const task = readTask(listId, taskId, config)
    if (!task) {
      return null
    }

    // If an expected owner is specified, do not clobber a task that was already moved
    if (options?.expectedOwnerId && task.owner && task.owner !== options.expectedOwnerId) {
      return null
    }

    // Mark previous assignment as reassigned
    const history = (task.metadata?.assignmentHistory as Array<{
      agentId: string
      assignedAt: number
      completedAt?: number
      result?: string
    }>) ?? []

    const lastAssignment = history[history.length - 1]
    if (lastAssignment) {
      lastAssignment.completedAt = Date.now()
      lastAssignment.result = "reassigned"
    }

    // Reset task state
    task.status = "pending"
    task.owner = undefined
    task.metadata = {
      ...task.metadata,
      assignmentHistory: history,
      lastReassignReason: reason,
    }

    writeJsonAtomic(taskPath, task)

    return task
  })
}

/**
 * Get tasks assigned to a specific agent
 */
export function getAgentTasks(
  listId: string,
  agentId: string,
  config: Partial<OhMyOpenCodeConfig>
): Task[] {
  return filterTasks(listId, { owner: agentId }, config)
}

/**
 * Get the next task for an agent based on strategy
 */
export function getNextTaskForAgent(
  listId: string,
  agentId: string,
  capabilities: string[],
  config: Partial<OhMyOpenCodeConfig>,
  strategy: "round-robin" | "capability-match" | "load-balance" = "capability-match"
): Task | null {
  const readyTasks = getReadyTasks(listId, config)

  if (readyTasks.length === 0) {
    return null
  }

  // Filter by capabilities
  const matchingTasks = readyTasks.filter(task => {
    const required = (task.metadata?.requiredCapabilities as string[]) ?? []
    if (required.length === 0) return true
    return required.every(cap => capabilities.includes(cap))
  })

  if (matchingTasks.length === 0) {
    return null
  }

  // Sort by: priority (higher first) → dependency depth (shallower first) → creation order
  const depthMemo = new Map<string, number>()
  matchingTasks.sort((a, b) => {
    // Priority first (higher = more important)
    const priorityA = (a.metadata?.priority as number) ?? 0
    const priorityB = (b.metadata?.priority as number) ?? 0
    if (priorityA !== priorityB) {
      return priorityB - priorityA
    }

    // Dependency depth second (shallower = fewer blockers = do first)
    const depthA = dependencyDepth(listId, a.id, config, depthMemo)
    const depthB = dependencyDepth(listId, b.id, config, depthMemo)
    if (depthA !== depthB) {
      return depthA - depthB
    }

    // Creation order last (use ID as proxy)
    return a.id.localeCompare(b.id)
  })

  return matchingTasks[0]
}
