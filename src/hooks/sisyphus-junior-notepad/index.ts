import type { PluginInput } from "@opencode-ai/plugin"
import { injectBudgetedPrompt } from "../../features/context-view"
import { isCallerOrchestrator } from "../../shared/session-utils"
import { log } from "../../shared/logger"
import { HOOK_NAME, NOTEPAD_DIRECTIVE } from "./constants"

export * from "./constants"

export function createSisyphusJuniorNotepadHook(_ctx: PluginInput) {
  return {
    "tool.execute.before": async (
      input: { tool: string; sessionID?: string; callID?: string },
      output: { args: Record<string, unknown>; message?: string }
    ): Promise<void> => {
      // 1. Check if tool is delegate_task
      if (input.tool !== "delegate_task") {
        return
      }

      if (!input.sessionID) {
        return
      }

      // 2. Check if caller is an orchestrator
      if (!isCallerOrchestrator(input.sessionID)) {
        return
      }

      // 3. Only inject for Sisyphus-Junior executions:
      //    - explicit subagent_type="sisyphus-junior"
      //    - category-based delegation (spawns sisyphus-junior)
      const subagentType = output.args.subagent_type
      const hasCategory = typeof output.args.category === "string"
      const isSisyphusJunior =
        typeof subagentType === "string" && subagentType.toLowerCase() === "sisyphus-junior"

      if (!isSisyphusJunior && !hasCategory) {
        return
      }

      // 4. Get prompt from output.args
      const prompt = output.args.prompt
      if (typeof prompt !== "string" || prompt.length === 0) {
        return
      }

      // 5. Check for double injection
      if (prompt.includes("<Work_Context>")) {
        return
      }

      // 6. Prepend directive
      injectBudgetedPrompt({
        output: { args: output.args },
        sessionID: input.sessionID,
        source: HOOK_NAME,
        id: `${input.callID ?? "unknown"}:notepad-directive`,
        priority: "high",
        content: NOTEPAD_DIRECTIVE,
      })

      // 7. Log injection
      log(`[${HOOK_NAME}] Injected notepad directive to delegate_task`, {
        sessionID: input.sessionID,
      })
    },
  }
}
