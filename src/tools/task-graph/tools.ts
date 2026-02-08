import type { ToolDefinition } from "@opencode-ai/plugin"
import { tool } from "@opencode-ai/plugin/tool"
import type { OhMyOpenCodeConfig } from "../../config/schema"
import {
  TaskScopeSchema,
  TaskSystemError,
  TASK_ERROR_CODES,
  type TaskScope,
} from "../../features/task-system"
import {
  createTaskNode,
  getTaskSummary,
  listTaskNodes,
  transitionTaskNode,
  updateTaskNode,
} from "../../features/task-system"

interface ToolContext {
  sessionID: string
}

function resolveScope(value: unknown): TaskScope {
  if (typeof value !== "string") {
    return "session"
  }

  const parsed = TaskScopeSchema.safeParse(value)
  return parsed.success ? parsed.data : "session"
}

function resolveContainerId(
  scope: TaskScope,
  containerId: unknown,
  context: ToolContext
): string {
  if (typeof containerId === "string" && containerId.trim().length > 0) {
    return containerId.trim()
  }

  if (scope === "session") {
    return context.sessionID
  }

  throw new TaskSystemError(
    TASK_ERROR_CODES.invalid_input,
    `container_id is required for scope ${scope}`,
    { scope }
  )
}

function toToolError(error: unknown): string {
  if (error instanceof TaskSystemError) {
    return JSON.stringify({
      error: error.code,
      message: error.message,
      details: error.details,
    })
  }

  if (error instanceof Error) {
    return JSON.stringify({
      error: "TASK_INTERNAL_ERROR",
      message: error.message,
    })
  }

  return JSON.stringify({
    error: "TASK_INTERNAL_ERROR",
    message: String(error),
  })
}

export function createTaskCreateTool(
  config: Partial<OhMyOpenCodeConfig>
): ToolDefinition {
  return tool({
    description: "Create a task node in TaskGraph V2.",
    args: {
      title: tool.schema.string().describe("Task title"),
      description: tool.schema.string().optional().describe("Task description"),
      scope: tool.schema.enum(["session", "plan", "swarm"]).optional().describe("Task scope (default: session)"),
      container_id: tool.schema.string().optional().describe("Container id (sessionID/planID/teamName)"),
      owner: tool.schema.string().optional().describe("Task owner"),
      priority: tool.schema.number().optional().describe("Task priority (higher is more important)"),
      depends_on: tool.schema.array(tool.schema.string()).optional().describe("Dependency task IDs"),
      metadata: tool.schema.record(tool.schema.string(), tool.schema.unknown()).optional().describe("Metadata object"),
    },
    execute: async (args, context) => {
      try {
        const scope = resolveScope(args.scope)
        const containerId = resolveContainerId(scope, args.container_id, context as ToolContext)

        const task = createTaskNode(
          {
            scope,
            container_id: containerId,
            title: args.title as string,
            description: args.description as string | undefined,
            owner: args.owner as string | undefined,
            priority: args.priority as number | undefined,
            depends_on: args.depends_on as string[] | undefined,
            metadata: args.metadata as Record<string, unknown> | undefined,
          },
          config
        )

        const summary = getTaskSummary(
          {
            scope,
            container_id: containerId,
            id: task.id,
          },
          config
        )

        return JSON.stringify({
          task: summary ?? task,
        })
      } catch (error) {
        return toToolError(error)
      }
    },
  })
}

export function createTaskGetTool(
  config: Partial<OhMyOpenCodeConfig>
): ToolDefinition {
  return tool({
    description: "Get a task node from TaskGraph V2.",
    args: {
      id: tool.schema.string().describe("Task ID"),
      scope: tool.schema.enum(["session", "plan", "swarm"]).optional().describe("Task scope (default: session)"),
      container_id: tool.schema.string().optional().describe("Container id (sessionID/planID/teamName)"),
    },
    execute: async (args, context) => {
      try {
        const scope = resolveScope(args.scope)
        const containerId = resolveContainerId(scope, args.container_id, context as ToolContext)
        const task = getTaskSummary({
          scope,
          container_id: containerId,
          id: args.id as string,
        }, config)

        return JSON.stringify({ task })
      } catch (error) {
        return toToolError(error)
      }
    },
  })
}

export function createTaskListTool(
  config: Partial<OhMyOpenCodeConfig>
): ToolDefinition {
  return tool({
    description: "List task summaries from TaskGraph V2.",
    args: {
      scope: tool.schema.enum(["session", "plan", "swarm"]).optional().describe("Task scope (default: session)"),
      container_id: tool.schema.string().optional().describe("Container id (sessionID/planID/teamName)"),
      ready_only: tool.schema.boolean().optional().describe("Only list ready tasks"),
      include_completed: tool.schema.boolean().optional().describe("Include completed/cancelled tasks (default: false)"),
      state: tool.schema.enum(["open", "in_progress", "completed", "cancelled", "failed"]).optional().describe("Filter by lifecycle state"),
    },
    execute: async (args, context) => {
      try {
        const scope = resolveScope(args.scope)
        const containerId = resolveContainerId(scope, args.container_id, context as ToolContext)

        const tasks = listTaskNodes(
          {
            scope,
            container_id: containerId,
            ready_only: args.ready_only as boolean | undefined,
            include_completed: args.include_completed as boolean | undefined,
            state: args.state as
              | "open"
              | "in_progress"
              | "completed"
              | "cancelled"
              | "failed"
              | undefined,
          },
          config
        )

        return JSON.stringify({ tasks })
      } catch (error) {
        return toToolError(error)
      }
    },
  })
}

export function createTaskUpdateTool(
  config: Partial<OhMyOpenCodeConfig>
): ToolDefinition {
  return tool({
    description: "Update structural fields of a task node. State changes are forbidden here.",
    args: {
      id: tool.schema.string().describe("Task ID"),
      expected_revision: tool.schema.number().describe("Expected current revision"),
      scope: tool.schema.enum(["session", "plan", "swarm"]).optional().describe("Task scope (default: session)"),
      container_id: tool.schema.string().optional().describe("Container id (sessionID/planID/teamName)"),
      title: tool.schema.string().optional().describe("Task title"),
      description: tool.schema.string().optional().describe("Task description"),
      owner: tool.schema.string().optional().describe("Task owner"),
      priority: tool.schema.number().optional().describe("Task priority"),
      add_depends_on: tool.schema.array(tool.schema.string()).optional().describe("Dependencies to add"),
      remove_depends_on: tool.schema.array(tool.schema.string()).optional().describe("Dependencies to remove"),
      metadata: tool.schema.record(tool.schema.string(), tool.schema.unknown()).optional().describe("Metadata patch (null to delete key)"),
    },
    execute: async (args, context) => {
      try {
        const scope = resolveScope(args.scope)
        const containerId = resolveContainerId(scope, args.container_id, context as ToolContext)

        const task = updateTaskNode(
          {
            scope,
            container_id: containerId,
            id: args.id as string,
            expected_revision: args.expected_revision as number,
            title: args.title as string | undefined,
            description: args.description as string | undefined,
            owner: args.owner as string | undefined,
            priority: args.priority as number | undefined,
            add_depends_on: args.add_depends_on as string[] | undefined,
            remove_depends_on: args.remove_depends_on as string[] | undefined,
            metadata: args.metadata as Record<string, unknown> | undefined,
          },
          config
        )

        const summary = getTaskSummary(
          { scope, container_id: containerId, id: task.id },
          config
        )

        return JSON.stringify({ task: summary ?? task })
      } catch (error) {
        return toToolError(error)
      }
    },
  })
}

export function createTaskTransitionTool(
  config: Partial<OhMyOpenCodeConfig>
): ToolDefinition {
  return tool({
    description: "Transition task lifecycle state with state machine and revision checks.",
    args: {
      id: tool.schema.string().describe("Task ID"),
      expected_revision: tool.schema.number().describe("Expected current revision"),
      next_state: tool.schema
        .enum(["open", "in_progress", "completed", "cancelled", "failed"])
        .describe("Target lifecycle state"),
      scope: tool.schema.enum(["session", "plan", "swarm"]).optional().describe("Task scope (default: session)"),
      container_id: tool.schema.string().optional().describe("Container id (sessionID/planID/teamName)"),
    },
    execute: async (args, context) => {
      try {
        const scope = resolveScope(args.scope)
        const containerId = resolveContainerId(scope, args.container_id, context as ToolContext)

        const task = transitionTaskNode(
          {
            scope,
            container_id: containerId,
            id: args.id as string,
            expected_revision: args.expected_revision as number,
            next_state: args.next_state as
              | "open"
              | "in_progress"
              | "completed"
              | "cancelled"
              | "failed",
          },
          config
        )

        const summary = getTaskSummary(
          { scope, container_id: containerId, id: task.id },
          config
        )

        return JSON.stringify({ task: summary ?? task })
      } catch (error) {
        return toToolError(error)
      }
    },
  })
}
