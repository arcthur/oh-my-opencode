import type { PluginInput } from "@opencode-ai/plugin"
import { isCallerOrchestrator } from "../../shared/session-utils"
import { log } from "../../shared/logger"
import { HOOK_NAME, NOTEPAD_DIRECTIVE } from "./constants"

export * from "./constants"

export function createSisyphusJuniorNotepadHook(ctx: PluginInput) {
  return {
    "tool.execute.before": async (
      input: { tool: string; sessionID: string; callID: string },
      output: { args: Record<string, unknown>; message?: string }
    ): Promise<void> => {
      void ctx

      // 1. Check if tool is delegate_task
      if (input.tool !== "delegate_task") {
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
      const prompt = typeof output.args.prompt === "string" ? output.args.prompt : ""

      // 5. Check for double injection
      if (prompt.includes("<Work_Context>")) {
        return
      }

      // 6. Prepend directive
      output.args.prompt = NOTEPAD_DIRECTIVE + prompt

      // 7. Log injection
      log(`[${HOOK_NAME}] Injected notepad directive to delegate_task`, {
        sessionID: input.sessionID,
      })
    },
  }
}
