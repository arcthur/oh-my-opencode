import { describe, it, expect } from "bun:test"
import { parseToolsConfig, parseAllowedTools } from "./tools-parser"

describe("parseToolsConfig", () => {
  it("returns undefined for undefined input", () => {
    expect(parseToolsConfig(undefined)).toBeUndefined()
  })

  it("returns undefined for empty string", () => {
    expect(parseToolsConfig("")).toBeUndefined()
  })

  it("returns undefined for whitespace-only string", () => {
    expect(parseToolsConfig("   ")).toBeUndefined()
  })

  it("parses single tool", () => {
    expect(parseToolsConfig("Read")).toEqual({ read: true })
  })

  it("parses multiple comma-separated tools", () => {
    expect(parseToolsConfig("Read,Write,Bash")).toEqual({
      read: true,
      write: true,
      bash: true,
    })
  })

  it("trims whitespace around tool names", () => {
    expect(parseToolsConfig(" Read , Write , Bash ")).toEqual({
      read: true,
      write: true,
      bash: true,
    })
  })

  it("converts tool names to lowercase", () => {
    expect(parseToolsConfig("READ,WRITE,BaSh")).toEqual({
      read: true,
      write: true,
      bash: true,
    })
  })

  it("filters out empty entries from consecutive commas", () => {
    expect(parseToolsConfig("Read,,Write")).toEqual({
      read: true,
      write: true,
    })
  })
})

describe("parseAllowedTools", () => {
  it("returns undefined for undefined input", () => {
    expect(parseAllowedTools(undefined)).toBeUndefined()
  })

  it("returns undefined for empty string (falsy check)", () => {
    // Empty string is falsy, so returns undefined early
    expect(parseAllowedTools("")).toBeUndefined()
  })

  it("parses single tool", () => {
    expect(parseAllowedTools("Read")).toEqual(["Read"])
  })

  it("parses whitespace-separated tools", () => {
    expect(parseAllowedTools("Read Write Bash")).toEqual(["Read", "Write", "Bash"])
  })

  it("handles multiple spaces between tools", () => {
    expect(parseAllowedTools("Read   Write    Bash")).toEqual(["Read", "Write", "Bash"])
  })

  it("handles tabs and newlines", () => {
    expect(parseAllowedTools("Read\tWrite\nBash")).toEqual(["Read", "Write", "Bash"])
  })

  it("preserves case (unlike parseToolsConfig)", () => {
    expect(parseAllowedTools("READ Write baSH")).toEqual(["READ", "Write", "baSH"])
  })
})
