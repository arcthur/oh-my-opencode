import { describe, test, expect } from "bun:test"
import { getAgentDisplayName } from "./agent-display-names"
import { AGENT_MODEL_REQUIREMENTS } from "./model-requirements"

describe("Agent Config Integration", () => {
  describe("Display name resolution", () => {
    test("returns correct display names for builtin agents", () => {
      // given
      const agents = [
        "orchestrator",
        "workflow-automator",
        "executor",
        "planner",
        "scope-analyst",
        "reviewer",
        "advisor",
        "librarian",
        "navigator",
        "interpreter",
      ]

      // when
      const displayNames = agents.map((agent) => getAgentDisplayName(agent))

      // then
      expect(displayNames).toContain("orchestrator (Ultraworker)")
      expect(displayNames).toContain("workflow-automator (Execution Orchestrator)")
      expect(displayNames).toContain("executor (Autonomous Deep Worker)")
      expect(displayNames).toContain("planner (Plan Builder)")
      expect(displayNames).toContain("scope-analyst (Pre-Planning Consultant)")
      expect(displayNames).toContain("reviewer (Plan Reviewer)")
      expect(displayNames).toContain("advisor")
      expect(displayNames).toContain("librarian")
      expect(displayNames).toContain("navigator")
      expect(displayNames).toContain("interpreter")
    })

    test("handles case-insensitive lookups", () => {
      // given
      const keys = ["orchestrator", "executor", "ORCHESTRATOR", "executor", "planner", "PLANNER"]

      // when
      const displayNames = keys.map((key) => getAgentDisplayName(key))

      // then
      expect(displayNames[0]).toBe("orchestrator (Ultraworker)")
      expect(displayNames[1]).toBe("executor (Autonomous Deep Worker)")
      expect(displayNames[2]).toBe("orchestrator (Ultraworker)")
      expect(displayNames[3]).toBe("executor (Autonomous Deep Worker)")
      expect(displayNames[4]).toBe("planner (Plan Builder)")
      expect(displayNames[5]).toBe("planner (Plan Builder)")
    })

    test("returns original key for unknown agents", () => {
      // given
      const unknownKey = "custom-agent"

      // when
      const displayName = getAgentDisplayName(unknownKey)

      // then
      expect(displayName).toBe(unknownKey)
    })
  })

  describe("Model requirements integration", () => {
    test("all model requirements use lowercase keys", () => {
      // given
      const agentKeys = Object.keys(AGENT_MODEL_REQUIREMENTS)

      // when
      const allLowercase = agentKeys.every((key) => key === key.toLowerCase())

      // then
      expect(allLowercase).toBe(true)
    })

    test("model requirements include all builtin agents", () => {
      // given
      const expectedAgents = [
        "orchestrator",
        "workflow-automator",
        "planner",
        "scope-analyst",
        "reviewer",
        "executor",
        "advisor",
        "librarian",
        "navigator",
        "interpreter",
      ]

      // when
      const agentKeys = Object.keys(AGENT_MODEL_REQUIREMENTS)

      // then
      for (const agent of expectedAgents) {
        expect(agentKeys).toContain(agent)
      }
    })

    test("has no uppercase keys in model requirements", () => {
      // given
      const agentKeys = Object.keys(AGENT_MODEL_REQUIREMENTS)

      // when
      const uppercaseKeys = agentKeys.filter((key) => key !== key.toLowerCase())

      // then
      expect(uppercaseKeys).toEqual([])
    })
  })
})
