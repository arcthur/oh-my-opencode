import type { RuntimeExecutionNode } from "../types"
import type {
  CommandExecuteBeforeInput,
  CommandExecuteBeforeOutput,
  RuntimeAssemblyContext,
} from "./types"

export function buildCommandExecuteBeforeNodes(
  context: RuntimeAssemblyContext,
  input: CommandExecuteBeforeInput,
  output: CommandExecuteBeforeOutput
): RuntimeExecutionNode[] {
  const nodes: RuntimeExecutionNode[] = []

  if (context.autoSlashCommand?.["command.execute.before"]) {
    nodes.push({
      id: "auto-slash-command:command.execute.before",
      invoke: async () => {
        await context.autoSlashCommand?.["command.execute.before"]?.(input, output)
      },
    })
  }

  return nodes
}
