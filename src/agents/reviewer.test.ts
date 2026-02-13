import { describe, expect, test } from "bun:test"
import { REVIEWER_SYSTEM_PROMPT } from "./reviewer"

describe("REVIEWER_SYSTEM_PROMPT blockers", () => {
  test("checks minimum zero-human-intervention executability constraints", () => {
    // #given
    const prompt = REVIEWER_SYSTEM_PROMPT.toLowerCase()

    // #when / #then
    expect(prompt).toContain("at least one concrete verification command")
    expect(prompt).toContain("forbidden user-manual phrases")
    expect(prompt).toContain("each task has an actionable starting point")
  })
})
