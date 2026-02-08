import type { RuntimeExecutionNode } from "../types"
import type { RuntimeAssemblyContext, UserPromptSubmitInput } from "./types"

export function buildUserPromptSubmitNodes(
  context: RuntimeAssemblyContext,
  input: UserPromptSubmitInput
): RuntimeExecutionNode[] {
  const nodes: RuntimeExecutionNode[] = []

  if (context.userMemory?.["user.prompt.submit"]) {
    nodes.push({
      id: "internal:user-memory:user.prompt.submit",
      invoke: async () => {
        await context.userMemory?.["user.prompt.submit"]?.(input)
      },
    })
  }

  if (context.orgMemory?.["user.prompt.submit"]) {
    nodes.push({
      id: "internal:org-memory:user.prompt.submit",
      invoke: async () => {
        await context.orgMemory?.["user.prompt.submit"]?.(input)
      },
    })
  }

  if (context.sessionHandoffHook?.["user.prompt.submit"]) {
    nodes.push({
      id: "session-handoff:user.prompt.submit",
      invoke: async () => {
        await context.sessionHandoffHook?.["user.prompt.submit"]?.(input)
      },
    })
  }

  return nodes
}
