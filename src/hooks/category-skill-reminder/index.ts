import type { PluginInput } from "@opencode-ai/plugin"
import { log } from "../../shared/logger"
import { getSessionAgent } from "../../features/claude-code-session-state"

export const HOOK_NAME = "category-skill-reminder"

/**
 * Tools that indicate delegatable work is happening.
 * When orchestrators use these directly, they may benefit from delegation.
 */
const DELEGATABLE_WORK_TOOLS = new Set([
  "edit",
  "write",
  "bash",
  "read",
  "grep",
  "glob",
  "multi_edit",
])

/**
 * Orchestrator agents that can delegate work.
 * Sisyphus-Junior is excluded - it's the executor, not delegator.
 */
const ORCHESTRATOR_AGENTS = new Set([
  "sisyphus",
  "atlas",
])

/**
 * Track which sessions have already received the reminder.
 * Only remind once per session to avoid noise.
 */
const remindedSessions = new Set<string>()

const CATEGORY_SKILL_REMINDER = `
<system-reminder type="delegation-hint">
**Category + Skill System Available**

You're directly executing work that could be delegated. Consider using \`delegate_task\` with:

**Categories** (determines model/reasoning level):
- \`visual-engineering\`: UI/UX, frontend, styling
- \`ultrabrain\`: Complex architecture, deep reasoning (xhigh variant)
- \`deep\`: Autonomous problem-solving, moderate complexity
- \`artistry\`: Creative tasks (max variant)
- \`quick\`: Trivial tasks
- \`writing\`: Documentation, prose

**Skills** (prepends domain expertise):
- \`frontend-ui-ux\`: Design-first mindset
- \`playwright\`: E2E testing patterns
- Custom skills from \`.opencode/skills/\`

**Example:**
\`\`\`
delegate_task({
  category: "visual-engineering",
  load_skills: ["frontend-ui-ux"],
  prompt: "Implement the login form with validation"
})
\`\`\`

This reminder appears once per session. Choose: delegate for efficiency, or continue if the task is trivial.
</system-reminder>
`

interface ToolExecuteBeforeInput {
  tool: string
  sessionID?: string
}

interface ToolExecuteBeforeOutput {
  args: Record<string, unknown>
  message?: string
}

/**
 * Category-Skill Reminder Hook
 *
 * Complements delegation-validator by reminding orchestrators BEFORE delegation:
 * - Triggers when orchestrators use work tools directly (edit, write, bash, etc.)
 * - Suggests category + skill delegation as an alternative
 * - Only fires once per session to avoid noise
 *
 * Two-stage delegation governance:
 * 1. category-skill-reminder: Pre-decision nudge (this hook)
 * 2. delegation-validator: Post-decision validation
 */
export function createCategorySkillReminderHook(_ctx: PluginInput) {
  return {
    "tool.execute.before": async (
      input: ToolExecuteBeforeInput,
      output: ToolExecuteBeforeOutput
    ): Promise<void> => {
      // Only trigger on delegatable work tools
      if (!DELEGATABLE_WORK_TOOLS.has(input.tool)) {
        return
      }

      const sessionID = input.sessionID
      if (!sessionID) {
        return
      }

      // Check if this is an orchestrator session
      const sessionAgent = getSessionAgent(sessionID)
      if (!sessionAgent || !ORCHESTRATOR_AGENTS.has(sessionAgent)) {
        return
      }

      // Only remind once per session
      if (remindedSessions.has(sessionID)) {
        return
      }

      // Mark as reminded and inject the reminder
      remindedSessions.add(sessionID)
      output.message = (output.message || "") + CATEGORY_SKILL_REMINDER

      log(`[${HOOK_NAME}] Injected category-skill reminder`, {
        sessionID,
        agent: sessionAgent,
        tool: input.tool,
      })
    },

    // Clean up when session ends
    event: async (input: { type: string; session?: { id?: string } }): Promise<void> => {
      if (input.type === "session.deleted" && input.session?.id) {
        remindedSessions.delete(input.session.id)
      }
    },
  }
}
