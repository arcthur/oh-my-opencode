import { executeUserPromptGovernance } from "../../../features/governance"
import { log } from "../../../shared"
import type { RuntimeExecutionNode } from "../types"
import type {
  ChatMessageInput,
  ChatMessageOutput,
  RuntimeAssemblyContext,
} from "./types"

const DEFAULT_GOVERNANCE_BLOCK_PREFIX = "Governance blocked:"

export function buildChatMessageNodes(
  context: RuntimeAssemblyContext,
  input: ChatMessageInput,
  output: ChatMessageOutput
): RuntimeExecutionNode[] {
  const nodes: RuntimeExecutionNode[] = [
    {
      id: "internal:session-agent-tracking:chat.message",
      invoke: async () => {
        context.contextCollector?.beginTurn(input.sessionID)
        if (input.agent) {
          context.updateSessionAgent?.(input.sessionID, input.agent)
        }
      },
    },
    {
      id: "internal:first-message-variant:chat.message",
      invoke: async () => {
        const message = output.message
        const gate = context.firstMessageVariantGate
        if (!gate || !context.pluginConfig) {
          return
        }

        if (gate.shouldOverride(input.sessionID)) {
          const variant = context.resolveAgentVariant?.(context.pluginConfig, input.agent)
          if (variant !== undefined) {
            message.variant = variant
          }
          gate.markApplied(input.sessionID)
        } else {
          context.applyAgentVariant?.(context.pluginConfig, input.agent, message)
        }
      },
    },
  ]

  if (context.thinkMode?.["chat.params"]) {
    nodes.push({
      id: "think-mode:chat.message",
      invoke: async () => {
        await context.thinkMode?.["chat.params"]?.(
          {
            parts: output.parts,
            message: {
              model:
                (output.message as unknown as { model?: { providerID: string; modelID: string } })
                  .model,
            },
          },
          input.sessionID
        )
      },
    })
  }

  if (context.keywordDetector?.["chat.message"]) {
    nodes.push({
      id: "keyword-detector:chat.message",
      invoke: async () => {
        await context.keywordDetector?.["chat.message"]?.(input, output)
      },
    })
  }

  if (context.sisyphusContextualInjector?.["chat.message"]) {
    nodes.push({
      id: "sisyphus-contextual-injector:chat.message",
      invoke: async () => {
        await context.sisyphusContextualInjector?.["chat.message"]?.(input, output)
      },
    })
  }

  if (context.claudeCodeBridgeEnabled && context.claudeCodeHooks?.["chat.message"]) {
    nodes.push({
      id: "bridge:claude-code-hooks:chat.message",
      invoke: async () => {
        await context.claudeCodeHooks?.["chat.message"]?.(input, output)
      },
    })
  }

  if (context.governanceEnabled) {
    nodes.push({
      id: "internal:governance-user-prompt:chat.message",
      failurePolicy: "fail-closed",
      invoke: async () => {
        try {
          const prompt =
            output.parts
              .filter((part) => part.type === "text" && part.text)
              .map((part) => part.text)
              .join("\n")
              .trim() || ""

          const estimatedTokens = Math.ceil(prompt.length / 4)

          const govResult = executeUserPromptGovernance({
            sessionId: input.sessionID,
            prompt,
            cwd: context.directory ?? process.cwd(),
            estimatedTokens,
            config: context.governanceConfig,
          })

          if (govResult.block) {
            throw new Error(
              `${context.governanceBlockPrefix ?? DEFAULT_GOVERNANCE_BLOCK_PREFIX} ${
                govResult.reason ?? "Prompt blocked"
              }`
            )
          }

          if (govResult.messages.length > 0) {
            const govContent = govResult.messages.join("\n\n")
            context.contextCollector?.register(input.sessionID, {
              id: "governance-budget-context",
              source: "custom",
              content: govContent,
              priority: "low",
            })
            log("[governance] Budget context injected", {
              sessionID: input.sessionID,
              phase: govResult.budgetStatus ? "active" : "normal",
            })
          }
        } catch (err) {
          if (
            err instanceof Error
            && err.message.startsWith(
              context.governanceBlockPrefix ?? DEFAULT_GOVERNANCE_BLOCK_PREFIX
            )
          ) {
            throw err
          }
          log("[governance] User prompt error (non-fatal)", {
            sessionID: input.sessionID,
            error: err instanceof Error ? err.message : String(err),
          })
        }
      },
    })
  }

  if (context.sessionHandoffHook?.["chat.message"]) {
    nodes.push({
      id: "session-handoff:chat.message",
      invoke: async () => {
        await context.sessionHandoffHook?.["chat.message"]?.(input, output)
      },
    })
  }

  if (context.autoSlashCommand?.["chat.message"]) {
    nodes.push({
      id: "auto-slash-command:chat.message",
      invoke: async () => {
        await context.autoSlashCommand?.["chat.message"]?.(input, output)
      },
    })
  }

  if (context.startWork?.["chat.message"]) {
    nodes.push({
      id: "start-work:chat.message",
      invoke: async () => {
        await context.startWork?.["chat.message"]?.(input, output)
      },
    })
  }

  if (context.swarmFromPlan?.["chat.message"]) {
    nodes.push({
      id: "swarm-from-plan:chat.message",
      invoke: async () => {
        await context.swarmFromPlan?.["chat.message"]?.(input, output)
      },
    })
  }

  if (context.planningWithFiles?.["chat.message"]) {
    nodes.push({
      id: "planning-with-files:chat.message",
      invoke: async () => {
        await context.planningWithFiles?.["chat.message"]?.(input, output)
      },
    })
  }

  if (context.preCompletionVerification?.["chat.message"]) {
    nodes.push({
      id: "pre-completion-verification:chat.message",
      invoke: async () => {
        await context.preCompletionVerification?.["chat.message"]?.(input, output)
      },
    })
  }

  if (context.continuationStopGuard?.["chat.message"]) {
    nodes.push({
      id: "continuation-stop-guard:chat.message",
      invoke: async () => {
        await context.continuationStopGuard?.["chat.message"]?.({ sessionID: input.sessionID })
      },
    })
  }

  if (context.ralphLoop) {
    nodes.push({
      id: "internal:ralph-loop-template:chat.message",
      invoke: async () => {
        const promptText =
          output.parts
            .filter((part) => part.type === "text" && part.text)
            .map((part) => part.text)
            .join("\n")
            .trim() || ""

        const isRalphLoopTemplate =
          promptText.includes("You are starting a Ralph Loop")
          && promptText.includes("<user-task>")
        const isCancelRalphTemplate = promptText.includes(
          "Cancel the currently active Ralph Loop"
        )

        if (isRalphLoopTemplate) {
          const taskMatch = promptText.match(/<user-task>\s*([\s\S]*?)\s*<\/user-task>/i)
          const rawTask = taskMatch?.[1]?.trim() || ""

          const quotedMatch = rawTask.match(/^["'](.+?)["']/)
          const prompt =
            quotedMatch?.[1]
            || rawTask.split(/\s+--/)[0]?.trim()
            || "Complete the task as instructed"

          const maxIterMatch = rawTask.match(/--max-iterations=(\d+)/i)
          const promiseMatch = rawTask.match(/--completion-promise=["']?([^"'\s]+)["']?/i)

          log("[ralph-loop] Starting loop from chat.message", {
            sessionID: input.sessionID,
            prompt,
          })
          context.ralphLoop?.startLoop(input.sessionID, prompt, {
            maxIterations: maxIterMatch ? parseInt(maxIterMatch[1], 10) : undefined,
            completionPromise: promiseMatch?.[1],
          })
        } else if (isCancelRalphTemplate) {
          log("[ralph-loop] Cancelling loop from chat.message", {
            sessionID: input.sessionID,
          })
          context.ralphLoop?.cancelLoop(input.sessionID)
        }
      },
    })
  }

  return nodes
}
