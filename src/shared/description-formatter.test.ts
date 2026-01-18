import { describe, it, expect } from "bun:test"
import { formatScopedDescription } from "./description-formatter"

describe("formatScopedDescription", () => {
  it("formats scope with description", () => {
    expect(formatScopedDescription("user", "My description")).toBe("(user) My description")
  })

  it("formats scope with empty description", () => {
    expect(formatScopedDescription("project", "")).toBe("(project) ")
  })

  it("formats scope with undefined description", () => {
    expect(formatScopedDescription("opencode", undefined)).toBe("(opencode) ")
  })

  it("handles complex scope strings", () => {
    expect(formatScopedDescription("plugin: my-plugin", "Plugin feature")).toBe(
      "(plugin: my-plugin) Plugin feature"
    )
  })

  it("handles scope with suffix", () => {
    expect(formatScopedDescription("user - Skill", "A skill")).toBe("(user - Skill) A skill")
  })

  it("preserves description whitespace", () => {
    expect(formatScopedDescription("test", "  spaced  ")).toBe("(test)   spaced  ")
  })
})
