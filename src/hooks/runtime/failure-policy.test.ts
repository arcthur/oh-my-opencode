import { describe, expect, test } from "bun:test"
import { HookRuntimeDispatcher } from "./dispatcher"
import { EVENT_TOTAL_ORDER } from "./pipeline-order"

describe("failure policy", () => {
  test("tool.execute.before fails closed by default", async () => {
    const dispatcher = new HookRuntimeDispatcher({ order: EVENT_TOTAL_ORDER })

    await expect(
      dispatcher.dispatch("tool.execute.before", [
        {
          id: "question-label-truncator:tool.execute.before",
          invoke: async () => {
            throw new Error("boom")
          },
        },
      ])
    ).rejects.toThrow("boom")
  })

  test("event fails open by default", async () => {
    const calls: string[] = []
    const dispatcher = new HookRuntimeDispatcher({ order: EVENT_TOTAL_ORDER })

    await dispatcher.dispatch("event", [
      {
        id: "auto-update-checker:event",
        invoke: async () => {
          throw new Error("ignore")
        },
      },
      {
        id: "internal:core-session-state:event",
        invoke: async () => {
          calls.push("core")
        },
      },
    ])

    expect(calls).toEqual(["core"])
  })

  test("node-level policy override can fail closed on event", async () => {
    const dispatcher = new HookRuntimeDispatcher({ order: EVENT_TOTAL_ORDER })

    await expect(
      dispatcher.dispatch("event", [
        {
          id: "internal:core-session-state:event",
          failurePolicy: "fail-closed",
          invoke: async () => {
            throw new Error("fatal")
          },
        },
      ])
    ).rejects.toThrow("fatal")
  })
})
