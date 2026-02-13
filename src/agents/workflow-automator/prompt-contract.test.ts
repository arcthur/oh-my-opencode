import { describe, expect, test } from "bun:test"
import { getDefaultWorkflowAutomatorPrompt } from "./default"
import { getGptWorkflowAutomatorPrompt } from "./gpt"

describe("workflow-automator prompt contract", () => {
  test("default prompt defines parallel wave policy and retry standard", () => {
    // #given
    const prompt = getDefaultWorkflowAutomatorPrompt().toLowerCase()

    // #when / #then
    expect(prompt).toContain("parallel wave policy")
    expect(prompt).toContain("wave 1")
    expect(prompt).toContain("retry standard")
    expect(prompt).toContain("max 2 retries")
  })

  test("gpt prompt defines parallel wave policy and retry standard", () => {
    // #given
    const prompt = getGptWorkflowAutomatorPrompt().toLowerCase()

    // #when / #then
    expect(prompt).toContain("parallel wave policy")
    expect(prompt).toContain("wave 1")
    expect(prompt).toContain("retry standard")
    expect(prompt).toContain("max 2 retries")
  })
})
