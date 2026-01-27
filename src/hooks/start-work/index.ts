import type { PluginInput } from "@opencode-ai/plugin"
import { WorkStateManager, createWorkStateManager } from "../../features/work-state"
import { log } from "../../shared/logger"
import { updateSessionAgent } from "../../features/claude-code-session-state"
import { basename, join } from "node:path"

export const HOOK_NAME = "start-work"

const KEYWORD_PATTERN = /\b(ultrawork|ulw)\b/gi

interface StartWorkHookInput {
  sessionID: string
  messageID?: string
}

interface StartWorkHookOutput {
  parts: Array<{ type: string; text?: string }>
}

function extractUserRequestPlanName(promptText: string): string | null {
  const userRequestMatch = promptText.match(/<user-request>\s*([\s\S]*?)\s*<\/user-request>/i)
  if (!userRequestMatch) return null

  const rawArg = userRequestMatch[1].trim()
  if (!rawArg) return null

  const cleanedArg = rawArg.replace(KEYWORD_PATTERN, "").trim()
  return cleanedArg || null
}

function findPlanByName(
  plans: Array<{ path: string; name: string }>,
  requestedName: string
): { path: string; name: string } | null {
  const lowerName = requestedName.toLowerCase()

  const exactMatch = plans.find((p) => p.name.toLowerCase() === lowerName)
  if (exactMatch) return exactMatch

  const partialMatch = plans.find((p) => p.name.toLowerCase().includes(lowerName))
  return partialMatch || null
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

      // Only trigger on actual command execution (contains <session-context> tag)
      // NOT on description text like "Start Sisyphus work session from Prometheus plan"
      const isStartWorkCommand = promptText.includes("<session-context>")

      if (!isStartWorkCommand) {
        return
      }

      log(`[${HOOK_NAME}] Processing start-work command`, {
        sessionID: input.sessionID,
      })

      updateSessionAgent(input.sessionID, "Atlas")

      const existingState = workStateManager.load()
      const sessionId = input.sessionID
      const timestamp = new Date().toISOString()

      let contextInfo = ""

      const explicitPlanName = extractUserRequestPlanName(promptText)

      if (explicitPlanName) {
        log(`[${HOOK_NAME}] Explicit plan name requested: ${explicitPlanName}`, {
          sessionID: input.sessionID,
        })

        const allPlans = workStateManager.findPlans()
        const planInfos = allPlans.map((p) => ({ path: p, name: basename(p, ".md") }))
        const matchedPlan = findPlanByName(planInfos, explicitPlanName)

        if (matchedPlan) {
          // Check if this is the same plan as existing state (resume vs switch)
          const isSamePlan =
            existingState && existingState.active_plan === matchedPlan.path

          if (isSamePlan) {
            // Same plan: append session and resume (preserve history)
            workStateManager.appendSessionId(sessionId)
            const progress = workStateManager.getPlanProgress()

            if (progress.isComplete) {
              contextInfo = `
## Plan Already Complete

The requested plan "${matchedPlan.name}" has been completed.
All ${progress.total} tasks are done. Create a new plan with: /plan "your task"`
            } else {
              contextInfo = `
## Resuming Specified Plan

**Plan**: ${matchedPlan.name}
**Path**: ${matchedPlan.path}
**Progress**: ${progress.completed}/${progress.total} tasks
**Sessions**: ${existingState!.session_ids.length} (current session appended)
**Original Start**: ${existingState!.started_at}

Continuing existing work session. Read the plan and continue from the first unchecked task.`
            }
          } else {
            // Different plan: record decision and switch (reset state)
            if (existingState) {
              // Record the plan switch in decisions before switching
              workStateManager.recordDecision(
                `Switched from plan "${existingState.plan_name}" to "${matchedPlan.name}"`,
                "User explicitly requested different plan",
                [existingState.plan_name]
              )
            }

            // Initialize new plan (resets errors/blockers/decisions)
            workStateManager.initialize(matchedPlan.path, sessionId)
            const progress = workStateManager.getPlanProgress()

            if (progress.isComplete) {
              workStateManager.clear()
              contextInfo = `
## Plan Already Complete

The requested plan "${matchedPlan.name}" has been completed.
All ${progress.total} tasks are done. Create a new plan with: /plan "your task"`
            } else {
              const switchNote = existingState
                ? `\n**Note**: Switched from previous plan "${existingState.plan_name}". Work state has been reset.`
                : ""
              contextInfo = `
## Starting New Plan

**Plan**: ${matchedPlan.name}
**Path**: ${matchedPlan.path}
**Progress**: ${progress.completed}/${progress.total} tasks
**Session ID**: ${sessionId}
**Started**: ${timestamp}${switchNote}

work.yaml has been created. Read the plan and begin execution.`
            }
          }
        } else {
          const incompletePlans = workStateManager.findIncompletePlans()
          if (incompletePlans.length > 0) {
            const planList = incompletePlans
              .map((p, i) => `${i + 1}. [${p.name}] - Progress: ${p.progress.completed}/${p.progress.total}`)
              .join("\n")

            contextInfo = `
## Plan Not Found

Could not find a plan matching "${explicitPlanName}".

Available incomplete plans:
${planList}

Ask the user which plan to work on.`
          } else {
            contextInfo = `
## Plan Not Found

Could not find a plan matching "${explicitPlanName}".
No incomplete plans available. Create a new plan with: /plan "your task"`
          }
        }
      } else if (existingState) {
        const progress = workStateManager.getPlanProgress()

        if (!progress.isComplete) {
          workStateManager.appendSessionId(sessionId)
          contextInfo = `
## Active Work Session Found

**Status**: RESUMING existing work
**Plan**: ${existingState.plan_name}
**Path**: ${existingState.active_plan}
**Progress**: ${progress.completed}/${progress.total} tasks completed
**Sessions**: ${existingState.session_ids.length} (current session appended)
**Started**: ${existingState.started_at}

The current session (${sessionId}) has been added to session_ids.
Read the plan file and continue from the first unchecked task.`
        } else {
          contextInfo = `
## Previous Work Complete

The previous plan (${existingState.plan_name}) has been completed.
Looking for new plans...`
        }
      }

      if (
        (!existingState && !explicitPlanName) ||
        (existingState && !explicitPlanName && workStateManager.getPlanProgress().isComplete)
      ) {
        const incompletePlans = workStateManager.findIncompletePlans()

        if (incompletePlans.length === 0) {
          const allPlans = workStateManager.findPlans()
          if (allPlans.length === 0) {
            contextInfo += `

## No Plans Found

No Prometheus plan files found at .sisyphus/plans/
Use Prometheus to create a work plan first: /plan "your task"`
          } else {
            contextInfo += `

## All Plans Complete

All ${allPlans.length} plan(s) are complete. Create a new plan with: /plan "your task"`
          }
        } else if (incompletePlans.length === 1) {
          const plan = incompletePlans[0]
          workStateManager.initialize(plan.path, sessionId)

          contextInfo += `

## Auto-Selected Plan

**Plan**: ${plan.name}
**Path**: ${plan.path}
**Progress**: ${plan.progress.completed}/${plan.progress.total} tasks
**Session ID**: ${sessionId}
**Started**: ${timestamp}

work.yaml has been created. Read the plan and begin execution.`
        } else {
          const { statSync } = require("node:fs")
          const planList = incompletePlans
            .map((p, i) => {
              // Resolve relative path to absolute for statSync
              const absPath = p.path.startsWith("/") ? p.path : join(ctx.directory, p.path)
              const stat = statSync(absPath)
              const modified = new Date(stat.mtimeMs).toISOString()
              return `${i + 1}. [${p.name}] - Modified: ${modified} - Progress: ${p.progress.completed}/${p.progress.total}`
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
