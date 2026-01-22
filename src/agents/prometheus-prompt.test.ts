import { describe, test, expect } from "bun:test"
import { PROMETHEUS_SYSTEM_PROMPT } from "./prometheus-prompt"

describe("PROMETHEUS_SYSTEM_PROMPT multi-plan integration", () => {
  test("should mention multi_plan tool for complex tasks", () => {
    // #given
    const prompt = PROMETHEUS_SYSTEM_PROMPT

    // #when / #then
    // Should mention multi_plan tool
    expect(prompt.toLowerCase()).toMatch(/multi_plan/)
  })

  test("should mention complexity-based routing", () => {
    // #given
    const prompt = PROMETHEUS_SYSTEM_PROMPT

    // #when / #then
    // Should mention complexity levels (trivial/simple/complex)
    expect(prompt.toLowerCase()).toMatch(/trivial|simple|complex/)
  })

  test("should mention debate mode for high accuracy", () => {
    // #given
    const prompt = PROMETHEUS_SYSTEM_PROMPT

    // #when / #then
    // Should mention debate mode
    expect(prompt.toLowerCase()).toMatch(/debate.*true|debate.*mode/)
  })
})
