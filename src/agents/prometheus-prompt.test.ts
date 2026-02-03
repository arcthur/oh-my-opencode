import { describe, test, expect } from "bun:test"
import { PROMETHEUS_SYSTEM_PROMPT } from "./prometheus"

describe("PROMETHEUS_SYSTEM_PROMPT multi-plan policy", () => {
  test("should reference multi_plan for multi-model planning", () => {
    // #given
    const prompt = PROMETHEUS_SYSTEM_PROMPT.toLowerCase()

    // #when / #then
    expect(prompt).toContain("multi_plan")
  })

  test("should describe debate as the high-accuracy option (when available)", () => {
    // #given
    const prompt = PROMETHEUS_SYSTEM_PROMPT.toLowerCase()

    // #when / #then
    expect(prompt).toMatch(/high accuracy[\s\S]*debate|debate[\s\S]*high accuracy/)
  })

  test("should not reference removed agents (metis/momus)", () => {
    // #given
    const prompt = PROMETHEUS_SYSTEM_PROMPT.toLowerCase()

    // #when / #then
    expect(prompt).not.toMatch(/\bmetis\b/)
    expect(prompt).not.toMatch(/\bmomus\b/)
  })

  test("should require assumptions and risks in the plan template", () => {
    // #given
    const prompt = PROMETHEUS_SYSTEM_PROMPT.toLowerCase()

    // #when / #then
    expect(prompt).toContain("assumptions (required)")
    expect(prompt).toContain("risks (required)")
  })

  test("should include brainstorming mode invariants for non-trivial work", () => {
    // #given
    const prompt = PROMETHEUS_SYSTEM_PROMPT.toLowerCase()

    // #when / #then
    expect(prompt).toContain("phase 0")
    expect(prompt).toContain("one question at a time")
    expect(prompt).toMatch(/2\s*-\s*3/)
    expect(prompt).toContain(".sisyphus/designs/")
  })

  test("should gate plan generation behind brainstorming design docs for non-trivial work", () => {
    // #given
    const prompt = PROMETHEUS_SYSTEM_PROMPT.toLowerCase()

    // #when / #then
    expect(prompt).toContain("phase 2 entry preconditions")
    expect(prompt).toContain(".sisyphus/designs/")
  })
})
