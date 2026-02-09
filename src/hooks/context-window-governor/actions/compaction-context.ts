import { createSystemDirective, SystemDirectiveTypes } from "../../../shared/system-directive"
import type { OhMyOpenCodeConfig } from "../../../config"
import { listIncompleteTasks, listTaskNodes, type TaskSummary } from "../../../features/task-system"
import { resolveActiveTaskSelector } from "../../../features/work-state"
import { pushBudgetedContext } from "../../../features/context-budget"

const COMPACTION_CONTEXT_PROMPT = `${createSystemDirective(SystemDirectiveTypes.COMPACTION_CONTEXT)}

When summarizing this session, you MUST include:

1. User Requests (As-Is)
2. Final Goal
3. Files Modified (with details)
4. Key Decisions & Rationale
5. Current Working State
6. Environment & Tool Outputs Still Needed
7. Remaining Tasks
8. MUST NOT Do (Critical Constraints)
9. Important Context
10. Agent Verification State

This structured context is CRITICAL for continuity after compaction.`

const MAX_INCOMPLETE_TASK_LINES = 12
const MAX_TASK_TITLE_LENGTH = 120
const MAX_BLOCKED_DEPENDENCIES = 3

type TaskConfigSubset = Partial<Pick<OhMyOpenCodeConfig, "sisyphus">>

export interface TaskGraphCompactionContextOptions {
  sessionID: string
  directory: string
  taskConfig?: TaskConfigSubset
}

interface InjectCompactionContextOptions extends Partial<TaskGraphCompactionContextOptions> {}

function truncateText(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value
  }
  return `${value.slice(0, Math.max(0, maxChars - 3))}...`
}

function taskSortRank(task: TaskSummary): number {
  if (task.state === "in_progress") {
    return 0
  }
  if (task.state === "open" && task.readiness === "ready") {
    return 1
  }
  if (task.state === "open" && task.readiness === "blocked") {
    return 2
  }
  if (task.state === "failed") {
    return 3
  }
  return 4
}

function compareTasksForSnapshot(a: TaskSummary, b: TaskSummary): number {
  const rankDiff = taskSortRank(a) - taskSortRank(b)
  if (rankDiff !== 0) {
    return rankDiff
  }

  if (a.priority !== b.priority) {
    return b.priority - a.priority
  }

  if (a.updated_at !== b.updated_at) {
    return b.updated_at - a.updated_at
  }

  return a.id.localeCompare(b.id)
}

function formatTaskLine(task: TaskSummary): string {
  const blocked = task.blocked_by_unresolved.slice(0, MAX_BLOCKED_DEPENDENCIES)
  const blockedSuffix = blocked.length > 0
    ? `, blocked_by=${blocked.join("|")}${task.blocked_by_unresolved.length > blocked.length ? "+more" : ""}`
    : ""
  const ownerSuffix = task.owner ? `, owner=${task.owner}` : ""
  return `- ${task.id} [${task.state}/${task.readiness}, p${task.priority}${ownerSuffix}${blockedSuffix}] ${truncateText(task.title, MAX_TASK_TITLE_LENGTH)}`
}

export function buildTaskGraphCompactionContext(
  options: TaskGraphCompactionContextOptions
): string | null {
  const { sessionID, directory, taskConfig } = options
  if (!sessionID || !directory) {
    return null
  }

  try {
    const selectorInfo = resolveActiveTaskSelector(directory, sessionID)
    const config = taskConfig ?? {}
    const allTasks = listTaskNodes(
      {
        ...selectorInfo.selector,
        include_completed: true,
      },
      config
    )

    if (allTasks.length === 0) {
      return null
    }

    const incompleteTasks = listIncompleteTasks(selectorInfo.selector, config).sort(compareTasksForSnapshot)
    const inProgressCount = incompleteTasks.filter((task) => task.state === "in_progress").length
    const readyCount = incompleteTasks.filter((task) => task.readiness === "ready").length
    const blockedCount = incompleteTasks.filter((task) => task.readiness === "blocked").length

    const lines: string[] = [
      "[TaskGraph Snapshot]",
      `selector: source=${selectorInfo.source}, scope=${selectorInfo.selector.scope}, container_id=${selectorInfo.selector.container_id}`,
      `totals: total=${allTasks.length}, incomplete=${incompleteTasks.length}, in_progress=${inProgressCount}, ready=${readyCount}, blocked=${blockedCount}`,
    ]

    if (incompleteTasks.length === 0) {
      lines.push("all tasks were completed or cancelled at compaction time.")
      return lines.join("\n")
    }

    lines.push("incomplete tasks:")
    for (const task of incompleteTasks.slice(0, MAX_INCOMPLETE_TASK_LINES)) {
      lines.push(formatTaskLine(task))
    }

    if (incompleteTasks.length > MAX_INCOMPLETE_TASK_LINES) {
      lines.push(`... ${incompleteTasks.length - MAX_INCOMPLETE_TASK_LINES} more incomplete tasks omitted`)
    }

    return lines.join("\n")
  } catch {
    return null
  }
}

export function getCompactionContextPrompt(): string {
  return COMPACTION_CONTEXT_PROMPT
}

export function injectCompactionContext(
  output?: { context: string[] },
  options?: InjectCompactionContextOptions
): void {
  if (!output || !Array.isArray(output.context)) {
    return
  }
  if (!options?.sessionID) {
    return
  }
  pushBudgetedContext({
    output,
    sessionID: options.sessionID,
    source: "context-window-governor:compaction-context",
    id: "compaction-context-prompt",
    priority: "high",
    content: COMPACTION_CONTEXT_PROMPT,
  })

  if (!options.directory) {
    return
  }

  const taskSnapshot = buildTaskGraphCompactionContext({
    sessionID: options.sessionID,
    directory: options.directory,
    taskConfig: options.taskConfig,
  })
  if (taskSnapshot) {
    pushBudgetedContext({
      output,
      sessionID: options.sessionID,
      source: "context-window-governor:compaction-context",
      id: "compaction-context-task-snapshot",
      priority: "high",
      content: taskSnapshot,
    })
  }
}
