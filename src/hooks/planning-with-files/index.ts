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
  detectPhaseCompletion,
  generateReflectionPrompt,
  generateErrorRecordingPrompt,
  getCurrentPhase,
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
      if (!config.auto_reread) return

      const { session_id, tool_name, cwd } = input
      const triggerTools = config.reread_trigger_tools

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
     * PostToolUse: Smart action counting, phase reflection, and error protocol
     */
    PostToolUse: async (input, output) => {
      const { session_id, tool_name, cwd } = input

      const planName = sessionPlans.get(session_id)
      if (!planName) return

      let state = await loadState(cwd, planName)
      if (!state) return

      // Detect phase completion after task_plan.md modifications
      // This triggers reflection prompts for non-linear planning adjustments
      if (["Write", "Edit", "write", "edit"].includes(tool_name)) {
        const filePath = (input as { file_path?: string }).file_path || ""
        if (filePath.includes("task_plan.md")) {
          const content = await readTaskPlan(cwd, planName)
          if (content) {
            const currentPhases = parsePhases(content)
            const completedPhases = detectPhaseCompletion(cwd, planName, currentPhases)

            // Inject reflection prompt for each newly completed phase
            for (const phase of completedPhases) {
              const reflectionPrompt = generateReflectionPrompt(phase, currentPhases)
              output.systemMessage = (output.systemMessage || "") + "\n\n" + reflectionPrompt
            }
          }
        }
      }

      // Auto-detect findings.md modification
      const check = await wasFindingsModified(cwd, planName, state.lastFindingsMtime)
      if (check.modified) {
        state.actionCount = 0
        state.lastFindingsMtime = check.newMtime
        await saveState(cwd, state)
        return
      }

      // Count actions for 2-action rule
      if (config.two_action_rule && config.action_count_tools.includes(tool_name)) {
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

      // 3-strike protocol with forced error recording
      if (config.three_strike_protocol && output.error) {
        const errorKey = `${tool_name}:${output.error.slice(0, 50)}`
        state.errorStrikes[errorKey] = (state.errorStrikes[errorKey] || 0) + 1
        await saveState(cwd, state)

        const strikes = state.errorStrikes[errorKey]
        const requiresRecording = strikes >= 2

        // Get current phase for error context
        const content = await readTaskPlan(cwd, planName)
        const phases = content ? parsePhases(content) : []
        const currentPhase = getCurrentPhase(phases)

        output.systemMessage = (output.systemMessage || "") + `

<three-strike-protocol strike="${strikes}">
${getStrikeGuidance(strikes, requiresRecording)}

Error: ${output.error.slice(0, 150)}
</three-strike-protocol>`

        // Force error recording prompt on Strike 2+
        if (requiresRecording) {
          output.systemMessage += "\n\n" + generateErrorRecordingPrompt(errorKey, strikes, currentPhase)
        }
      }
    },

    /**
     * ChatMessage: Session initialization and capability notice
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
- task_plan.md - Phases, decisions, errors, blockers
- findings.md - Research (2-action rule)
- progress.md - Session logs

**Active Protocols**:
- Auto re-read task_plan before Write/Edit/Bash/NotebookEdit
- 2-Action Rule with auto-reset
- 3-Strike Error Protocol (forced recording on Strike 2+)
- Phase Reflection (prompts on completion for plan adjustment)
- Blockers section for escalation (distinct from retry-able errors)
- Stop verification
</planning-with-files-active>`
    },

    /**
     * Stop: Verify all phases complete (supports "blocked" status)
     */
    Stop: async (input) => {
      if (!config.stop_verification) return { block: false }

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
