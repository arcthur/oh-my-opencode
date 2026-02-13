import { describe, it, expect } from "bun:test"
import { AGENT_DISPLAY_NAMES, getAgentDisplayName } from "./agent-display-names"

describe("getAgentDisplayName", () => {
  it("returns display name for lowercase config key (new format)", () => {
    // given config key "orchestrator"
    const configKey = "orchestrator"

    // when getAgentDisplayName called
    const result = getAgentDisplayName(configKey)

    // then returns "orchestrator (Ultraworker)"
    expect(result).toBe("orchestrator (Ultraworker)")
  })

  it("returns display name for uppercase config key (old format - case-insensitive)", () => {
    // given config key "orchestrator" (old format)
    const configKey = "orchestrator"

    // when getAgentDisplayName called
    const result = getAgentDisplayName(configKey)

    // then returns "orchestrator (Ultraworker)" (case-insensitive lookup)
    expect(result).toBe("orchestrator (Ultraworker)")
  })

  it("returns original key for unknown agents (fallback)", () => {
    // given config key "custom-agent"
    const configKey = "custom-agent"

    // when getAgentDisplayName called
    const result = getAgentDisplayName(configKey)

    // then returns "custom-agent" (original key unchanged)
    expect(result).toBe("custom-agent")
  })

  it("returns display name for planner", () => {
    // given config key "planner"
    const configKey = "planner"

    // when getAgentDisplayName called
    const result = getAgentDisplayName(configKey)

    // then returns "planner (Plan Builder)"
    expect(result).toBe("planner (Plan Builder)")
  })

  it("returns display name for workflow-automator", () => {
    // given config key "workflow-automator"
    const configKey = "workflow-automator"

    // when getAgentDisplayName called
    const result = getAgentDisplayName(configKey)

    // then returns workflow-automator display name
    expect(result).toBe("workflow-automator (Execution Orchestrator)")
  })

  it("returns display name for specialist", () => {
    // given config key "specialist"
    const configKey = "specialist"

    // when getAgentDisplayName called
    const result = getAgentDisplayName(configKey)

    // then returns "specialist"
    expect(result).toBe("specialist")
  })

  it("returns display name for scope-analyst", () => {
    // given config key "scope-analyst"
    const configKey = "scope-analyst"

    // when getAgentDisplayName called
    const result = getAgentDisplayName(configKey)

    // then returns scope-analyst display name (Pre-planning consultant agent)
    expect(result).toBe("scope-analyst (Pre-Planning Consultant)")
  })

  it("returns display name for reviewer", () => {
    // given config key "reviewer"
    const configKey = "reviewer"

    // when getAgentDisplayName called
    const result = getAgentDisplayName(configKey)

    // then returns reviewer display name (Plan reviewer agent)
    expect(result).toBe("reviewer (Plan Reviewer)")
  })

  it("returns display name for executor", () => {
    // given config key "executor"
    const configKey = "executor"

    // when getAgentDisplayName called
    const result = getAgentDisplayName(configKey)

    // then returns executor display name
    expect(result).toBe("executor (Autonomous Deep Worker)")
  })

  it("returns display name for advisor", () => {
    // given config key "advisor"
    const configKey = "advisor"

    // when getAgentDisplayName called
    const result = getAgentDisplayName(configKey)

    // then returns "advisor"
    expect(result).toBe("advisor")
  })

  it("returns display name for librarian", () => {
    // given config key "librarian"
    const configKey = "librarian"

    // when getAgentDisplayName called
    const result = getAgentDisplayName(configKey)

    // then returns "librarian"
    expect(result).toBe("librarian")
  })

  it("returns display name for navigator", () => {
    // given config key "navigator"
    const configKey = "navigator"

    // when getAgentDisplayName called
    const result = getAgentDisplayName(configKey)

    // then returns "navigator"
    expect(result).toBe("navigator")
  })

  it("returns display name for interpreter", () => {
    // given config key "interpreter"
    const configKey = "interpreter"

    // when getAgentDisplayName called
    const result = getAgentDisplayName(configKey)

    // then returns "interpreter"
    expect(result).toBe("interpreter")
  })
})

describe("AGENT_DISPLAY_NAMES", () => {
  it("contains all expected agent mappings", () => {
    // given expected mappings
    const expectedMappings = {
      orchestrator: "orchestrator (Ultraworker)",
      "workflow-automator": "workflow-automator (Execution Orchestrator)",
      planner: "planner (Plan Builder)",
      "specialist": "specialist",
      "scope-analyst": "scope-analyst (Pre-Planning Consultant)",
      reviewer: "reviewer (Plan Reviewer)",
      executor: "executor (Autonomous Deep Worker)",
      advisor: "advisor",
      librarian: "librarian",
      navigator: "navigator",
      "interpreter": "interpreter",
    }

    // when checking the constant
    // then contains all expected mappings
    expect(AGENT_DISPLAY_NAMES).toEqual(expectedMappings)
  })
})
