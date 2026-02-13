import { describe, expect, test } from "bun:test"
import { NON_INTERACTIVE_ENV } from "../../non-interactive-env/constants"
import { buildShellEnvNodes } from "./shell-env"
import type { RuntimeAssemblyContext } from "./types"

describe("shell.env runtime assembly", () => {
  test("injects non-interactive env node when non-interactive hook is enabled", async () => {
    // #given
    const context: RuntimeAssemblyContext = {
      nonInteractiveEnv: {
        "tool.execute.before": async () => {},
      },
    }
    const output = { env: {} as Record<string, string> }

    // #when
    const nodes = buildShellEnvNodes(context, output)
    await nodes[0]?.invoke()

    // #then
    expect(nodes.map((node) => node.id)).toEqual(["internal:non-interactive-env:shell.env"])
    expect(output.env).toMatchObject(NON_INTERACTIVE_ENV)
  })

  test("returns empty node list when non-interactive hook is disabled", () => {
    // #given
    const context: RuntimeAssemblyContext = {}

    // #when
    const nodes = buildShellEnvNodes(context, { env: {} })

    // #then
    expect(nodes).toHaveLength(0)
  })
})
