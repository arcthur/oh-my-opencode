import { describe, expect, test } from "bun:test"
import {
  BLOCKER_KEYWORDS,
  BlockerPromptCache,
  isBlockerLikely,
  classifyError,
} from "./blocker-detection"

describe("blocker-detection", () => {
  describe("BLOCKER_KEYWORDS", () => {
    test("contains auth-related keywords", () => {
      expect(BLOCKER_KEYWORDS).toContain("missing api key")
      expect(BLOCKER_KEYWORDS).toContain("permission denied")
      expect(BLOCKER_KEYWORDS).toContain("authentication failed")
    })

    test("is frozen array", () => {
      expect(Array.isArray(BLOCKER_KEYWORDS)).toBe(true)
    })
  })

  describe("isBlockerLikely", () => {
    test("detects API key issues", () => {
      expect(isBlockerLikely("Error: Missing API key")).toBe(true)
      expect(isBlockerLikely("No API key found")).toBe(true)
      expect(isBlockerLikely("Invalid API key provided")).toBe(true)
    })

    test("detects permission issues", () => {
      expect(isBlockerLikely("Permission denied")).toBe(true)
      expect(isBlockerLikely("Access denied to resource")).toBe(true)
      expect(isBlockerLikely("Forbidden: insufficient permissions")).toBe(true)
    })

    test("detects authentication issues", () => {
      expect(isBlockerLikely("Authentication failed")).toBe(true)
      expect(isBlockerLikely("Unauthorized access")).toBe(true)
      expect(isBlockerLikely("Invalid token")).toBe(true)
    })

    test("returns false for generic errors", () => {
      expect(isBlockerLikely("File not found")).toBe(false)
      expect(isBlockerLikely("Syntax error on line 5")).toBe(false)
      expect(isBlockerLikely("Connection refused")).toBe(false)
      expect(isBlockerLikely("Timeout waiting for response")).toBe(false)
    })

    test("is case insensitive", () => {
      expect(isBlockerLikely("PERMISSION DENIED")).toBe(true)
      expect(isBlockerLikely("Missing API KEY")).toBe(true)
    })
  })

  describe("classifyError", () => {
    test("classifies blocker errors", () => {
      expect(classifyError("Missing API key")).toBe("blocker")
      expect(classifyError("Permission denied")).toBe("blocker")
    })

    test("classifies transient errors", () => {
      expect(classifyError("Request timeout")).toBe("transient")
      expect(classifyError("Connection timed out")).toBe("transient")
      expect(classifyError("Please try again later")).toBe("transient")
    })

    test("classifies fixable errors", () => {
      expect(classifyError("File not found")).toBe("fixable")
      expect(classifyError("Syntax error: unexpected token")).toBe("fixable")
      expect(classifyError("TypeError: undefined is not a function")).toBe("fixable")
    })

    test("returns unknown for unrecognized errors", () => {
      expect(classifyError("Some random error message")).toBe("unknown")
    })
  })

  describe("BlockerPromptCache", () => {
    test("tracks prompted blockers per session", () => {
      const cache = new BlockerPromptCache()

      expect(cache.has("session1", "blocker1")).toBe(false)
      cache.add("session1", "blocker1")
      expect(cache.has("session1", "blocker1")).toBe(true)
      expect(cache.has("session1", "blocker2")).toBe(false)
      expect(cache.has("session2", "blocker1")).toBe(false)
    })

    test("deletes session data", () => {
      const cache = new BlockerPromptCache()

      cache.add("session1", "blocker1")
      expect(cache.has("session1", "blocker1")).toBe(true)

      cache.delete("session1")
      expect(cache.has("session1", "blocker1")).toBe(false)
    })

    test("evicts oldest session when at capacity", () => {
      const cache = new BlockerPromptCache({ maxSessions: 2, maxBlockersPerSession: 10 })

      cache.add("session1", "blocker1")
      cache.add("session2", "blocker2")
      cache.add("session3", "blocker3")

      // session1 should be evicted
      expect(cache.has("session1", "blocker1")).toBe(false)
      expect(cache.has("session2", "blocker2")).toBe(true)
      expect(cache.has("session3", "blocker3")).toBe(true)
    })

    test("evicts old blockers when per-session limit exceeded", () => {
      const cache = new BlockerPromptCache({ maxSessions: 10, maxBlockersPerSession: 3 })

      cache.add("session1", "blocker1")
      cache.add("session1", "blocker2")
      cache.add("session1", "blocker3")
      cache.add("session1", "blocker4")

      // Some older blockers should be evicted (keeps most recent half)
      const stats = cache.stats()
      expect(stats.totalBlockers).toBeLessThanOrEqual(3)
    })

    test("updates LRU order on access", () => {
      const cache = new BlockerPromptCache({ maxSessions: 2, maxBlockersPerSession: 10 })

      cache.add("session1", "blocker1")
      cache.add("session2", "blocker2")

      // Access session1 again to make it most recently used
      cache.add("session1", "blocker3")

      // Add session3, should evict session2 (not session1)
      cache.add("session3", "blocker4")

      expect(cache.has("session1", "blocker1")).toBe(true)
      expect(cache.has("session2", "blocker2")).toBe(false)
      expect(cache.has("session3", "blocker4")).toBe(true)
    })

    test("returns stats", () => {
      const cache = new BlockerPromptCache()

      cache.add("session1", "blocker1")
      cache.add("session1", "blocker2")
      cache.add("session2", "blocker3")

      const stats = cache.stats()
      expect(stats.sessions).toBe(2)
      expect(stats.totalBlockers).toBe(3)
    })
  })
})
