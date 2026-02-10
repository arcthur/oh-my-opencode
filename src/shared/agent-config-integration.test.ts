import { describe, test, expect } from "bun:test"
import { getAgentDisplayName } from "./agent-display-names"
import { AGENT_MODEL_REQUIREMENTS } from "./model-requirements"

describe("Agent Config Integration", () => {
  describe("Display name resolution", () => {
    test("returns correct display names for builtin agents", () => {
      // given
      const agents = [
        "sisyphus",
        "hephaestus",
        "prometheus",
        "metis",
        "momus",
        "oracle",
        "librarian",
        "explore",
        "multimodal-looker",
      ]

      // when
      const displayNames = agents.map((agent) => getAgentDisplayName(agent))

      // then
      expect(displayNames).toContain("Sisyphus (Ultraworker)")
      expect(displayNames).toContain("Hephaestus (Autonomous Deep Worker)")
      expect(displayNames).toContain("Prometheus (Plan Builder)")
      expect(displayNames).toContain("Metis (Pre-Planning Consultant)")
      expect(displayNames).toContain("Momus (Plan Reviewer)")
      expect(displayNames).toContain("oracle")
      expect(displayNames).toContain("librarian")
      expect(displayNames).toContain("explore")
      expect(displayNames).toContain("multimodal-looker")
    })

    test("handles case-insensitive lookups", () => {
      // given
      const keys = ["Sisyphus", "Hephaestus", "SISYPHUS", "hephaestus", "prometheus", "PROMETHEUS"]

      // when
      const displayNames = keys.map((key) => getAgentDisplayName(key))

      // then
      expect(displayNames[0]).toBe("Sisyphus (Ultraworker)")
      expect(displayNames[1]).toBe("Hephaestus (Autonomous Deep Worker)")
      expect(displayNames[2]).toBe("Sisyphus (Ultraworker)")
      expect(displayNames[3]).toBe("Hephaestus (Autonomous Deep Worker)")
      expect(displayNames[4]).toBe("Prometheus (Plan Builder)")
      expect(displayNames[5]).toBe("Prometheus (Plan Builder)")
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
        "sisyphus",
        "prometheus",
        "metis",
        "momus",
        "hephaestus",
        "oracle",
        "librarian",
        "explore",
        "multimodal-looker",
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
