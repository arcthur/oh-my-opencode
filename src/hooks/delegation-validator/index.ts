import type { PluginInput } from "@opencode-ai/plugin"
import {
  extractDelegationDecision,
  validateDelegationDecision,
  formatValidationWarnings,
} from "../../delegation/validator"
import { log } from "../../shared/logger"

export const HOOK_NAME = "delegation-validator"

interface OpenCodeSessionMessage {
  id?: string
  info?: {
    role?: string
    sessionID?: string
  }
  parts?: Array<{
    type: string
    text?: string
  }>
}

interface ToolExecuteBeforeInput {
  tool: string
  sessionID?: string
  callID?: string
}

interface ToolExecuteBeforeOutput {
  args: Record<string, unknown>
  message?: string
}

const MISSING_DECISION_WARNING = `
<system-reminder type="delegation-warning">
**No \`<delegation-decision>\` block found before this delegate_task call.**

Please output the structured JSON decision block BEFORE calling delegate_task:

\`\`\`
<delegation-decision>
{
  "agent": "...",
  "taskType": "...",
  "complexity": "...",
  "domain": "...",
  "reason": "...",
  "signals": [...]
}
</delegation-decision>
\`\`\`

This helps validate your delegation choice and provides traceability.
</system-reminder>
`

/**
 * Delegation Validator Hook
 *
 * Validates delegate_task delegation decisions by:
 * 1. Checking for <delegation-decision> JSON block in recent assistant output
 * 2. Validating the decision against agent capabilities
 * 3. Injecting warnings if decision seems suboptimal
 */
export function createDelegationValidatorHook(ctx: PluginInput) {

  /**
   * Get the last assistant message text from a session
   */
  async function getLastAssistantText(sessionID: string): Promise<string | null> {
    try {
      const response = await Promise.race([
        ctx.client.session.messages({
          path: { id: sessionID },
          query: { directory: ctx.directory },
        }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("API timeout")), 5000)
        ),
      ])

      const payload = response as { data?: unknown[] } | unknown[]
      const messages = Array.isArray(payload) ? payload : (payload.data ?? [])
      if (!Array.isArray(messages)) return null

      const assistantMessages = (messages as OpenCodeSessionMessage[]).filter(
        (msg) => msg.info?.role === "assistant"
      )
      const lastAssistant = assistantMessages[assistantMessages.length - 1]
      if (!lastAssistant?.parts) return null

      return lastAssistant.parts
        .filter((p) => p.type === "text")
        .map((p) => p.text ?? "")
        .join("\n")
    } catch (error) {
      log(`[${HOOK_NAME}] Failed to get last assistant message`, { error, sessionID })
      return null
    }
  }

  return {
    "tool.execute.before": async (
      input: ToolExecuteBeforeInput,
      output: ToolExecuteBeforeOutput
    ): Promise<void> => {
      // Only validate delegate_task calls
      if (input.tool !== "delegate_task") {
        return
      }

      const sessionID = input.sessionID
      if (!sessionID) {
        return
      }

      // Get the last assistant message to check for delegation decision
      const lastText = await getLastAssistantText(sessionID)
      if (!lastText) {
        log(`[${HOOK_NAME}] Could not retrieve last assistant message`, { sessionID })
        return
      }

      // Try to extract delegation decision
      const decision = extractDelegationDecision(lastText)

      if (!decision) {
        // No decision block found - inject a reminder
        output.message = (output.message || "") + MISSING_DECISION_WARNING
        log(`[${HOOK_NAME}] No delegation-decision block found`, {
          sessionID,
          tool: input.tool,
        })
        return
      }

      // Validate the decision
      const result = validateDelegationDecision(decision)

      if (!result.valid) {
        const warningText = formatValidationWarnings(result.warnings)
        const warning = `
<system-reminder type="delegation-warning">
**Potential issues with delegation choice:**

${warningText}

Proceeding anyway. Consider re-evaluating if results are unsatisfactory.
</system-reminder>
`
        output.message = (output.message || "") + warning

        log(`[${HOOK_NAME}] Delegation decision has warnings`, {
          sessionID,
          agent: decision.agent,
          taskType: decision.taskType,
          warnings: result.warnings.length,
        })
      } else {
        log(`[${HOOK_NAME}] Delegation decision validated successfully`, {
          sessionID,
          agent: decision.agent,
          taskType: decision.taskType,
          complexity: decision.complexity,
          domain: decision.domain,
        })
      }
    },
  }
}
