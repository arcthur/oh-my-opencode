import { describe, expect, test } from "bun:test"
import { loadBuiltinCommands } from "./commands"

describe("builtin /start-work command", () => {
  test("uses atlas as execution orchestrator", () => {
    // #given
    const commands = loadBuiltinCommands()

    // #when
    const startWork = commands["start-work"]

    // #then
    expect(startWork).toBeDefined()
    expect(startWork.agent).toBe("atlas")
    expect(startWork.description).toContain("Atlas execution session")
  })
})
