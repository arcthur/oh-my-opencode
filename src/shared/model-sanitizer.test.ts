import { describe, it, expect } from "bun:test"
import { sanitizeModelField, getCommandSource } from "./model-sanitizer"

describe("sanitizeModelField", () => {
  it("returns undefined for claude-code source regardless of model", () => {
    expect(sanitizeModelField("sonnet", "claude-code")).toBeUndefined()
    expect(sanitizeModelField("opus", "claude-code")).toBeUndefined()
    expect(sanitizeModelField(undefined, "claude-code")).toBeUndefined()
  })

  it("returns model string for opencode source", () => {
    expect(sanitizeModelField("sonnet", "opencode")).toBe("sonnet")
    expect(sanitizeModelField("opus", "opencode")).toBe("opus")
    expect(sanitizeModelField("  haiku  ", "opencode")).toBe("haiku")
  })

  it("returns undefined for empty or non-string model with opencode source", () => {
    expect(sanitizeModelField(undefined, "opencode")).toBeUndefined()
    expect(sanitizeModelField("", "opencode")).toBeUndefined()
    expect(sanitizeModelField("   ", "opencode")).toBeUndefined()
    expect(sanitizeModelField(123, "opencode")).toBeUndefined()
    expect(sanitizeModelField(null, "opencode")).toBeUndefined()
  })

  it("defaults to claude-code source", () => {
    expect(sanitizeModelField("sonnet")).toBeUndefined()
  })
})

describe("getCommandSource", () => {
  it("returns 'opencode' for opencode scope", () => {
    expect(getCommandSource("opencode")).toBe("opencode")
  })

  it("returns 'opencode' for opencode-project scope", () => {
    expect(getCommandSource("opencode-project")).toBe("opencode")
  })

  it("returns 'claude-code' for user scope", () => {
    expect(getCommandSource("user")).toBe("claude-code")
  })

  it("returns 'claude-code' for project scope", () => {
    expect(getCommandSource("project")).toBe("claude-code")
  })

  it("returns 'claude-code' for any other scope", () => {
    expect(getCommandSource("builtin")).toBe("claude-code")
    expect(getCommandSource("config")).toBe("claude-code")
    expect(getCommandSource("unknown")).toBe("claude-code")
  })
})
