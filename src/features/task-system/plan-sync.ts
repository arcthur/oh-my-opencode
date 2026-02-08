import type { OhMyOpenCodeConfig } from "../../config/schema"
import { createTaskNode, updateTaskNode } from "./service"
import { readAllTaskNodes } from "./storage"
import { parsePlanTasksFromMarkdown } from "./plan-markdown"

export type SyncPlanTasksInput = {
  config: Partial<OhMyOpenCodeConfig>
  scope: "plan" | "swarm"
  container_id: string
  planId: string
  planMarkdown: string
}

export type SyncPlanTasksResult = {
  created: Array<{ task_number: number; task_id: string }>
  skipped: Array<{ task_number: number; reason: string }>
}

function buildTaskDescription(planId: string, planTaskKey: string, rawBlock: string): string {
  const parts = [
    `# Plan Task`,
    ``,
    `Plan ID: ${planId}`,
    `Plan Task Key: ${planTaskKey}`,
    ``,
    `## Source`,
    ``,
    rawBlock.trimEnd(),
  ].filter(Boolean)

  return parts.join("\n")
}

export function syncPlanTasksToTaskGraph(input: SyncPlanTasksInput): SyncPlanTasksResult {
  const { config, scope, container_id: containerId, planId, planMarkdown } = input
  const planTasks = parsePlanTasksFromMarkdown(planMarkdown)

  const existing = readAllTaskNodes(scope, containerId, config)
  const byPlanTaskKey = new Map<string, (typeof existing)[number]>()
  for (const task of existing) {
    const key = task.metadata?.planTaskKey
    if (typeof key === "string" && key.trim().length > 0) {
      byPlanTaskKey.set(key, task)
    }
  }

  const created: Array<{ task_number: number; task_id: string }> = []
  const skipped: Array<{ task_number: number; reason: string }> = []

  const numberToTaskId = new Map<number, string>()
  for (const task of existing) {
    const num = task.metadata?.planTaskNumber
    if (typeof num === "number" && Number.isFinite(num)) {
      numberToTaskId.set(num, task.id)
    }
  }

  const createdByNumber = new Map<number, { id: string; revision: number }>()

  for (const planTask of planTasks) {
    const planTaskKey = `${planId}#${planTask.task_number}`
    if (byPlanTaskKey.has(planTaskKey)) {
      skipped.push({ task_number: planTask.task_number, reason: "already_exists" })
      continue
    }

    const title = `${planTask.task_number}. ${planTask.title}`
    const description = buildTaskDescription(planId, planTaskKey, planTask.raw_block)

    const node = createTaskNode(
      {
        scope,
        container_id: containerId,
        title,
        description,
        metadata: {
          planId,
          planTaskKey,
          planTaskNumber: planTask.task_number,
          contextPackIds: planTask.context_pack_ids,
        },
      },
      config
    )

    byPlanTaskKey.set(planTaskKey, node)
    numberToTaskId.set(planTask.task_number, node.id)
    createdByNumber.set(planTask.task_number, { id: node.id, revision: node.revision })
    created.push({ task_number: planTask.task_number, task_id: node.id })
  }

  // Second pass: set dependencies for newly created tasks only (avoid overwriting existing tasks).
  for (const planTask of planTasks) {
    const createdNode = createdByNumber.get(planTask.task_number)
    if (!createdNode) continue

    const dependsOnIds: string[] = []
    for (const depNumber of planTask.depends_on_task_numbers) {
      const depId = numberToTaskId.get(depNumber)
      if (depId) dependsOnIds.push(depId)
    }

    if (dependsOnIds.length === 0) continue

    const updated = updateTaskNode(
      {
        scope,
        container_id: containerId,
        id: createdNode.id,
        expected_revision: createdNode.revision,
        add_depends_on: dependsOnIds,
      },
      config
    )
    createdNode.revision = updated.revision
  }

  return { created, skipped }
}

