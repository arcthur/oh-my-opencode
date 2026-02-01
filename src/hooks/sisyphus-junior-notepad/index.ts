import type { PluginInput } from "@opencode-ai/plugin"
import { log } from "../../shared/logger"
import { getSessionAgent } from "../../features/claude-code-session-state"

export const HOOK_NAME = "sisyphus-junior-notepad"

/**
 * Notepad directive injected when delegating to sisyphus-junior.
 * This is injected dynamically rather than hardcoded in the agent prompt,
 * saving tokens in non-planning contexts.
 */
export const NOTEPAD_DIRECTIVE = `<Work_Context>
## Notepad Location (for recording learnings)
NOTEPAD PATH: .sisyphus/notepads/{plan-name}/
- learnings.md: Record patterns, conventions, successful approaches
- issues.md: Record problems, blockers, gotchas encountered
- decisions.md: Record architectural choices and rationales
- problems.md: Record unresolved issues, technical debt

You SHOULD append findings to notepad files after completing work.

## Plan Location (READ ONLY)
PLAN PATH: .sisyphus/plans/{plan-name}.md

⚠️⚠️⚠️ CRITICAL RULE: NEVER MODIFY THE PLAN FILE ⚠️⚠️⚠️

The plan file (.sisyphus/plans/*.md) is SACRED and READ-ONLY.
- You may READ the plan to understand tasks
- You may READ checkbox items to know what to do
- You MUST NOT edit, modify, or update the plan file
- You MUST NOT mark checkboxes as complete in the plan
- Only the Orchestrator manages the plan file

VIOLATION = IMMEDIATE FAILURE. The Orchestrator tracks plan state.
</Work_Context>

`

/**
 * Orchestrator agents that can delegate to sisyphus-junior.
 */
const ORCHESTRATOR_AGENTS = new Set([
  "sisyphus",
  "atlas",
])

interface ToolExecuteBeforeInput {
  tool: string
  sessionID?: string
}

interface ToolExecuteBeforeOutput {
  args: Record<string, unknown>
  message?: string
}

/**
 * Sisyphus-Junior Notepad Hook
 *
 * Dynamically injects notepad directive when delegating to sisyphus-junior.
 * This is more efficient than hardcoding in the agent prompt because:
 * - Saves tokens in non-planning contexts
 * - Only appears when actually working on plans
 * - Allows flexible customization per delegation
 *
 * Triggers on delegate_task when:
 * - Caller is an orchestrator (sisyphus, atlas)
 * - Target agent is sisyphus-junior OR category-based delegation
 */
export function createSisyphusJuniorNotepadHook(_ctx: PluginInput) {
  return {
    "tool.execute.before": async (
      input: ToolExecuteBeforeInput,
      output: ToolExecuteBeforeOutput
    ): Promise<void> => {
      // Only handle delegate_task
      if (input.tool !== "delegate_task") {
        return
      }

      const sessionID = input.sessionID
      if (!sessionID) {
        return
      }

      // Check if caller is an orchestrator
      const callerAgent = getSessionAgent(sessionID)
      if (!callerAgent || !ORCHESTRATOR_AGENTS.has(callerAgent)) {
        return
      }

      // Check if target is sisyphus-junior or category-based (which spawns sisyphus-junior)
      const args = output.args
      const targetAgent = args.agent as string | undefined
      const category = args.category as string | undefined

      // Category-based delegation spawns sisyphus-junior
      const isSisyphusJuniorTarget =
        targetAgent === "sisyphus-junior" || (category && !targetAgent)

      if (!isSisyphusJuniorTarget) {
        return
      }

      // Check if prompt already has the directive (avoid double-injection)
      const prompt = args.prompt as string | undefined
      if (prompt && prompt.includes("<Work_Context>")) {
        log(`[${HOOK_NAME}] Skipped: prompt already contains Work_Context`, {
          sessionID,
        })
        return
      }

      // Prepend notepad directive to prompt
      const originalPrompt = prompt || ""
      output.args = {
        ...args,
        prompt: NOTEPAD_DIRECTIVE + originalPrompt,
      }

      log(`[${HOOK_NAME}] Injected notepad directive`, {
        sessionID,
        callerAgent,
        targetAgent: targetAgent || `category:${category}`,
      })
    },
  }
}
