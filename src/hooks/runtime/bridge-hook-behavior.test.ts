import { describe, expect, test } from "bun:test"
import { HookRuntimeDispatcher } from "./dispatcher"
import { EVENT_TOTAL_ORDER } from "./pipeline-order"

describe("bridge hook behavior", () => {
  test("keeps claude-code bridge as single ordered node", async () => {
    const calls: string[] = []
    const dispatcher = new HookRuntimeDispatcher({
      order: EVENT_TOTAL_ORDER,
    })

    await dispatcher.dispatch("tool.execute.before", [
      {
        id: "bridge:claude-code-hooks:tool.execute.before",
        invoke: async () => {
          calls.push("bridge")
        },
      },
      {
        id: "work-orchestrator:tool.execute.before",
        invoke: async () => {
          calls.push("work-orchestrator")
        },
      },
    ])

    expect(calls).toEqual(["bridge", "work-orchestrator"])
  })
})
