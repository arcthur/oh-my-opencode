import type { PluginInput } from "@opencode-ai/plugin"
import { createWorkStateManager } from "../../features/work-state"
import { log } from "../../shared/logger"
import { updateSessionAgent } from "../../features/claude-code-session-state"
import { existsSync, readFileSync, statSync } from "node:fs"
import { basename, isAbsolute, join } from "node:path"

export const HOOK_NAME = "start-work"

const KEYWORD_PATTERN = /\b(ultrawork|ulw)\b/gi

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

function getPlanProgressFromFile(cwd: string, planPath: string): PlanProgress {
  const absPath = resolvePlanPath(cwd, planPath)
  if (!existsSync(absPath)) return { total: 0, completed: 0, isComplete: false }

  try {
    const content = readFileSync(absPath, "utf-8")
    const uncheckedMatches = content.match(/^[-*]\s*\[\s*\]/gm) || []
    const checkedMatches = content.match(/^[-*]\s*\[[xX]\]/gm) || []

    const total = uncheckedMatches.length + checkedMatches.length
    const completed = checkedMatches.length
    return {
      total,
      completed,
      isComplete: total === 0 ? false : completed === total,
    }
  } catch {
    return { total: 0, completed: 0, isComplete: false }
  }
}

function findIncompletePlans(
  cwd: string,
  planPaths: string[]
): Array<{ path: string; planId: string; progress: PlanProgress }> {
  return planPaths
    .map((p) => {
      const progress = getPlanProgressFromFile(cwd, p)
      return { path: p, planId: extractPlanIdFromPath(p), progress }
    })
    .filter((p) => !p.progress.isComplete)
}

export function createStartWorkHook(ctx: PluginInput) {
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

      updateSessionAgent(input.sessionID, "atlas")

      const existingState = workStateManager.load()
      const sessionId = input.sessionID
      const timestamp = new Date().toISOString()

      let contextInfo = ""

      const explicitPlanId = extractUserRequestPlanId(promptText)

      if (explicitPlanId) {
        log(`[${HOOK_NAME}] Explicit plan ID requested: ${explicitPlanId}`, {
          sessionID: input.sessionID,
        })

        const allPlans = workStateManager.findPlans()
        const matchedPlanPath = findPlanById(allPlans, explicitPlanId)

        if (matchedPlanPath) {
          const matchedPlanId = extractPlanIdFromPath(matchedPlanPath)
          const progress = getPlanProgressFromFile(ctx.directory, matchedPlanPath)
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

Continuing existing work session. Read the plan and continue from the first unchecked task.`
            }
          } else {
            if (progress.isComplete) {
              contextInfo = `
## Plan Already Complete

The requested plan "${matchedPlanId}" has been completed.
All ${progress.total} tasks are done. Create a new plan with: /plan "your task"`
            } else {
              workStateManager.switchPlan(matchedPlanId, sessionId)
              contextInfo = `
## Auto-Selected Plan

**Plan ID**: ${matchedPlanId}
**Path**: ${matchedPlanPath}
**Progress**: ${progress.completed}/${progress.total} tasks
**Session ID**: ${sessionId}
**Started**: ${timestamp}

work.yaml has been created. Read the plan and begin execution.`
            }
          }
        } else {
          const incompletePlans = findIncompletePlans(ctx.directory, allPlans)
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
        const progress = workStateManager.getPlanProgress()

        if (!progress.isComplete) {
          workStateManager.appendSessionId(sessionId)
          const sessions = existingState.session_ids.length + 1
          contextInfo = `
## Active Work Session Found

**Status**: RESUMING existing work
**Plan ID**: ${existingState.plan_id}
**Path**: ${existingState.execution_plan_path}
**Progress**: ${progress.completed}/${progress.total} tasks completed
**Sessions**: ${sessions} (current session appended)
**Started**: ${existingState.started_at}

The current session (${sessionId}) has been added to session_ids.
Read the plan file and continue from the first unchecked task.`
        } else {
          contextInfo = `
## Previous Work Complete

The previous plan (${existingState.plan_id}) has been completed.
Looking for new plans...`
        }
      }

      if (
        (!existingState && !explicitPlanId) ||
        (existingState && !explicitPlanId && workStateManager.getPlanProgress().isComplete)
      ) {
        const allPlans = workStateManager.findPlans()
        const incompletePlans = findIncompletePlans(ctx.directory, allPlans)

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
          workStateManager.initializePlan(plan.planId, sessionId)

          contextInfo += `

## Auto-Selected Plan

**Plan ID**: ${plan.planId}
**Path**: ${plan.path}
**Progress**: ${plan.progress.completed}/${plan.progress.total} tasks
**Session ID**: ${sessionId}
**Started**: ${timestamp}

work.yaml has been created. Read the plan and begin execution.`
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

      log(`[${HOOK_NAME}] Context injected`, {
        sessionID: input.sessionID,
        hasExistingState: !!existingState,
      })
    },
  }
}
