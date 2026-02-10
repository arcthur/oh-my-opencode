import type { PluginInput } from "@opencode-ai/plugin"
import { createWorkStateManager, type WorkExecutor } from "../../features/work-state"
import { log } from "../../shared/logger"
import { updateSessionAgent } from "../../features/claude-code-session-state"
import { existsSync, readFileSync, statSync } from "node:fs"
import { basename, isAbsolute, join } from "node:path"
import type { OhMyOpenCodeConfig } from "../../config/schema"
import { listTaskNodes, syncPlanTasksToTaskGraph } from "../../features/task-system"

export const HOOK_NAME = "start-work"

const KEYWORD_PATTERN = /\b(ultrawork|ulw)\b/gi
const DEFAULT_EXECUTOR: WorkExecutor = "atlas"

interface StartWorkHookInput {
  sessionID: string
  messageID?: string
}

interface StartWorkHookOutput {
  parts: Array<{ type: string; text?: string }>
}

interface PlanProgress {
  total: number
  completed: number
  isComplete: boolean
}

function extractUserRequestPlanId(promptText: string): string | null {
  const userRequestMatch = promptText.match(/<user-request>\s*([\s\S]*?)\s*<\/user-request>/i)
  if (!userRequestMatch) return null

  const rawArg = userRequestMatch[1].trim()
  if (!rawArg) return null

  const cleanedArg = rawArg.replace(KEYWORD_PATTERN, "").trim()
  return cleanedArg || null
}

function extractPlanIdFromPath(planPath: string): string {
  const normalized = planPath.replace(/\\/g, "/")
  const parts = normalized.split("/")
  return parts[parts.length - 2] ?? basename(planPath, ".md")
}

function findPlanById(plans: string[], requestedId: string): string | null {
  const lowerId = requestedId.toLowerCase()

  const exactMatch = plans.find((p) => extractPlanIdFromPath(p).toLowerCase() === lowerId)
  if (exactMatch) return exactMatch

  const partialMatch = plans.find((p) => extractPlanIdFromPath(p).toLowerCase().includes(lowerId))
  return partialMatch || null
}

function resolvePlanPath(cwd: string, planPath: string): string {
  return isAbsolute(planPath) ? planPath : join(cwd, planPath)
}

function computePlanProgressFromTaskGraph(
  planId: string,
  config: Partial<OhMyOpenCodeConfig>
): PlanProgress {
  try {
    const tasks = listTaskNodes(
      {
        scope: "plan",
        container_id: planId,
        include_completed: true,
      },
      config
    )

    const total = tasks.length
    const completed = tasks.filter((t) => t.state === "completed" || t.state === "cancelled").length
    const remaining = total - completed
    return { total, completed, isComplete: total > 0 && remaining === 0 }
  } catch {
    return { total: 0, completed: 0, isComplete: false }
  }
}

function findIncompletePlans(
  planPaths: string[],
  config: Partial<OhMyOpenCodeConfig>
): Array<{ path: string; planId: string; progress: PlanProgress }> {
  return planPaths
    .map((p) => {
      const planId = extractPlanIdFromPath(p)
      const progress = computePlanProgressFromTaskGraph(planId, config)
      return { path: p, planId, progress }
    })
    .filter((p) => !p.progress.isComplete)
}

function syncPlanTasksFromFile(
  cwd: string,
  planId: string,
  planPath: string,
  config: Partial<OhMyOpenCodeConfig>
): { created: number; skipped: number } {
  const absPath = resolvePlanPath(cwd, planPath)
  if (!existsSync(absPath)) {
    return { created: 0, skipped: 0 }
  }

  let planMarkdown = ""
  try {
    planMarkdown = readFileSync(absPath, "utf-8")
  } catch {
    return { created: 0, skipped: 0 }
  }

  const sync = syncPlanTasksToTaskGraph({
    config,
    scope: "plan",
    container_id: planId,
    planId,
    planMarkdown,
  })

  return { created: sync.created.length, skipped: sync.skipped.length }
}

export function createStartWorkHook(
  ctx: PluginInput,
  taskConfig: Partial<OhMyOpenCodeConfig> = {}
) {
  const workStateManager = createWorkStateManager(ctx.directory)

  return {
    "chat.message": async (
      input: StartWorkHookInput,
      output: StartWorkHookOutput
    ): Promise<void> => {
      const parts = output.parts
      const promptText =
        parts
          ?.filter((p) => p.type === "text" && p.text)
          .map((p) => p.text)
          .join("\n")
          .trim() || ""

      const isStartWorkCommand = promptText.includes("<session-context>")
      if (!isStartWorkCommand) return

      log(`[${HOOK_NAME}] Processing start-work command`, {
        sessionID: input.sessionID,
      })

      const existingState = workStateManager.load()
      const sessionId = input.sessionID
      const timestamp = new Date().toISOString()

      let contextInfo = ""
      let existingProgress: PlanProgress | null = null

      const explicitPlanId = extractUserRequestPlanId(promptText)

      if (explicitPlanId) {
        log(`[${HOOK_NAME}] Explicit plan ID requested: ${explicitPlanId}`, {
          sessionID: input.sessionID,
        })

        const allPlans = workStateManager.findPlans()
        const matchedPlanPath = findPlanById(allPlans, explicitPlanId)

        if (matchedPlanPath) {
          const matchedPlanId = extractPlanIdFromPath(matchedPlanPath)
          syncPlanTasksFromFile(ctx.directory, matchedPlanId, matchedPlanPath, taskConfig)
          const progress = computePlanProgressFromTaskGraph(matchedPlanId, taskConfig)
          const isSamePlan = existingState && existingState.plan_id === matchedPlanId

          if (isSamePlan) {
            workStateManager.appendSessionId(sessionId)
            const sessions = existingState.session_ids.length + 1

            if (progress.isComplete) {
              contextInfo = `
## Plan Already Complete

The requested plan "${matchedPlanId}" has been completed.
All ${progress.total} tasks are done. Create a new plan with: /plan "your task"`
            } else {
              contextInfo = `
## Resuming Specified Plan

**Plan ID**: ${matchedPlanId}
**Path**: ${matchedPlanPath}
**Progress**: ${progress.completed}/${progress.total} tasks
**Sessions**: ${sessions} (current session appended)
**Original Start**: ${existingState.started_at}

Continuing existing work session. Use TaskGraph to continue from the next ready task.`
            }
          } else {
            if (progress.isComplete) {
              contextInfo = `
## Plan Already Complete

The requested plan "${matchedPlanId}" has been completed.
All ${progress.total} tasks are done. Create a new plan with: /plan "your task"`
            } else {
              workStateManager.switchPlan(matchedPlanId, sessionId, undefined, DEFAULT_EXECUTOR)
              contextInfo = `
## Auto-Selected Plan

**Plan ID**: ${matchedPlanId}
**Path**: ${matchedPlanPath}
**Progress**: ${progress.completed}/${progress.total} tasks
**Session ID**: ${sessionId}
**Started**: ${timestamp}

work.yaml has been created. Begin execution via TaskGraph (task_list/task_transition).`
            }
          }
        } else {
          const incompletePlans = findIncompletePlans(allPlans, taskConfig)
          if (incompletePlans.length > 0) {
            const planList = incompletePlans
              .map((p, i) => `${i + 1}. [${p.planId}] - Progress: ${p.progress.completed}/${p.progress.total}`)
              .join("\n")

            contextInfo = `
## Plan Not Found

Could not find a plan matching "${explicitPlanId}".

Available incomplete plans:
${planList}

Ask the user which plan to work on.`
          } else {
            contextInfo = `
## Plan Not Found

Could not find a plan matching "${explicitPlanId}".
No incomplete plans available. Create a new plan with: /plan "your task"`
          }
        }
      } else if (existingState) {
        syncPlanTasksFromFile(
          ctx.directory,
          existingState.plan_id,
          existingState.execution_plan_path,
          taskConfig
        )
        existingProgress = computePlanProgressFromTaskGraph(existingState.plan_id, taskConfig)

        if (!existingProgress.isComplete) {
          workStateManager.appendSessionId(sessionId)
          const sessions = existingState.session_ids.length + 1
          contextInfo = `
## Active Work Session Found

**Status**: RESUMING existing work
**Plan ID**: ${existingState.plan_id}
**Path**: ${existingState.execution_plan_path}
**Progress**: ${existingProgress.completed}/${existingProgress.total} tasks completed
**Sessions**: ${sessions} (current session appended)
**Started**: ${existingState.started_at}

The current session (${sessionId}) has been added to session_ids.
Use TaskGraph to continue from the next ready task.`
        } else {
          contextInfo = `
## Previous Work Complete

The previous plan (${existingState.plan_id}) has been completed.
Looking for new plans...`
        }
      }

      if (
        (!existingState && !explicitPlanId) ||
        (existingState && !explicitPlanId && existingProgress?.isComplete)
      ) {
        const allPlans = workStateManager.findPlans()
        const incompletePlans = findIncompletePlans(allPlans, taskConfig)

        if (incompletePlans.length === 0) {
          if (allPlans.length === 0) {
            contextInfo += `

## No Plans Found

No plan directories found at .sisyphus/plans/
Use Prometheus to create a work plan first: /plan "your task"`
          } else {
            contextInfo += `

## All Plans Complete

All ${allPlans.length} plan(s) are complete. Create a new plan with: /plan "your task"`
          }
        } else if (incompletePlans.length === 1) {
          const plan = incompletePlans[0]
          workStateManager.initializePlan(plan.planId, sessionId, undefined, DEFAULT_EXECUTOR)
          syncPlanTasksFromFile(ctx.directory, plan.planId, plan.path, taskConfig)
          const progress = computePlanProgressFromTaskGraph(plan.planId, taskConfig)

          contextInfo += `

## Auto-Selected Plan

**Plan ID**: ${plan.planId}
**Path**: ${plan.path}
**Progress**: ${progress.completed}/${progress.total} tasks
**Session ID**: ${sessionId}
**Started**: ${timestamp}

work.yaml has been created. Begin execution via TaskGraph (task_list/task_transition).`
        } else {
          const planList = incompletePlans
            .map((p, i) => {
              const absPath = resolvePlanPath(ctx.directory, p.path)
              const stat = statSync(absPath)
              const modified = new Date(stat.mtimeMs).toISOString()
              return `${i + 1}. [${p.planId}] - Modified: ${modified} - Progress: ${p.progress.completed}/${p.progress.total}`
            })
            .join("\n")

          contextInfo += `

<system-reminder>
## Multiple Plans Found

Current Time: ${timestamp}
Session ID: ${sessionId}

${planList}

Ask the user which plan to work on. Present the options above and wait for their response.
</system-reminder>`
        }
      }

      const idx = output.parts.findIndex((p) => p.type === "text" && p.text)
      if (idx >= 0 && output.parts[idx].text) {
        output.parts[idx].text = output.parts[idx].text
          .replace(/\$SESSION_ID/g, sessionId)
          .replace(/\$TIMESTAMP/g, timestamp)

        output.parts[idx].text += `\n\n---\n${contextInfo}`
      }

      const activeState = workStateManager.load()
      if (activeState?.session_ids.includes(sessionId)) {
        updateSessionAgent(sessionId, activeState.executor)
      }

      log(`[${HOOK_NAME}] Context injected`, {
        sessionID: input.sessionID,
        hasExistingState: !!existingState,
      })
    },
  }
}
