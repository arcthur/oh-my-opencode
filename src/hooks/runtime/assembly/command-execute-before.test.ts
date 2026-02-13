import { describe, expect, test } from "bun:test"
import { buildCommandExecuteBeforeNodes } from "./command-execute-before"
import type {
  CommandExecuteBeforeInput,
  CommandExecuteBeforeOutput,
  RuntimeAssemblyContext,
} from "./types"

describe("command.execute.before runtime assembly", () => {
  test("builds auto-slash-command node when hook is available", async () => {
    // #given
    const calls: Array<{ input: CommandExecuteBeforeInput; output: CommandExecuteBeforeOutput }> = []
    const context: RuntimeAssemblyContext = {
      autoSlashCommand: {
        "command.execute.before": async (input, output) => {
          calls.push({ input, output })
        },
      },
    }
    const input: CommandExecuteBeforeInput = {
      command: "/foo",
      sessionID: "session-1",
      arguments: "--dry-run",
    }
    const output: CommandExecuteBeforeOutput = {
      parts: [],
    }

    // #when
    const nodes = buildCommandExecuteBeforeNodes(context, input, output)
    await nodes[0]?.invoke()

    // #then
    expect(nodes.map((node) => node.id)).toEqual(["auto-slash-command:command.execute.before"])
    expect(calls).toEqual([{ input, output }])
  })

  test("returns empty node list when auto-slash-command hook is unavailable", () => {
    // #given
    const context: RuntimeAssemblyContext = {}

    // #when
    const nodes = buildCommandExecuteBeforeNodes(context, {
      command: "/foo",
      sessionID: "session-1",
      arguments: "",
    }, {
      parts: [],
    })

    // #then
    expect(nodes).toHaveLength(0)
  })
})
