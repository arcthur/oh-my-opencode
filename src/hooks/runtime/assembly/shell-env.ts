import { NON_INTERACTIVE_ENV } from "../../non-interactive-env/constants"
import type { RuntimeExecutionNode } from "../types"
import type { RuntimeAssemblyContext, ShellEnvOutput } from "./types"

export function buildShellEnvNodes(
  context: RuntimeAssemblyContext,
  output: ShellEnvOutput
): RuntimeExecutionNode[] {
  if (!context.nonInteractiveEnv) {
    return []
  }

  return [{
    id: "internal:non-interactive-env:shell.env",
    invoke: async () => {
      Object.assign(output.env, NON_INTERACTIVE_ENV)
    },
  }]
}
