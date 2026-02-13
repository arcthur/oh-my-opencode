import { describe, test, expect } from "bun:test"
import {
  getAgentToolRestrictions,
  hasAgentToolRestrictions,
  RESEARCH_SCOPED_AGENTS,
  RESEARCH_ALLOWED_AGENTS,
} from "./agent-tool-restrictions"

describe("agent-tool-restrictions", () => {
  describe("RESEARCH_SCOPED_AGENTS", () => {
    test("specialist is research-scoped", () => {
      // #given/#then
      expect(RESEARCH_SCOPED_AGENTS.has("specialist")).toBe(true)
    })

    test("orchestrator is not research-scoped", () => {
      expect(RESEARCH_SCOPED_AGENTS.has("orchestrator")).toBe(false)
    })

    test("planner is not research-scoped", () => {
      expect(RESEARCH_SCOPED_AGENTS.has("planner")).toBe(false)
    })
  })

  describe("RESEARCH_ALLOWED_AGENTS", () => {
    test("navigator is allowed in research mode", () => {
      expect(RESEARCH_ALLOWED_AGENTS.has("navigator")).toBe(true)
    })

    test("librarian is allowed in research mode", () => {
      expect(RESEARCH_ALLOWED_AGENTS.has("librarian")).toBe(true)
    })

    test("advisor is not allowed in research mode", () => {
      expect(RESEARCH_ALLOWED_AGENTS.has("advisor")).toBe(false)
    })
  })

  describe("getAgentToolRestrictions", () => {
    test("specialist has task denied but not delegate_task", () => {
      // #given/#when
      const restrictions = getAgentToolRestrictions("specialist")

      // #then
      expect(restrictions.task).toBe(false)
      expect(restrictions.delegate_task).toBeUndefined()
    })

    test("navigator has delegate_task denied", () => {
      const restrictions = getAgentToolRestrictions("navigator")
      expect(restrictions.delegate_task).toBe(false)
    })
  })

  describe("hasAgentToolRestrictions", () => {
    test("returns true for specialist", () => {
      expect(hasAgentToolRestrictions("specialist")).toBe(true)
    })

    test("returns false for unknown agents", () => {
      expect(hasAgentToolRestrictions("nonexistent")).toBe(false)
    })
  })
})
