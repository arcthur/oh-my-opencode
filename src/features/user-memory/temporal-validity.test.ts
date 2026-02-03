import { describe, expect, test } from "bun:test"
import { calculateStaleness, queryKnowledgeAtTime, filterWorkHistoryForInjection, filterKnowledgeForInjection, getValidityStatus } from "./temporal-validity"
import { STALENESS_HALF_LIFE_MS, type LongTermKnowledge, type WorkHistoryEntry } from "./types"

describe("temporal-validity", () => {
  describe("calculateStaleness", () => {
    test("returns ~0.5 at configured half-life", () => {
      // given
      const halfLifeMs = STALENESS_HALF_LIFE_MS["short-term"]
      const fact = {
        valid_from: 0,
        lastReinforced: 0,
        staleness_category: "short-term" as const,
      }

      // when
      const staleness = calculateStaleness(fact, halfLifeMs)

      // then
      expect(staleness).toBeGreaterThan(0.49)
      expect(staleness).toBeLessThan(0.51)
    })

    test("returns ~0.75 at 2x half-life", () => {
      // given
      const halfLifeMs = STALENESS_HALF_LIFE_MS["short-term"]
      const fact = {
        valid_from: 0,
        lastReinforced: 0,
        staleness_category: "short-term" as const,
      }

      // when
      const staleness = calculateStaleness(fact, 2 * halfLifeMs)

      // then
      expect(staleness).toBeGreaterThan(0.74)
      expect(staleness).toBeLessThan(0.76)
    })

    test("does not force staleness to 1.0 solely due to valid_until", () => {
      // given
      const halfLifeMs = STALENESS_HALF_LIFE_MS["short-term"]
      const fact = {
        valid_from: 0,
        valid_until: 0,
        lastReinforced: 0,
        staleness_category: "short-term" as const,
      }

      // when
      const staleness = calculateStaleness(fact, halfLifeMs)

      // then
      expect(staleness).toBeGreaterThan(0.49)
      expect(staleness).toBeLessThan(0.51)
    })
  })

  describe("queryKnowledgeAtTime", () => {
    test("can include expired knowledge when include_expired is true", () => {
      // given
      const now = Date.now()
      const halfLifeMs = STALENESS_HALF_LIFE_MS["short-term"]
      const knowledge: LongTermKnowledge = {
        category: "preference",
        content: "Prefer stable defaults for production systems",
        confidence: 1.0,
        firstSeen: now - halfLifeMs / 2,
        lastReinforced: now - halfLifeMs / 2,
        sourceMonths: ["2025-01"],
        valid_from: now - halfLifeMs / 2,
        valid_until: now - 1,
        staleness_category: "short-term",
      }

      // when
      const results = queryKnowledgeAtTime(
        [knowledge],
        {
          enabled: true,
          staleness_threshold: 0.7,
          decay_factor: 0.5,
          include_expired: true,
        },
        now
      )

      // then
      expect(results).toHaveLength(1)
      expect(results[0]?.validityStatus).toBe("expired")
    })
  })

  describe("getValidityStatus", () => {
    test("treats valid_until as exclusive (queryTime === valid_until => expired)", () => {
      // given
      const now = Date.now()
      const fact = {
        valid_from: 0,
        valid_until: now,
        staleness_category: "short-term" as const,
      }

      // when
      const status = getValidityStatus(fact, now, 0.7)

      // then
      expect(status).toBe("expired")
    })
  })

  describe("filterWorkHistoryForInjection", () => {
    test("excludes expired entries by default", () => {
      // given
      const now = Date.now()
      const halfLifeMs = STALENESS_HALF_LIFE_MS["short-term"]
      const entries: WorkHistoryEntry[] = [
        {
          timestamp: now - halfLifeMs / 2,
          summary: "Expired entry",
          valid_until: now - 1,
          staleness_category: "short-term",
        },
        {
          timestamp: now - halfLifeMs / 2,
          summary: "Active entry",
          staleness_category: "short-term",
        },
      ]

      // when
      const filtered = filterWorkHistoryForInjection(
        entries,
        {
          enabled: true,
          staleness_threshold: 0.7,
          decay_factor: 0.5,
          include_expired: false,
        },
        10,
        now
      )

      // then
      expect(filtered.some((e) => e.summary === "Expired entry")).toBe(false)
      expect(filtered.some((e) => e.summary === "Active entry")).toBe(true)
    })
  })

  describe("filterKnowledgeForInjection", () => {
    test("requires effective confidence >= 0.6", () => {
      // given
      const now = Date.now()
      const knowledge: LongTermKnowledge[] = [
        {
          category: "lesson",
          content: "Meets threshold",
          confidence: 0.6,
          firstSeen: now,
          lastReinforced: now,
          sourceMonths: ["2025-01"],
          staleness_category: "permanent",
        },
        {
          category: "lesson",
          content: "Below threshold",
          confidence: 0.59,
          firstSeen: now,
          lastReinforced: now,
          sourceMonths: ["2025-01"],
          staleness_category: "permanent",
        },
      ]

      // when
      const filtered = filterKnowledgeForInjection(
        knowledge,
        {
          enabled: true,
          staleness_threshold: 0.7,
          decay_factor: 0.5,
          include_expired: false,
        },
        5,
        now
      )

      // then
      expect(filtered.some((k) => k.content === "Meets threshold")).toBe(true)
      expect(filtered.some((k) => k.content === "Below threshold")).toBe(false)
    })
  })
})
