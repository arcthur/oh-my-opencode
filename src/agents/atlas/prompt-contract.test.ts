import { describe, expect, test } from "bun:test"
import { getDefaultAtlasPrompt } from "./default"
import { getGptAtlasPrompt } from "./gpt"

describe("Atlas prompt contract", () => {
  test("default prompt defines parallel wave policy and retry standard", () => {
    // #given
    const prompt = getDefaultAtlasPrompt().toLowerCase()

    // #when / #then
    expect(prompt).toContain("parallel wave policy")
    expect(prompt).toContain("wave 1")
    expect(prompt).toContain("retry standard")
    expect(prompt).toContain("max 2 retries")
  })

  test("gpt prompt defines parallel wave policy and retry standard", () => {
    // #given
    const prompt = getGptAtlasPrompt().toLowerCase()

    // #when / #then
    expect(prompt).toContain("parallel wave policy")
    expect(prompt).toContain("wave 1")
    expect(prompt).toContain("retry standard")
    expect(prompt).toContain("max 2 retries")
  })
})
