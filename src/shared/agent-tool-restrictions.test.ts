import { describe, test, expect } from "bun:test"
import {
  getAgentToolRestrictions,
  hasAgentToolRestrictions,
  RESEARCH_SCOPED_AGENTS,
  RESEARCH_ALLOWED_AGENTS,
} from "./agent-tool-restrictions"

describe("agent-tool-restrictions", () => {
  describe("RESEARCH_SCOPED_AGENTS", () => {
    test("sisyphus-junior is research-scoped", () => {
      // #given/#then
      expect(RESEARCH_SCOPED_AGENTS.has("sisyphus-junior")).toBe(true)
    })

    test("sisyphus is not research-scoped", () => {
      expect(RESEARCH_SCOPED_AGENTS.has("sisyphus")).toBe(false)
    })

    test("prometheus is not research-scoped", () => {
      expect(RESEARCH_SCOPED_AGENTS.has("prometheus")).toBe(false)
    })
  })

  describe("RESEARCH_ALLOWED_AGENTS", () => {
    test("explore is allowed in research mode", () => {
      expect(RESEARCH_ALLOWED_AGENTS.has("explore")).toBe(true)
    })

    test("librarian is allowed in research mode", () => {
      expect(RESEARCH_ALLOWED_AGENTS.has("librarian")).toBe(true)
    })

    test("oracle is not allowed in research mode", () => {
      expect(RESEARCH_ALLOWED_AGENTS.has("oracle")).toBe(false)
    })
  })

  describe("getAgentToolRestrictions", () => {
    test("sisyphus-junior has task denied but not delegate_task", () => {
      // #given/#when
      const restrictions = getAgentToolRestrictions("sisyphus-junior")

      // #then
      expect(restrictions.task).toBe(false)
      expect(restrictions.delegate_task).toBeUndefined()
    })

    test("explore has delegate_task denied", () => {
      const restrictions = getAgentToolRestrictions("explore")
      expect(restrictions.delegate_task).toBe(false)
    })
  })

  describe("hasAgentToolRestrictions", () => {
    test("returns true for sisyphus-junior", () => {
      expect(hasAgentToolRestrictions("sisyphus-junior")).toBe(true)
    })

    test("returns false for unknown agents", () => {
      expect(hasAgentToolRestrictions("nonexistent")).toBe(false)
    })
  })
})
