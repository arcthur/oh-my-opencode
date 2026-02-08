import type { RuntimeExecutionNode } from "../types"
import type {
  ExperimentalSessionCompactingInput,
  ExperimentalSessionCompactingOutput,
  RuntimeAssemblyContext,
} from "./types"

export function buildExperimentalSessionCompactingNodes(
  context: RuntimeAssemblyContext,
  input: ExperimentalSessionCompactingInput,
  output?: ExperimentalSessionCompactingOutput
): RuntimeExecutionNode[] {
  const nodes: RuntimeExecutionNode[] = []

  if (
    context.claudeCodeBridgeEnabled
    && output
    && Array.isArray(output.context)
    && context.claudeCodeHooks?.["experimental.session.compacting"]
  ) {
    nodes.push({
      id: "bridge:claude-code-hooks:experimental.session.compacting",
      invoke: async () => {
        await context.claudeCodeHooks?.["experimental.session.compacting"]?.(input, output)
      },
    })
  }

  if (context.contextWindowGovernor?.["experimental.session.compacting"]) {
    nodes.push({
      id: "context-window-governor:experimental.session.compacting",
      invoke: async () => {
        await context.contextWindowGovernor?.["experimental.session.compacting"]?.(input, output)
      },
    })
  }

  return nodes
}
