import { describe, expect, test } from "bun:test"
import { loadBuiltinCommands } from "./commands"

describe("builtin /start-work command", () => {
  test("uses workflow-automator as execution orchestrator", () => {
    // #given
    const commands = loadBuiltinCommands()

    // #when
    const startWork = commands["start-work"]

    // #then
    expect(startWork).toBeDefined()
    expect(startWork.agent).toBe("workflow-automator")
    expect(startWork.description).toContain("workflow-automator execution session")
  })
})

describe("builtin /brainstorm command", () => {
  test("uses planner as planner and brainstorm entrypoint", () => {
    // #given
    const commands = loadBuiltinCommands()

    // #when
    const brainstorm = commands["brainstorm"]

    // #then
    expect(brainstorm).toBeDefined()
    expect(brainstorm.agent).toBe("planner")
    expect(brainstorm.description).toContain("brainstorm")
  })
})

describe("builtin /cartography command", () => {
  test("loads deterministic cartography command template", () => {
    // #given
    const commands = loadBuiltinCommands()

    // #when
    const cartography = commands["cartography"]

    // #then
    expect(cartography).toBeDefined()
    expect(cartography.description).toContain("codemap")
    expect(cartography.template).toContain("/cartography init")
  })
})
