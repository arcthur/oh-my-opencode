import { describe, test, expect } from "bun:test"
import { PLANNER_BRAINSTORMING_MODE } from "./brainstorming-mode"

describe("PLANNER_BRAINSTORMING_MODE invariants", () => {
  test("should define Phase 0 brainstorming mode", () => {
    // #given
    const mode = PLANNER_BRAINSTORMING_MODE

    // #when / #then
    expect(mode).toContain("PHASE 0")
    expect(mode.toLowerCase()).toContain("brainstorm")
  })

  test("should enforce one-question-at-a-time", () => {
    // #given
    const mode = PLANNER_BRAINSTORMING_MODE.toLowerCase()

    // #when / #then
    expect(mode).toContain("one question at a time")
  })

  test("should require 2-3 approaches exploration", () => {
    // #given
    const mode = PLANNER_BRAINSTORMING_MODE.toLowerCase()

    // #when / #then
    expect(mode).toMatch(/2\s*-\s*3/)
    expect(mode).toContain("approach")
  })

  test("should require incremental design validation sections (200-300 words)", () => {
    // #given
    const mode = PLANNER_BRAINSTORMING_MODE

    // #when / #then
    expect(mode).toContain("200-300")
    expect(mode.toLowerCase()).toContain("sections")
    expect(mode.toLowerCase()).toContain("validate")
  })

  test("should write design docs under .orchestrator/designs/", () => {
    // #given
    const mode = PLANNER_BRAINSTORMING_MODE

    // #when / #then
    expect(mode).toContain(".orchestrator/designs/")
  })

  test("should require recon to inspect project docs and recent commits", () => {
    // #given
    const mode = PLANNER_BRAINSTORMING_MODE.toLowerCase()

    // #when / #then
    expect(mode).toContain("docs")
    expect(mode).toContain("recent commits")
  })

  test("should require design sections to cover architecture/components/data flow/error handling/testing", () => {
    // #given
    const mode = PLANNER_BRAINSTORMING_MODE.toLowerCase()

    // #when / #then
    expect(mode).toContain("architecture")
    expect(mode).toContain("components")
    expect(mode).toContain("data flow")
    expect(mode).toContain("error handling")
    expect(mode).toContain("testing")
  })
})
