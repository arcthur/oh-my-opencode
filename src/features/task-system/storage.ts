import { randomUUID } from "node:crypto"
import { existsSync, readdirSync, unlinkSync } from "node:fs"
import { isAbsolute, join } from "node:path"
import type { OhMyOpenCodeConfig } from "../../config/schema"
import { ensureDir, getProjectRoot, readJsonSafe, writeJsonAtomic } from "../orchestrator-tasks/storage"
import { withLockSync } from "../orchestrator-swarm/sync/semaphore"
import { TaskNodeSchema, type TaskNode, type TaskScope } from "./domain"

const GRAPH_LOCK_RESOURCE = "__graph__"

export function sanitizeTaskPathSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "-") || "default"
}

export function getTaskGraphRoot(config: Partial<OhMyOpenCodeConfig>): string {
  const storagePath = config.orchestrator?.tasks?.storage_path ?? ".orchestrator/tasks"
  if (isAbsolute(storagePath)) {
    return storagePath
  }
  return join(getProjectRoot(), storagePath)
}

export function getTaskGraphDir(
  scope: TaskScope,
  containerId: string,
  config: Partial<OhMyOpenCodeConfig>
): string {
  const root = getTaskGraphRoot(config)
  return join(root, scope, sanitizeTaskPathSegment(containerId))
}

export function getTaskNodePath(
  scope: TaskScope,
  containerId: string,
  taskId: string,
  config: Partial<OhMyOpenCodeConfig>
): string {
  return join(getTaskGraphDir(scope, containerId, config), `${taskId}.json`)
}

export function ensureTaskGraphDir(
  scope: TaskScope,
  containerId: string,
  config: Partial<OhMyOpenCodeConfig>
): void {
  ensureDir(getTaskGraphDir(scope, containerId, config))
}

export function listTaskNodeIds(
  scope: TaskScope,
  containerId: string,
  config: Partial<OhMyOpenCodeConfig>
): string[] {
  const graphDir = getTaskGraphDir(scope, containerId, config)
  if (!existsSync(graphDir)) {
    return []
  }

  return readdirSync(graphDir)
    .filter((entry) => entry.endsWith(".json") && entry !== `${GRAPH_LOCK_RESOURCE}.json`)
    .map((entry) => entry.replace(/\.json$/, ""))
    .sort()
}

export function readTaskNode(
  scope: TaskScope,
  containerId: string,
  taskId: string,
  config: Partial<OhMyOpenCodeConfig>
): TaskNode | null {
  const filePath = getTaskNodePath(scope, containerId, taskId, config)
  return readJsonSafe(filePath, TaskNodeSchema)
}

export function readAllTaskNodes(
  scope: TaskScope,
  containerId: string,
  config: Partial<OhMyOpenCodeConfig>
): TaskNode[] {
  const ids = listTaskNodeIds(scope, containerId, config)
  const tasks: TaskNode[] = []

  for (const id of ids) {
    const task = readTaskNode(scope, containerId, id, config)
    if (task) {
      tasks.push(task)
    }
  }

  return tasks
}

export function writeTaskNode(
  task: TaskNode,
  config: Partial<OhMyOpenCodeConfig>
): void {
  const filePath = getTaskNodePath(task.scope, task.container_id, task.id, config)
  writeJsonAtomic(filePath, task)
}

export function deleteTaskNode(
  scope: TaskScope,
  containerId: string,
  taskId: string,
  config: Partial<OhMyOpenCodeConfig>
): boolean {
  const filePath = getTaskNodePath(scope, containerId, taskId, config)
  if (!existsSync(filePath)) {
    return false
  }

  unlinkSync(filePath)
  return true
}

export function withTaskGraphLock<T>(
  scope: TaskScope,
  containerId: string,
  config: Partial<OhMyOpenCodeConfig>,
  fn: () => T
): T {
  ensureTaskGraphDir(scope, containerId, config)
  const resourcePath = join(getTaskGraphDir(scope, containerId, config), GRAPH_LOCK_RESOURCE)
  return withLockSync(resourcePath, fn)
}

export function generateTaskNodeId(): string {
  return `task_${randomUUID().slice(0, 8)}`
}
