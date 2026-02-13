import { describe, test, expect } from "bun:test"
import { buildDynamicPlannerPrompt, PLANNER_SYSTEM_PROMPT } from "./planner"

describe("PLANNER_SYSTEM_PROMPT planning policy", () => {
  test("should describe high accuracy using reviewer iterative review", () => {
    // #given
    const prompt = PLANNER_SYSTEM_PROMPT.toLowerCase()
    // #when / #then
    expect(prompt).toMatch(/high accuracy[\s\S]*reviewer|reviewer[\s\S]*high accuracy/)
  })

  test("should reference scope-analyst and reviewer as part of the planning pipeline", () => {
    // #given
    const prompt = PLANNER_SYSTEM_PROMPT.toLowerCase()

    // #when / #then
    expect(prompt).toMatch(/\bscope-analyst\b/)
    expect(prompt).toMatch(/\breviewer\b/)
  })

  test("should not reference removed multi-plan toolchain", () => {
    // #given
    const prompt = PLANNER_SYSTEM_PROMPT.toLowerCase()

    // #when / #then
    expect(prompt).not.toContain("multi_plan")
    expect(prompt).not.toContain("plan-synthesizer")
    expect(prompt).not.toContain("multi-model planning")
  })

  test("should not reference boulder-state (fork uses work-state)", () => {
    // #given
    const prompt = PLANNER_SYSTEM_PROMPT.toLowerCase()

    // #when / #then
    expect(prompt).not.toMatch(/\bboulder\b/)
    expect(prompt).toContain(".orchestrator/work.yaml")
  })

  test("should require assumptions and risks in the plan template", () => {
    // #given
    const prompt = PLANNER_SYSTEM_PROMPT.toLowerCase()

    // #when / #then
    expect(prompt).toContain("assumptions (required)")
    expect(prompt).toContain("risks (required)")
  })

  test("should require scenario references in task definitions", () => {
    // #given
    const prompt = PLANNER_SYSTEM_PROMPT.toLowerCase()

    // #when / #then
    expect(prompt).toContain("scenario ref")
  })

  test("should include brainstorming mode invariants for non-trivial work", () => {
    // #given
    const prompt = PLANNER_SYSTEM_PROMPT.toLowerCase()

    // #when / #then
    expect(prompt).toContain("phase 0")
    expect(prompt).toContain("one question at a time")
    expect(prompt).toMatch(/2\s*-\s*3/)
    expect(prompt).toContain(".orchestrator/designs/")
  })

  test("should gate plan generation behind brainstorming design docs for non-trivial work", () => {
    // #given
    const prompt = PLANNER_SYSTEM_PROMPT.toLowerCase()

    // #when / #then
    expect(prompt).toContain("phase 2 entry preconditions")
    expect(prompt).toContain(".orchestrator/designs/")
  })

  test("should require mandatory scope-analyst preflight before plan generation", () => {
    // #given
    const prompt = PLANNER_SYSTEM_PROMPT.toLowerCase()

    // #when / #then
    expect(prompt).toContain("pre-generation: scope-analyst consultation (mandatory)")
    expect(prompt).toContain("before generating the plan")
    expect(prompt).toContain("consult scope-analyst for gap analysis")
  })

  test("should support phase-lazy prompt building for interview mode", () => {
    // #given
    const interviewPrompt = buildDynamicPlannerPrompt({ phase: "interview" })
    const fullPrompt = buildDynamicPlannerPrompt({ phase: "full" })

    // #when / #then
    expect(interviewPrompt.length).toBeLessThan(fullPrompt.length)
    expect(interviewPrompt.length).toBeLessThan(Math.floor(fullPrompt.length * 0.7))
    expect(interviewPrompt.toLowerCase()).not.toContain("## plan structure")
    expect(fullPrompt.toLowerCase()).toContain("## plan structure")
  })
})
