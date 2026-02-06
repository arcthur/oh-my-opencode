import { describe, expect, test } from "bun:test"
import { EVENT_TOTAL_ORDER } from "./pipeline-order"

describe("per-event order differences", () => {
  test("planning-with-files has different relative positions across before/after", () => {
    const before = EVENT_TOTAL_ORDER["tool.execute.before"]
    const after = EVENT_TOTAL_ORDER["tool.execute.after"]

    const beforeIndex = before.indexOf("planning-with-files:tool.execute.before")
    const afterIndex = after.indexOf("planning-with-files:tool.execute.after")

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
