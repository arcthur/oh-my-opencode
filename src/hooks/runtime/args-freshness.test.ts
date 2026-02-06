import { describe, expect, test } from "bun:test"
import { HookRuntimeDispatcher } from "./dispatcher"
import { EVENT_TOTAL_ORDER } from "./pipeline-order"

describe("args freshness", () => {
  test("tool.execute.after reads final args after earlier node mutation", async () => {
    const dispatcher = new HookRuntimeDispatcher({ order: EVENT_TOTAL_ORDER })

    const state: {
      args: Record<string, unknown>
      metadata: { args?: Record<string, unknown> }
    } = {
      args: { mode: "legacy" },
      metadata: { args: { mode: "legacy" } },
    }

    let seenMode = "unknown"

    await dispatcher.dispatch("tool.execute.after", [
      {
        id: "planning-with-files:tool.execute.after",
        invoke: async () => {
          state.args.mode = "final"
          if (state.metadata.args) {
            state.metadata.args.mode = "final"
          }
        },
      },
      {
        id: "internal:governance-post-tool:tool.execute.after",
        invoke: async () => {
          seenMode = String(state.metadata.args?.mode ?? state.args.mode)
        },
      },
    ])

    expect(seenMode).toBe("final")
  })
})
