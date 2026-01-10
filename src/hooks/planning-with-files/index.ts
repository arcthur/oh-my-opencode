/**
 * Planning with Files Hooks
 *
 * Implements the Manus-style planning pattern through hooks:
 *
 * 1. PreToolUse Hook: Re-reads task_plan.md before Write/Edit/Bash operations
 *    to prevent goal drift after many tool calls.
 *
 * 2. PostToolUse Hook: Tracks action count for the 2-action rule and
 *    reminds to update findings.md after 2 view/search operations.
 *
 * 3. Stop Hook: Verifies all phases are complete before allowing task
 *    termination.
 *
 * 4. Error Protocol: Implements 3-strike protocol for error handling.
 */

import type { Hooks, PluginInput } from "../../types"
import type { PlanningWithFilesConfig } from "../../features/planning-with-files/types"
import { DEFAULT_PLANNING_CONFIG } from "../../features/planning-with-files/types"
import {
  getPlanningSession,
  loadPlanningSession,
  generateRereadContext,
  areAllPhasesComplete,
  getIncompletePhases,
  getStrikeGuidance,
} from "../../features/planning-with-files"
import {
  REREAD_TRIGGER_TOOLS,
  ACTION_COUNT_TOOLS,
  MIN_REREAD_INTERVAL,
  ACTION_THRESHOLD,
} from "./constants"
import {
  getSessionState,
  setActivePlan,
  getActivePlan,
  incrementActionCount,
  resetActionCount,
  wasTwoActionWarningShown,
  markTwoActionWarningShown,
  updateLastRereadTime,
  getLastRereadTime,
  recordErrorStrike,
  cleanupSession,
} from "./storage"

export interface PlanningWithFilesHookOptions {
  config?: Partial<PlanningWithFilesConfig>
}

/**
 * Create the planning-with-files hooks
 */
export function createPlanningWithFilesHooks(
  ctx: PluginInput,
  options: PlanningWithFilesHookOptions = {}
): Hooks {
  const config = { ...DEFAULT_PLANNING_CONFIG, ...options.config }

  // Early exit if disabled
  if (!config.enabled) {
    return {}
  }

  return {
    /**
     * PreToolUse Hook
     *
     * Before Write/Edit/Bash operations, re-read the task plan to maintain
     * goal awareness. This counteracts the "lost in the middle" problem.
     */
    PreToolUse: async (input, output) => {
      const sessionId = input.session_id
      const toolName = input.tool_name

      // Only trigger for specific tools
      if (!config.autoReread) return
      if (!REREAD_TRIGGER_TOOLS.includes(toolName)) return

      // Check if there's an active plan
      const activePlanName = getActivePlan(sessionId)
      if (!activePlanName) return

      // Rate limit re-reads
      const lastReread = getLastRereadTime(sessionId)
      const now = Date.now()
      if (now - lastReread < MIN_REREAD_INTERVAL) return

      // Load the planning session
      const session = getPlanningSession(sessionId) ||
        await loadPlanningSession(sessionId, activePlanName, input.cwd, config)

      if (!session) return

      // Generate and inject the context
      try {
        const context = await generateRereadContext(session)
        updateLastRereadTime(sessionId)

        // Inject as system message
        if (context) {
          output.systemMessage = context
        }
      } catch {
        // Silently fail - don't block tool use
      }
    },

    /**
     * PostToolUse Hook
     *
     * After view/search operations, track action count for the 2-action rule.
     * When threshold is reached, remind to update findings.md.
     */
    PostToolUse: async (input, output) => {
      const sessionId = input.session_id
      const toolName = input.tool_name

      // Only count specific tools
      if (!config.twoActionRule) return
      if (!ACTION_COUNT_TOOLS.includes(toolName)) return

      // Check if there's an active plan
      const activePlanName = getActivePlan(sessionId)
      if (!activePlanName) return

      // Increment action count
      const count = incrementActionCount(sessionId)

      // Check if we've hit the threshold
      if (count >= ACTION_THRESHOLD && !wasTwoActionWarningShown(sessionId)) {
        markTwoActionWarningShown(sessionId)

        const session = getPlanningSession(sessionId) ||
          await loadPlanningSession(sessionId, activePlanName, input.cwd, config)

        if (session) {
          output.systemMessage = `<two-action-rule>
## Findings Update Reminder

You've completed ${count} view/search operations since the last findings update.

**2-Action Rule**: Update \`${session.findingsPath}\` now to persist:
- Key discoveries from your research
- Technical decisions made
- Resources found

This prevents information loss when context resets.

After updating findings.md, the action counter will reset.
</two-action-rule>`
        }
      }

      // Check for errors in tool output and apply 3-strike protocol
      if (config.threeStrikeProtocol && output.error) {
        const errorKey = `${toolName}:${output.error.slice(0, 100)}`
        const strikes = recordErrorStrike(sessionId, errorKey)
        const guidance = getStrikeGuidance(strikes)

        output.systemMessage = (output.systemMessage || "") + `

<three-strike-protocol>
## Error Handling - ${guidance}

Error: ${output.error.slice(0, 200)}

${strikes >= 3 ? "**CRITICAL**: Consider blocking this phase and reassessing the approach." : ""}
</three-strike-protocol>`
      }
    },

    /**
     * Stop Hook
     *
     * Before stopping, verify all phases are complete.
     * Block if there are incomplete phases.
     */
    Stop: async (input) => {
      if (!config.stopVerification) {
        return { block: false }
      }

      const sessionId = input.session_id
      const activePlanName = getActivePlan(sessionId)

      if (!activePlanName) {
        return { block: false }
      }

      const session = getPlanningSession(sessionId) ||
        await loadPlanningSession(sessionId, activePlanName, input.cwd, config)

      if (!session) {
        return { block: false }
      }

      try {
        const allComplete = await areAllPhasesComplete(session)

        if (!allComplete) {
          const incomplete = await getIncompletePhases(session)

          return {
            block: true,
            reason: `Cannot stop - incomplete phases detected:

${incomplete.map(p => `- ${p}`).join("\n")}

Either complete these phases or explicitly mark them as blocked with a reason.

To force stop, you can:
1. Mark remaining phases as \`complete\` or \`blocked\` in task_plan.md
2. Or use the /stop-force command (if available)`,
          }
        }

        // Cleanup on successful stop
        cleanupSession(sessionId)
        return { block: false }
      } catch {
        // On error, allow stopping
        return { block: false }
      }
    },

    /**
     * UserPromptSubmit Hook
     *
     * Detect when user starts a new planning session via keywords.
     */
    UserPromptSubmit: async (input, output) => {
      const sessionId = input.session_id
      const prompt = input.prompt?.toLowerCase() || ""

      // Detect plan initialization keywords
      const planInitPatterns = [
        /start\s+plan(?:ning)?\s+(?:for\s+)?["']?([^"'\n]+)["']?/i,
        /init(?:ialize)?\s+plan\s+["']?([^"'\n]+)["']?/i,
        /create\s+plan\s+(?:for\s+)?["']?([^"'\n]+)["']?/i,
        /begin\s+planning\s+["']?([^"'\n]+)["']?/i,
      ]

      for (const pattern of planInitPatterns) {
        const match = prompt.match(pattern)
        if (match) {
          const planName = match[1]?.trim().replace(/\s+/g, "-").toLowerCase() || "default"
          setActivePlan(sessionId, planName)

          output.systemMessage = `<planning-session-activated>
## Planning with Files Activated

Plan Name: **${planName}**

I'll create the 3-file planning structure:
- \`task_plan.md\` - Phases, goals, decisions, errors
- \`findings.md\` - Research, technical decisions, resources
- \`progress.md\` - Session logs, test results

**Active Patterns**:
- Auto re-read task_plan.md before Write/Edit/Bash operations
- 2-Action Rule: Update findings after 2 view/search operations
- 3-Strike Protocol: Structured error handling
- Stop verification: Ensure all phases complete

Tell me your goal and I'll initialize the planning files.
</planning-session-activated>`
          break
        }
      }

      // Detect findings update acknowledgment
      if (prompt.includes("updated findings") || prompt.includes("findings updated")) {
        resetActionCount(sessionId)
      }
    },
  }
}

// Re-export types and utilities
export type { PlanningWithFilesConfig } from "../../features/planning-with-files/types"
export { setActivePlan, getActivePlan, resetActionCount } from "./storage"
export {
  REREAD_TRIGGER_TOOLS,
  ACTION_COUNT_TOOLS,
  MIN_REREAD_INTERVAL,
  ACTION_THRESHOLD,
} from "./constants"
