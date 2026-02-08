import type { RuntimeExecutionNode } from "../types"
import type {
  ExperimentalChatTransformOutput,
  RuntimeAssemblyContext,
} from "./types"

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
