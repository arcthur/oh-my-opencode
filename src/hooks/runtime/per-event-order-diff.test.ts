import { describe, expect, test } from "bun:test"
import { EVENT_TOTAL_ORDER } from "./pipeline-order"

describe("per-event order differences", () => {
  test("chat.message no longer includes multi-plan-trigger", () => {
    const chat = EVENT_TOTAL_ORDER["chat.message"]

    expect(chat).not.toContain("multi-plan-trigger:chat.message")
  })

  test("work-orchestrator has different relative positions across before/after", () => {
    const before = EVENT_TOTAL_ORDER["tool.execute.before"]
    const after = EVENT_TOTAL_ORDER["tool.execute.after"]

    const beforeIndex = before.indexOf("work-orchestrator:tool.execute.before")
    const afterIndex = after.indexOf("work-orchestrator:tool.execute.after")

    expect(beforeIndex).toBeGreaterThan(-1)
    expect(afterIndex).toBeGreaterThan(-1)
    expect(afterIndex).toBeLessThan(beforeIndex)
  })

  test("silent-tool-output is last in before but early in after", () => {
    const before = EVENT_TOTAL_ORDER["tool.execute.before"]
    const after = EVENT_TOTAL_ORDER["tool.execute.after"]

    const beforeIndex = before.indexOf("silent-tool-output:tool.execute.before")
    const afterIndex = after.indexOf("silent-tool-output:tool.execute.after")

    expect(beforeIndex).toBe(before.length - 1)
    expect(afterIndex).toBeGreaterThan(-1)
    expect(afterIndex).toBeLessThan(4)
  })
})
