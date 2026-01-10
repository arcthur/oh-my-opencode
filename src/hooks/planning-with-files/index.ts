/**
 * Planning with Files Hooks
 *
 * Optimized implementation:
 * - Full task_plan.md injection for KV-cache optimization
 * - Auto-detection of findings.md updates via mtime
 * - State persistence via .planning-state.json
 * - Prometheus integration via chat.message hook
 */

import type { Hooks } from "../../types"
import type { PlanningWithFilesConfig } from "../../features/planning-with-files/types"
import { DEFAULT_PLANNING_CONFIG } from "../../features/planning-with-files/types"
import {
  loadState,
  saveState,
  readTaskPlan,
  detectActivePlan,
  wasFindingsModified,
  getStrikeGuidance,
  parsePhases,
  cleanupSession,
  getPlanDir,
} from "../../features/planning-with-files/manager"

/** Track active plan per session */
const sessionPlans = new Map<string, string>()
/** Track capability injection per session */
const injectedSessions = new Set<string>()

export interface PlanningWithFilesHookOptions {
  config?: Partial<PlanningWithFilesConfig>
}

/**
 * Create planning-with-files hooks
 */
export function createPlanningWithFilesHooks(
  options: PlanningWithFilesHookOptions = {}
): Hooks {
  const config = { ...DEFAULT_PLANNING_CONFIG, ...options.config }

  if (!config.enabled) {
    return {}
  }

  return {
    /**
     * PreToolUse: Inject FULL task_plan.md for KV-cache optimization
     *
     * By keeping the content stable at the prompt start,
     * we maximize KV-cache hits and reduce latency.
     */
    PreToolUse: async (input, output) => {
      if (!config.autoReread) return

      const { session_id, tool_name, cwd } = input
      const triggerTools = config.rereadTriggerTools

      if (!triggerTools.includes(tool_name)) return

      // Get or detect active plan
      let planName = sessionPlans.get(session_id)
      if (!planName) {
        planName = await detectActivePlan(cwd) ?? undefined
        if (planName) sessionPlans.set(session_id, planName)
      }
      if (!planName) return

      // Read FULL task_plan.md
      const content = await readTaskPlan(cwd, planName)
      if (!content) return

      output.systemMessage = `<task-plan-context>
${content}
</task-plan-context>

<reminder>
Stay focused on the current phase. Do not deviate from the goal.
</reminder>`
    },

    /**
     * PostToolUse: Smart action counting with auto-reset
     */
    PostToolUse: async (input, output) => {
      const { session_id, tool_name, cwd } = input

      const planName = sessionPlans.get(session_id)
      if (!planName) return

      let state = await loadState(cwd, planName)
      if (!state) return

      // Auto-detect findings.md modification
      const check = await wasFindingsModified(cwd, planName, state.lastFindingsMtime)
      if (check.modified) {
        state.actionCount = 0
        state.lastFindingsMtime = check.newMtime
        await saveState(cwd, state)
        return
      }

      // Count actions for 2-action rule
      if (config.twoActionRule && config.actionCountTools.includes(tool_name)) {
        state.actionCount++
        await saveState(cwd, state)

        if (state.actionCount >= 2) {
          output.systemMessage = `<two-action-rule>
## Update findings.md NOW

${state.actionCount} research operations completed.

Update \`${getPlanDir(cwd, planName)}/findings.md\` with:
- Key discoveries
- Technical decisions
- Resources found

Counter auto-resets when you modify findings.md.
</two-action-rule>`
        }
      }

      // 3-strike protocol for errors
      if (config.threeStrikeProtocol && output.error) {
        const errorKey = `${tool_name}:${output.error.slice(0, 50)}`
        state.errorStrikes[errorKey] = (state.errorStrikes[errorKey] || 0) + 1
        await saveState(cwd, state)

        const strikes = state.errorStrikes[errorKey]
        output.systemMessage = (output.systemMessage || "") + `

<three-strike-protocol strike="${strikes}">
${getStrikeGuidance(strikes)}

Error: ${output.error.slice(0, 150)}
</three-strike-protocol>`
      }
    },

    /**
     * ChatMessage: Prometheus integration
     */
    "chat.message": async (input, output) => {
      const { session_id, cwd } = input

      if (injectedSessions.has(session_id)) return

      const planName = sessionPlans.get(session_id) || await detectActivePlan(cwd)
      if (!planName) return

      injectedSessions.add(session_id)
      sessionPlans.set(session_id, planName)

      output.systemMessage = `<planning-with-files-active plan="${planName}">
## Planning with Files Active

**Plan**: ${planName}
**Location**: .sisyphus/plans/${planName}/

**Files**:
- task_plan.md - Phases, decisions, errors
- findings.md - Research (2-action rule)
- progress.md - Session logs

**Active Protocols**:
- Auto re-read task_plan before Write/Edit/Bash
- 2-Action Rule with auto-reset
- 3-Strike Error Protocol
- Stop verification
</planning-with-files-active>`
    },

    /**
     * Stop: Verify all phases complete (supports "blocked" status)
     */
    Stop: async (input) => {
      if (!config.stopVerification) return { block: false }

      const { session_id, cwd } = input
      const planName = sessionPlans.get(session_id)
      if (!planName) return { block: false }

      const content = await readTaskPlan(cwd, planName)
      if (!content) return { block: false }

      const phases = parsePhases(content)
      const incomplete = phases.filter(p =>
        p.status !== "complete" && p.status !== "blocked"
      )

      if (incomplete.length > 0) {
        return {
          block: true,
          reason: `Incomplete phases:

${incomplete.map(p => `- Phase ${p.id}: ${p.name} (${p.status})`).join("\n")}

**Options**:
1. Complete remaining phases
2. Mark phases as \`blocked\` in task_plan.md
3. Use \`/stop --force\` to override`,
        }
      }

      // Cleanup
      sessionPlans.delete(session_id)
      injectedSessions.delete(session_id)
      cleanupSession(cwd, planName)
      return { block: false }
    },
  }
}

// Re-exports
export { setActivePlan, getActivePlan, resetActionCount } from "./storage"
export type { PlanningWithFilesConfig } from "../../features/planning-with-files/types"

/**
 * Set active plan for a session
 */
export function setActivePlan(sessionId: string, planName: string | null): void {
  if (planName) {
    sessionPlans.set(sessionId, planName)
  } else {
    sessionPlans.delete(sessionId)
  }
}

/**
 * Get active plan for a session
 */
export function getActivePlan(sessionId: string): string | undefined {
  return sessionPlans.get(sessionId)
}

/**
 * Reset action count (called after manual findings update)
 */
export async function resetActionCount(sessionId: string, cwd: string): Promise<void> {
  const planName = sessionPlans.get(sessionId)
  if (!planName) return

  const state = await loadState(cwd, planName)
  if (!state) return

  state.actionCount = 0
  state.lastFindingsMtime = Date.now()
  await saveState(cwd, state)
}
