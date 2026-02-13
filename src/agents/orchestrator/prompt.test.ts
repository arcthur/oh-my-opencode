import { describe, expect, test } from "bun:test"
import { estimateTokens, takeDynamicSection } from "./prompt"

describe("estimateTokens", () => {
  test("empty string → 0", () => {
    // #given
    const input = ""
    // #when
    const result = estimateTokens(input)
    // #then
    expect(result).toBe(0)
  })

  test("5-char string → ceil(5/4) = 2", () => {
    // #given
    const input = "hello"
    // #when
    const result = estimateTokens(input)
    // #then
    expect(result).toBe(2)
  })

  test("100-char string → 25", () => {
    // #given
    const input = "a".repeat(100)
    // #when
    const result = estimateTokens(input)
    // #then
    expect(result).toBe(25)
  })
})

describe("takeDynamicSection", () => {
  test("remaining = 0 → returns empty section, 0 usedTokens", () => {
    // #given
    const input = { full: "some content", remaining: 0, priority: "high" as const }
    // #when
    const result = takeDynamicSection(input)
    // #then
    expect(result.section).toBe("")
    expect(result.usedTokens).toBe(0)
  })

  test("full fits within remaining → picks full, returns correct usedTokens", () => {
    // #given
    const full = "abcd" // 4 chars = 1 token
    const input = { full, remaining: 10, priority: "normal" as const }
    // #when
    const result = takeDynamicSection(input)
    // #then
    expect(result.section).toBe(full)
    expect(result.usedTokens).toBe(1)
  })

  test("full exceeds remaining, compact fits → picks compact", () => {
    // #given
    const full = "a".repeat(100) // 25 tokens
    const compact = "abcd" // 1 token
    const input = { full, compact, remaining: 5, priority: "normal" as const }
    // #when
    const result = takeDynamicSection(input)
    // #then
    expect(result.section).toBe(compact)
    expect(result.usedTokens).toBe(1)
  })

  test("full and compact exceed, priority=high, fallback fits → picks fallback", () => {
    // #given
    const full = "a".repeat(100) // 25 tokens
    const compact = "b".repeat(40) // 10 tokens
    const fallback = "cd" // 1 token
    const input = { full, compact, fallback, remaining: 5, priority: "high" as const }
    // #when
    const result = takeDynamicSection(input)
    // #then
    expect(result.section).toBe(fallback)
    expect(result.usedTokens).toBe(1)
  })

  test("full and compact exceed, priority=normal, fallback exists → ignores fallback, returns empty", () => {
    // #given
    const full = "a".repeat(100) // 25 tokens
    const compact = "b".repeat(40) // 10 tokens
    const fallback = "cd" // 1 token
    const input = { full, compact, fallback, remaining: 5, priority: "normal" as const }
    // #when
    const result = takeDynamicSection(input)
    // #then
    expect(result.section).toBe("")
    expect(result.usedTokens).toBe(0)
  })

  test("full and compact and fallback all exceed → returns empty", () => {
    // #given
    const full = "a".repeat(100) // 25 tokens
    const compact = "b".repeat(40) // 10 tokens
    const fallback = "c".repeat(20) // 5 tokens
    const input = { full, compact, fallback, remaining: 2, priority: "high" as const }
    // #when
    const result = takeDynamicSection(input)
    // #then
    expect(result.section).toBe("")
    expect(result.usedTokens).toBe(0)
  })

  test("empty full string → returns empty section, 0 usedTokens", () => {
    // #given
    const input = { full: "", remaining: 100, priority: "high" as const }
    // #when
    const result = takeDynamicSection(input)
    // #then
    expect(result.section).toBe("")
    expect(result.usedTokens).toBe(0)
  })
})
