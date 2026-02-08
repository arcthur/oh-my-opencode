import type { OhMyOpenCodeConfig } from "../../config/schema"
import type { TaskLifecycleState, TaskSummary } from "./domain"
import { getTaskNode, listTaskNodes, type TaskContainerSelector } from "./service"

function isIncompleteState(state: TaskLifecycleState): boolean {
  return state !== "completed" && state !== "cancelled"
}

export function listReadyTasks(
  selector: TaskContainerSelector,
  config: Partial<OhMyOpenCodeConfig>
): TaskSummary[] {
  return listTaskNodes({
    ...selector,
    ready_only: true,
    include_completed: false,
  }, config)
}

export function listIncompleteTasks(
  selector: TaskContainerSelector,
  config: Partial<OhMyOpenCodeConfig>
): TaskSummary[] {
  return listTaskNodes({
    ...selector,
    include_completed: true,
  }, config).filter((task) => isIncompleteState(task.state))
}

export function countIncompleteTasks(
  selector: TaskContainerSelector,
  config: Partial<OhMyOpenCodeConfig>
): number {
  return listIncompleteTasks(selector, config).length
}

export function hasIncompleteTasks(
  selector: TaskContainerSelector,
  config: Partial<OhMyOpenCodeConfig>
): boolean {
  return countIncompleteTasks(selector, config) > 0
}

export function getTaskSummary(
  selector: TaskContainerSelector & { id: string },
  config: Partial<OhMyOpenCodeConfig>
): TaskSummary | null {
  const node = getTaskNode(selector, config)
  if (!node) {
    return null
  }

  const all = listTaskNodes({
    scope: selector.scope,
    container_id: selector.container_id,
    include_completed: true,
  }, config)

  return all.find((task) => task.id === selector.id) ?? null
}

export function listSessionTasks(
  sessionId: string,
  config: Partial<OhMyOpenCodeConfig>
): TaskSummary[] {
  return listTaskNodes(
    {
      scope: "session",
      container_id: sessionId,
      include_completed: true,
    },
    config
  )
}

export function listIncompleteSessionTasks(
  sessionId: string,
  config: Partial<OhMyOpenCodeConfig>
): TaskSummary[] {
  return listIncompleteTasks(
    {
      scope: "session",
      container_id: sessionId,
    },
    config
  )
}

export function countIncompleteSessionTasks(
  sessionId: string,
  config: Partial<OhMyOpenCodeConfig>
): number {
  return countIncompleteTasks(
    {
      scope: "session",
      container_id: sessionId,
    },
    config
  )
}

export function hasIncompleteSessionTasks(
  sessionId: string,
  config: Partial<OhMyOpenCodeConfig>
): boolean {
  return hasIncompleteTasks(
    {
      scope: "session",
      container_id: sessionId,
    },
    config
  )
}
