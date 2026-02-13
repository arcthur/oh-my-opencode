import { describe, expect, test } from "bun:test"
import { SessionExecutionBudgetManager } from "../../../features/policy-runtime"
import { buildToolExecuteAfterNodes } from "./tool-execute-after"
import type { RuntimeAssemblyContext } from "./types"

describe("tool.execute.after execution budget", () => {
  test("injects context pressure hint when near hard limit", async () => {
    const context: RuntimeAssemblyContext = {
      executionBudgetManager: new SessionExecutionBudgetManager({
        pressureRatio: 0.9,
      }),
      executionBudgetLimits: {
        maxToolCalls: 30,
        wallClockMs: 120000,
        contextTokensHardLimit: 100,
      },
      policyRuntime: {
        observe: async () => {},
        enforce: async () => [],
      },
    }

    context.executionBudgetManager?.admitToolCall("session-pressure", {
      maxToolCalls: 30,
      wallClockMs: 120000,
      contextTokensHardLimit: 100,
    })

    const output = {
      title: "read",
      output: "ok",
      metadata: {
        total_tokens: 95,
      } as Record<string, unknown>,
    }

    const nodes = buildToolExecuteAfterNodes(
      context,
      {
        tool: "Read",
        sessionID: "session-pressure",
        callID: "call-1",
      },
      output
    )
    const enforce = nodes.find((node) => node.id === "internal:policy-enforce:tool.execute.after")
    expect(enforce).toBeDefined()

    await enforce?.invoke()

    expect(output.output).toContain("Context pressure is high")
    expect(output.metadata.policyContextPressure).toBe(true)
  })
})
