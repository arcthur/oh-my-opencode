import type { ToolDefinition } from "@opencode-ai/plugin"
import type { OhMyOpenCodeConfig } from "../../config/schema"
import {
  createTaskCreateTool,
  createTaskGetTool,
  createTaskListTool,
  createTaskTransitionTool,
  createTaskUpdateTool,
} from "./tools"

export {
  createTaskCreateTool,
  createTaskGetTool,
  createTaskListTool,
  createTaskTransitionTool,
  createTaskUpdateTool,
} from "./tools"

export function createTaskGraphTools(
  config: Partial<OhMyOpenCodeConfig>
): Record<string, ToolDefinition> {
  return {
    task_create: createTaskCreateTool(config),
    task_get: createTaskGetTool(config),
    task_list: createTaskListTool(config),
    task_update: createTaskUpdateTool(config),
    task_transition: createTaskTransitionTool(config),
  }
}
