import type { RuntimeExecutionNode } from "../types"
import type {
  ExperimentalChatTransformOutput,
  RuntimeAssemblyContext,
} from "./types"

function resolveTransformSessionID(output: ExperimentalChatTransformOutput): string {
  const maybeSessionID = (output.messages[0]?.info as { sessionID?: string } | undefined)?.sessionID
  if (typeof maybeSessionID === "string" && maybeSessionID.length > 0) {
    return maybeSessionID
  }
  return "unknown"
}

export function buildExperimentalChatTransformNodes(
  context: RuntimeAssemblyContext,
  input: Record<string, never>,
  output: ExperimentalChatTransformOutput
): RuntimeExecutionNode[] {
  const nodes: RuntimeExecutionNode[] = []

  if (context.contextInjectorMessagesTransform?.["experimental.chat.messages.transform"]) {
    nodes.push({
      id: "internal:context-injector:experimental.chat.messages.transform",
      invoke: async () => {
        await context.contextInjectorMessagesTransform?.[
          "experimental.chat.messages.transform"
        ]?.(input, output)
      },
    })
  }

  nodes.push({
    id: "internal:policy-observe:experimental.chat.messages.transform",
    failurePolicy: "fail-open",
    invoke: async () => {
      const sessionID = resolveTransformSessionID(output)
      await context.policyRuntime?.observe?.({
        hookPoint: "experimental.chat.messages.transform",
        sessionID,
        payload: {
          messageCount: output.messages.length,
        },
        traceHookNodeId: "internal:policy-observe:experimental.chat.messages.transform",
      })
    },
  })

  nodes.push({
    id: "internal:policy-enforce:experimental.chat.messages.transform",
    failurePolicy: "fail-closed",
    invoke: async () => {
      const sessionID = resolveTransformSessionID(output)
      const decisions = await context.policyRuntime?.enforce?.({
        hookPoint: "experimental.chat.messages.transform",
        sessionID,
        payload: {
          messageCount: output.messages.length,
        },
        traceHookNodeId: "internal:policy-enforce:experimental.chat.messages.transform",
      })

      if (!decisions || decisions.length === 0) {
        return
      }

      for (const decision of decisions) {
        if (decision.decision === "deny" && decision.enforcement === "hard") {
          throw new Error(decision.message ?? "Policy denied experimental.chat.messages.transform")
        }
      }
    },
  })

  if (context.thinkingBlockValidator?.["experimental.chat.messages.transform"]) {
    nodes.push({
      id: "thinking-block-validator:experimental.chat.messages.transform",
      invoke: async () => {
        await context.thinkingBlockValidator?.[
          "experimental.chat.messages.transform"
        ]?.(input, output)
      },
    })
  }

  return nodes
}
