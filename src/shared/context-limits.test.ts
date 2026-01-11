import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import {
  getDefaultAnthropicContextLimit,
  isEnv1MContextEnabled,
  formatContextLimit,
  DEFAULT_ANTHROPIC_CONTEXT_LIMIT,
  ANTHROPIC_1M_CONTEXT_LIMIT,
} from "./context-limits"

describe("context-limits", () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    // Clear relevant env vars
    delete process.env.ANTHROPIC_1M_CONTEXT
    delete process.env.VERTEX_ANTHROPIC_1M_CONTEXT
  })

  afterEach(() => {
    // Restore original env
    process.env = { ...originalEnv }
  })

  describe("isEnv1MContextEnabled", () => {
    test("returns false when no env vars set", () => {
      expect(isEnv1MContextEnabled()).toBe(false)
    })

    test("returns true when ANTHROPIC_1M_CONTEXT is true", () => {
      process.env.ANTHROPIC_1M_CONTEXT = "true"
      expect(isEnv1MContextEnabled()).toBe(true)
    })

    test("returns true when VERTEX_ANTHROPIC_1M_CONTEXT is true", () => {
      process.env.VERTEX_ANTHROPIC_1M_CONTEXT = "true"
      expect(isEnv1MContextEnabled()).toBe(true)
    })

    test("returns false when env var is false", () => {
      process.env.ANTHROPIC_1M_CONTEXT = "false"
      expect(isEnv1MContextEnabled()).toBe(false)
    })
  })

  describe("getDefaultAnthropicContextLimit", () => {
    test("returns 200K when no env vars set", () => {
      expect(getDefaultAnthropicContextLimit()).toBe(DEFAULT_ANTHROPIC_CONTEXT_LIMIT)
      expect(getDefaultAnthropicContextLimit()).toBe(200_000)
    })

    test("returns 1M when ANTHROPIC_1M_CONTEXT is true", () => {
      process.env.ANTHROPIC_1M_CONTEXT = "true"
      expect(getDefaultAnthropicContextLimit()).toBe(ANTHROPIC_1M_CONTEXT_LIMIT)
      expect(getDefaultAnthropicContextLimit()).toBe(1_000_000)
    })

    test("returns 1M when VERTEX_ANTHROPIC_1M_CONTEXT is true", () => {
      process.env.VERTEX_ANTHROPIC_1M_CONTEXT = "true"
      expect(getDefaultAnthropicContextLimit()).toBe(1_000_000)
    })
  })

  describe("formatContextLimit", () => {
    test("formats 200K limit", () => {
      expect(formatContextLimit(200_000)).toBe("200K")
    })

    test("formats 1M limit", () => {
      expect(formatContextLimit(1_000_000)).toBe("1M")
    })

    test("formats arbitrary limits", () => {
      expect(formatContextLimit(100_000)).toBe("100K")
      expect(formatContextLimit(500_000)).toBe("500K")
    })
  })

  describe("constants", () => {
    test("DEFAULT_ANTHROPIC_CONTEXT_LIMIT is 200K", () => {
      expect(DEFAULT_ANTHROPIC_CONTEXT_LIMIT).toBe(200_000)
    })

    test("ANTHROPIC_1M_CONTEXT_LIMIT is 1M", () => {
      expect(ANTHROPIC_1M_CONTEXT_LIMIT).toBe(1_000_000)
    })
  })
})
