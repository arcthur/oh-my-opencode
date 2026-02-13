import { describe, expect, test } from "bun:test"
import { SCOPE_ANALYST_SYSTEM_PROMPT } from "./scope-analyst"

describe("SCOPE_ANALYST_SYSTEM_PROMPT contract", () => {
  test("treats planner intent as authoritative and only overrides on mismatch", () => {
    // #given
    const prompt = SCOPE_ANALYST_SYSTEM_PROMPT.toLowerCase()

    // #when / #then
    expect(prompt).toContain("planner intent classification is authoritative")
    expect(prompt).toContain("only override when evidence strongly contradicts")
  })

  test("requires explicit intent validation verdict in output", () => {
    // #given
    const prompt = SCOPE_ANALYST_SYSTEM_PROMPT.toLowerCase()

    // #when / #then
    expect(prompt).toContain("intent validation")
    expect(prompt).toContain("match | override")
  })
})
