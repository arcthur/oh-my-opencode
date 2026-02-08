import type { TaskContainerSelector } from "../task-system"
import { createWorkStateManager } from "./manager"

export type ActiveTaskSelectorSource = "plan" | "session"

export interface ActiveTaskSelectorResult {
  source: ActiveTaskSelectorSource
  selector: TaskContainerSelector
  plan_id?: string
}

export function resolveActiveTaskSelector(
  directory: string,
  sessionID: string
): ActiveTaskSelectorResult {
  const workState = createWorkStateManager(directory).load()
  if (workState?.plan_id && workState.session_ids.includes(sessionID)) {
    return {
      source: "plan",
      plan_id: workState.plan_id,
      selector: {
        scope: "plan",
        container_id: workState.plan_id,
      },
    }
  }

  return {
    source: "session",
    selector: {
      scope: "session",
      container_id: sessionID,
    },
  }
}

