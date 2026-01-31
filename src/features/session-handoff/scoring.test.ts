import { describe, it, expect } from "bun:test"
import {
  calculateFreshness,
  calculateKeywordRelevance,
  computeHandoffScore,
  scoreAndRankHandoffs,
  filterByMinScore,
  explainScore,
  validateWeights,
  normalizeWeights,
  DEFAULT_SCORING_CONFIG,
} from "./scoring"
import {
  calculateAuthorityScore,
  isArchitecturalHandoff,
  checkL3Promotion,
  determineSessionOutcome,
  hasCompletionMarker,
} from "./citation-tracker"
import type { HandoffPackage, HandoffMetrics } from "./types"
import { DEFAULT_HANDOFF_METRICS, DEFAULT_HALF_LIFE_CONFIG } from "./types"

describe("Scoring System", () => {
  describe("calculateAuthorityScore", () => {
    it("returns 0.5 for new handoffs (no citations)", () => {
      const metrics: HandoffMetrics = { ...DEFAULT_HANDOFF_METRICS }
      expect(calculateAuthorityScore(metrics)).toBe(0.5)
    })

    it("returns high score for successful citations", () => {
      const metrics: HandoffMetrics = {
        ...DEFAULT_HANDOFF_METRICS,
        citationCount: 5,
        successfulCitations: 4,
      }
      const score = calculateAuthorityScore(metrics)
      expect(score).toBeGreaterThan(0.8)
    })

    it("returns low score for unsuccessful citations", () => {
      const metrics: HandoffMetrics = {
        ...DEFAULT_HANDOFF_METRICS,
        citationCount: 10,
        successfulCitations: 2,
      }
      const score = calculateAuthorityScore(metrics)
      expect(score).toBeLessThan(0.4)
    })

    it("caps score at 1.0", () => {
      const metrics: HandoffMetrics = {
        ...DEFAULT_HANDOFF_METRICS,
        citationCount: 100,
        successfulCitations: 100,
      }
      const score = calculateAuthorityScore(metrics)
      expect(score).toBe(1.0)
    })
  })

  describe("calculateFreshness", () => {
    const now = Date.now()

    it("returns 1.0 for newly created handoffs", () => {
      const metrics: HandoffMetrics = { ...DEFAULT_HANDOFF_METRICS }
      const freshness = calculateFreshness(metrics, now, DEFAULT_HALF_LIFE_CONFIG, now)
      expect(freshness).toBe(1.0)
    })

    it("returns ~0.5 at half-life age", () => {
      const metrics: HandoffMetrics = { ...DEFAULT_HANDOFF_METRICS }
      const halfLifeMs = DEFAULT_HALF_LIFE_CONFIG.default * 24 * 60 * 60 * 1000
      const createdAt = now - halfLifeMs

      const freshness = calculateFreshness(metrics, createdAt, DEFAULT_HALF_LIFE_CONFIG, now)
      expect(freshness).toBeCloseTo(0.5, 1)
    })

    it("returns 1.0 for pinned handoffs regardless of age", () => {
      const metrics: HandoffMetrics = {
        ...DEFAULT_HANDOFF_METRICS,
        manualPinned: true,
      }
      const oldCreatedAt = now - 365 * 24 * 60 * 60 * 1000 // 1 year ago

      const freshness = calculateFreshness(
        metrics,
        oldCreatedAt,
        DEFAULT_HALF_LIFE_CONFIG,
        now
      )
      expect(freshness).toBe(1.0)
    })

    it("uses architectural half-life for architectural handoffs", () => {
      const metrics: HandoffMetrics = {
        ...DEFAULT_HANDOFF_METRICS,
        isArchitectural: true,
      }
      const archHalfLifeMs = DEFAULT_HALF_LIFE_CONFIG.architectural * 24 * 60 * 60 * 1000
      const createdAt = now - archHalfLifeMs

      const freshness = calculateFreshness(metrics, createdAt, DEFAULT_HALF_LIFE_CONFIG, now)
      expect(freshness).toBeCloseTo(0.5, 1)
    })
  })

  describe("calculateKeywordRelevance", () => {
    const createHandoff = (goal: string, decisions: string[] = []): HandoffPackage => ({
      id: "test",
      sourceSessionId: "session",
      createdAt: Date.now(),
      expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
      metadata: {
        originalGoal: goal,
        durationMs: 1000,
        projectPath: "/test",
        keyFiles: [],
        outcome: "completed",
      },
      payload: {
        decisions: decisions.map((d) => ({
          what: d,
          chosen: d,
          why: d,
        })),
        artifacts: [],
        antiPatterns: [],
        domainContext: [],
      },
    })

    it("returns high score for matching keywords", () => {
      const handoff = createHandoff("TypeScript authentication system", [
        "JWT token storage",
      ])
      const relevance = calculateKeywordRelevance(handoff, "authentication jwt")
      expect(relevance).toBeGreaterThan(0.5)
    })

    it("returns low score for non-matching keywords", () => {
      const handoff = createHandoff("TypeScript authentication system")
      const relevance = calculateKeywordRelevance(handoff, "database migration postgres")
      expect(relevance).toBeLessThan(0.3)
    })

    it("returns 0.5 for query with only stop words", () => {
      const handoff = createHandoff("Test handoff")
      const relevance = calculateKeywordRelevance(handoff, "the a an")
      expect(relevance).toBe(0.5)
    })
  })

  describe("computeHandoffScore", () => {
    const createHandoff = (): HandoffPackage => ({
      id: "test",
      sourceSessionId: "session",
      createdAt: Date.now(),
      expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
      metadata: {
        originalGoal: "TypeScript API development",
        durationMs: 1000,
        projectPath: "/test",
        keyFiles: ["src/api.ts"],
        outcome: "completed",
      },
      payload: {
        decisions: [{ what: "API design", chosen: "REST", why: "simplicity" }],
        artifacts: [],
        antiPatterns: [],
        domainContext: [],
      },
      metrics: {
        ...DEFAULT_HANDOFF_METRICS,
        citationCount: 3,
        successfulCitations: 2,
        authorityScore: 0.7,
      },
    })

    it("computes combined score", () => {
      const handoff = createHandoff()
      const scored = computeHandoffScore(handoff, "TypeScript API")

      expect(scored.score).toBeGreaterThan(0)
      expect(scored.score).toBeLessThanOrEqual(1)
      expect(scored.components.relevance).toBeGreaterThan(0)
      expect(scored.components.freshness).toBeGreaterThan(0)
      expect(scored.components.authority).toBe(0.7)
    })

    it("uses default metrics for handoffs without metrics", () => {
      const handoff = createHandoff()
      delete handoff.metrics

      const scored = computeHandoffScore(handoff, "TypeScript API")
      expect(scored.components.authority).toBe(0.5) // Default
    })
  })

  describe("scoreAndRankHandoffs", () => {
    const createHandoff = (
      id: string,
      goal: string,
      authority: number
    ): HandoffPackage => ({
      id,
      sourceSessionId: "session",
      createdAt: Date.now(),
      expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
      metadata: {
        originalGoal: goal,
        durationMs: 1000,
        projectPath: "/test",
        keyFiles: [],
        outcome: "completed",
      },
      payload: {
        decisions: [],
        artifacts: [],
        antiPatterns: [],
        domainContext: [],
      },
      metrics: {
        ...DEFAULT_HANDOFF_METRICS,
        authorityScore: authority,
      },
    })

    it("ranks handoffs by score descending", () => {
      const handoffs = [
        createHandoff("a", "unrelated topic", 0.9),
        createHandoff("b", "TypeScript API", 0.5),
        createHandoff("c", "TypeScript API development", 0.8),
      ]

      const ranked = scoreAndRankHandoffs(handoffs, "TypeScript API")

      // Higher relevance + authority should rank higher
      expect(ranked[0].handoff.id).toBe("c")
      expect(ranked[0].score).toBeGreaterThan(ranked[1].score)
    })
  })

  describe("filterByMinScore", () => {
    it("filters out low-scoring handoffs", () => {
      const scored = [
        { handoff: {} as any, score: 0.8, components: {} as any },
        { handoff: {} as any, score: 0.2, components: {} as any },
        { handoff: {} as any, score: 0.5, components: {} as any },
      ]

      const filtered = filterByMinScore(scored, 0.3)
      expect(filtered).toHaveLength(2)
      expect(filtered.every((s) => s.score >= 0.3)).toBe(true)
    })
  })

  describe("isArchitecturalHandoff", () => {
    const createHandoff = (
      category?: string,
      relatedFiles?: string[]
    ): HandoffPackage => ({
      id: "test",
      sourceSessionId: "session",
      createdAt: Date.now(),
      expiresAt: Date.now(),
      metadata: {
        originalGoal: "test",
        durationMs: 1000,
        projectPath: "/test",
        keyFiles: [],
        outcome: "completed",
      },
      payload: {
        decisions: [
          {
            what: "test decision",
            chosen: "option a",
            why: "because",
            category: category as any,
            relatedFiles,
          },
        ],
        artifacts: [],
        antiPatterns: [],
        domainContext: [],
      },
    })

    it("returns true for architecture category", () => {
      const handoff = createHandoff("architecture")
      expect(isArchitecturalHandoff(handoff)).toBe(true)
    })

    it("returns true for convention category", () => {
      const handoff = createHandoff("convention")
      expect(isArchitecturalHandoff(handoff)).toBe(true)
    })

    it("returns true for high-impact decisions (3+ files)", () => {
      const handoff = createHandoff("implementation", ["a.ts", "b.ts", "c.ts"])
      expect(isArchitecturalHandoff(handoff)).toBe(true)
    })

    it("returns false for low-impact implementation decisions", () => {
      const handoff = createHandoff("implementation", ["a.ts"])
      expect(isArchitecturalHandoff(handoff)).toBe(false)
    })
  })

  describe("checkL3Promotion", () => {
    const createHandoff = (metrics: Partial<HandoffMetrics>): HandoffPackage => ({
      id: "test",
      sourceSessionId: "session",
      createdAt: Date.now(),
      expiresAt: Date.now(),
      metadata: {
        originalGoal: "test",
        durationMs: 1000,
        projectPath: "/test",
        keyFiles: [],
        outcome: "completed",
      },
      payload: {
        decisions: [],
        artifacts: [],
        antiPatterns: [],
        domainContext: [],
      },
      metrics: { ...DEFAULT_HANDOFF_METRICS, ...metrics },
    })

    it("promotes handoffs with 3+ successful citations", () => {
      const handoff = createHandoff({ successfulCitations: 3 })
      expect(checkL3Promotion(handoff)).toBe("proven-valuable")
    })

    it("promotes architectural handoffs", () => {
      const handoff = createHandoff({ isArchitectural: true })
      expect(checkL3Promotion(handoff)).toBe("architectural-decision")
    })

    it("promotes pinned handoffs", () => {
      const handoff = createHandoff({ manualPinned: true })
      expect(checkL3Promotion(handoff)).toBe("user-pinned")
    })

    it("promotes high-authority handoffs", () => {
      const handoff = createHandoff({ authorityScore: 0.85 })
      expect(checkL3Promotion(handoff)).toBe("high-authority")
    })

    it("returns null for non-qualifying handoffs", () => {
      const handoff = createHandoff({ successfulCitations: 1, authorityScore: 0.5 })
      expect(checkL3Promotion(handoff)).toBeNull()
    })
  })

  describe("determineSessionOutcome", () => {
    it("returns completed for completion markers", () => {
      const messages = [{ content: "Task is done" }]
      expect(determineSessionOutcome(messages, [], 0)).toBe("completed")
    })

    it("returns blocked for blocking markers", () => {
      const messages = [{ content: "Fatal error, cannot continue" }]
      expect(determineSessionOutcome(messages, [], 0)).toBe("blocked")
    })

    it("returns completed for significant changes with reasonable duration", () => {
      const messages = [{ content: "Regular message" }]
      const fileChanges = ["a.ts", "b.ts"]
      const durationMs = 10 * 60 * 1000 // 10 minutes
      expect(determineSessionOutcome(messages, fileChanges, durationMs)).toBe("completed")
    })

    it("returns partial for short sessions with few changes", () => {
      const messages = [{ content: "Regular message" }]
      const fileChanges = ["a.ts"]
      const durationMs = 60 * 1000 // 1 minute
      expect(determineSessionOutcome(messages, fileChanges, durationMs)).toBe("partial")
    })
  })

  describe("Weight Validation", () => {
    it("validates correct weights", () => {
      expect(validateWeights({ relevance: 0.5, freshness: 0.3, authority: 0.2 })).toBe(true)
    })

    it("invalidates weights not summing to 1.0", () => {
      expect(validateWeights({ relevance: 0.5, freshness: 0.3, authority: 0.3 })).toBe(false)
    })

    it("normalizes weights", () => {
      const normalized = normalizeWeights({ relevance: 1, freshness: 1, authority: 1 })
      expect(normalized.relevance).toBeCloseTo(0.333, 2)
      expect(normalized.freshness).toBeCloseTo(0.333, 2)
      expect(normalized.authority).toBeCloseTo(0.333, 2)
    })
  })

  describe("explainScore", () => {
    it("generates human-readable explanation", () => {
      const scored = {
        handoff: {} as any,
        score: 0.75,
        components: {
          relevance: 0.8,
          freshness: 0.9,
          authority: 0.6,
        },
      }

      const explanation = explainScore(scored)
      expect(explanation).toContain("75%")
      expect(explanation).toContain("highly relevant")
      expect(explanation).toContain("very fresh")
    })
  })
})
