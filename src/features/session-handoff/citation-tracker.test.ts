import { describe, it, expect } from "bun:test"
import {
  CitationTracker,
  calculateAuthorityScore,
  DEFAULT_BAYESIAN_PRIOR,
} from "./citation-tracker"
import { DEFAULT_HANDOFF_METRICS } from "./types"
import type { HandoffMetrics } from "./types"

describe("CitationTracker", () => {
  describe("two-phase tracking", () => {
    it("does NOT update metrics on injection (phase 1)", async () => {
      // given
      const metricsById = new Map<string, HandoffMetrics>([
        ["ho_1", { ...DEFAULT_HANDOFF_METRICS }],
      ])

      const tracker = new CitationTracker(async (handoffId, updater) => {
        const current = metricsById.get(handoffId) ?? { ...DEFAULT_HANDOFF_METRICS }
        const next = updater(current)
        metricsById.set(handoffId, next)
      })

      // when - phase 1: injection
      await tracker.onHandoffsInjected("session_1", ["ho_1"])

      // then - metrics should NOT be updated yet
      const afterInjection = metricsById.get("ho_1")
      expect(afterInjection?.citationCount).toBe(0) // Still 0
      expect(afterInjection?.successfulCitations).toBe(0) // Still 0

      // But pending citation should be recorded
      expect(tracker.hasPendingCitation("session_1")).toBe(true)
    })

    it("updates metrics on settlement (phase 2)", async () => {
      // given
      const metricsById = new Map<string, HandoffMetrics>([
        ["ho_1", { ...DEFAULT_HANDOFF_METRICS }],
      ])

      const tracker = new CitationTracker(async (handoffId, updater) => {
        const current = metricsById.get(handoffId) ?? { ...DEFAULT_HANDOFF_METRICS }
        const next = updater(current)
        metricsById.set(handoffId, next)
      })

      // when - phase 1: injection
      await tracker.onHandoffsInjected("session_1", ["ho_1"])

      // when - phase 2: settlement
      await tracker.onSessionSettled("session_1", "completed")

      // then - metrics should be updated
      const afterSettlement = metricsById.get("ho_1")
      expect(afterSettlement?.citationCount).toBe(1)
      expect(afterSettlement?.successfulCitations).toBe(1) // completed = success
      expect(afterSettlement?.authorityScore).toBe(
        calculateAuthorityScore(afterSettlement!)
      )

      // Pending citation should be cleared
      expect(tracker.hasPendingCitation("session_1")).toBe(false)
      expect(tracker.isSettled("session_1")).toBe(true)
    })

    it("handles partial outcome correctly", async () => {
      // given
      const metricsById = new Map<string, HandoffMetrics>([
        ["ho_1", { ...DEFAULT_HANDOFF_METRICS }],
      ])

      const tracker = new CitationTracker(async (handoffId, updater) => {
        const current = metricsById.get(handoffId) ?? { ...DEFAULT_HANDOFF_METRICS }
        const next = updater(current)
        metricsById.set(handoffId, next)
      })

      // when
      await tracker.onHandoffsInjected("session_1", ["ho_1"])
      await tracker.onSessionSettled("session_1", "partial")

      // then - citationCount increases but successfulCitations does not
      const updated = metricsById.get("ho_1")
      expect(updated?.citationCount).toBe(1)
      expect(updated?.successfulCitations).toBe(0) // partial != success
    })

    it("prevents double settlement", async () => {
      // given
      const metricsById = new Map<string, HandoffMetrics>([
        ["ho_1", { ...DEFAULT_HANDOFF_METRICS }],
      ])

      const tracker = new CitationTracker(async (handoffId, updater) => {
        const current = metricsById.get(handoffId) ?? { ...DEFAULT_HANDOFF_METRICS }
        const next = updater(current)
        metricsById.set(handoffId, next)
      })

      // when - settle twice
      await tracker.onHandoffsInjected("session_1", ["ho_1"])
      await tracker.onSessionSettled("session_1", "completed")
      await tracker.onSessionSettled("session_1", "completed") // Second call

      // then - only counted once
      const updated = metricsById.get("ho_1")
      expect(updated?.citationCount).toBe(1)
      expect(updated?.successfulCitations).toBe(1)
    })
  })

  describe("intermediate outcome caching", () => {
    it("caches intermediate outcome without settling", async () => {
      // given
      const metricsById = new Map<string, HandoffMetrics>([
        ["ho_1", { ...DEFAULT_HANDOFF_METRICS }],
      ])

      const tracker = new CitationTracker(async (handoffId, updater) => {
        const current = metricsById.get(handoffId) ?? { ...DEFAULT_HANDOFF_METRICS }
        const next = updater(current)
        metricsById.set(handoffId, next)
      })

      await tracker.onHandoffsInjected("session_1", ["ho_1"])

      // when - record intermediate outcome (e.g., from session.idle)
      tracker.recordIntermediateOutcome("session_1", "completed")

      // then - metrics should NOT be updated yet
      const afterIntermediate = metricsById.get("ho_1")
      expect(afterIntermediate?.citationCount).toBe(0)
      expect(tracker.hasPendingCitation("session_1")).toBe(true)
      expect(tracker.isSettled("session_1")).toBe(false)
    })

    it("uses cached outcome when settling without explicit outcome", async () => {
      // given
      const metricsById = new Map<string, HandoffMetrics>([
        ["ho_1", { ...DEFAULT_HANDOFF_METRICS }],
      ])

      const tracker = new CitationTracker(async (handoffId, updater) => {
        const current = metricsById.get(handoffId) ?? { ...DEFAULT_HANDOFF_METRICS }
        const next = updater(current)
        metricsById.set(handoffId, next)
      })

      await tracker.onHandoffsInjected("session_1", ["ho_1"])
      tracker.recordIntermediateOutcome("session_1", "completed")

      // when - settle without explicit outcome
      await tracker.onSessionSettled("session_1")

      // then - should use cached "completed" outcome
      const updated = metricsById.get("ho_1")
      expect(updated?.citationCount).toBe(1)
      expect(updated?.successfulCitations).toBe(1)
    })

    it("defaults to partial when no outcome provided", async () => {
      // given
      const metricsById = new Map<string, HandoffMetrics>([
        ["ho_1", { ...DEFAULT_HANDOFF_METRICS }],
      ])

      const tracker = new CitationTracker(async (handoffId, updater) => {
        const current = metricsById.get(handoffId) ?? { ...DEFAULT_HANDOFF_METRICS }
        const next = updater(current)
        metricsById.set(handoffId, next)
      })

      await tracker.onHandoffsInjected("session_1", ["ho_1"])

      // when - settle without any outcome (no intermediate cached either)
      await tracker.onSessionSettled("session_1")

      // then - defaults to partial
      const updated = metricsById.get("ho_1")
      expect(updated?.citationCount).toBe(1)
      expect(updated?.successfulCitations).toBe(0) // partial != success
    })
  })

  describe("Bayesian authority scoring", () => {
    it("starts at 0.5 (neutral) with no citations", () => {
      // given
      const metrics: HandoffMetrics = { ...DEFAULT_HANDOFF_METRICS }

      // when
      const score = calculateAuthorityScore(metrics)

      // then - Beta(1,1) prior gives 1/2 = 0.5
      expect(score).toBe(0.5)
    })

    it("drops mildly on first pending (0.33, not 0)", () => {
      // given - first citation with no success
      const metrics: HandoffMetrics = {
        ...DEFAULT_HANDOFF_METRICS,
        citationCount: 1,
        successfulCitations: 0,
      }

      // when
      const score = calculateAuthorityScore(metrics)

      // then - (0+1)/(1+2) * (1 + log10(2)/2) ≈ 0.33 * 1.15 ≈ 0.38
      expect(score).toBeGreaterThan(0.3)
      expect(score).toBeLessThan(0.5)
    })

    it("rises on first successful citation", () => {
      // given - first citation with success
      const metrics: HandoffMetrics = {
        ...DEFAULT_HANDOFF_METRICS,
        citationCount: 1,
        successfulCitations: 1,
      }

      // when
      const score = calculateAuthorityScore(metrics)

      // then - (1+1)/(1+2) * (1 + log10(2)/2) ≈ 0.67 * 1.15 ≈ 0.77
      expect(score).toBeGreaterThan(0.7)
      expect(score).toBeLessThan(0.9)
    })

    it("converges toward true rate as citations accumulate", () => {
      // given - 10 citations, 8 successful (80% success rate)
      const metrics: HandoffMetrics = {
        ...DEFAULT_HANDOFF_METRICS,
        citationCount: 10,
        successfulCitations: 8,
      }

      // when
      const score = calculateAuthorityScore(metrics)

      // then - smoothed rate = (8+1)/(10+2) = 0.75
      // citationBoost = log10(11)/2 ≈ 0.52
      // score ≈ 0.75 * 1.52 ≈ 1.14 → capped at 1.0
      expect(score).toBe(1.0)
    })

    it("penalizes poor success rate appropriately", () => {
      // given - 10 citations, 2 successful (20% success rate)
      const metrics: HandoffMetrics = {
        ...DEFAULT_HANDOFF_METRICS,
        citationCount: 10,
        successfulCitations: 2,
      }

      // when
      const score = calculateAuthorityScore(metrics)

      // then - smoothed rate = (2+1)/(10+2) = 0.25
      // citationBoost = log10(11)/2 ≈ 0.52
      // score ≈ 0.25 * 1.52 ≈ 0.38
      expect(score).toBeGreaterThan(0.3)
      expect(score).toBeLessThan(0.5)
    })
  })

  describe("utility methods", () => {
    it("clears stale citations", async () => {
      // given
      const tracker = new CitationTracker(async () => {})

      await tracker.onHandoffsInjected("session_old", ["ho_1"])
      await tracker.onHandoffsInjected("session_new", ["ho_2"])

      // Simulate time passing for old session
      const pending = tracker.getPendingCitation("session_old")
      if (pending) {
        // Manually backdate for testing
        ;(pending as { injectedAt: number }).injectedAt = Date.now() - 2 * 60 * 60 * 1000
      }

      // when - clear citations older than 1 hour
      const cleared = tracker.clearStaleCitations(60 * 60 * 1000)

      // then
      expect(cleared).toBe(1)
      expect(tracker.hasPendingCitation("session_old")).toBe(false)
      expect(tracker.hasPendingCitation("session_new")).toBe(true)
    })

    it("tracks pending and settled counts", async () => {
      // given
      const tracker = new CitationTracker(async () => {})

      // when
      await tracker.onHandoffsInjected("session_1", ["ho_1"])
      await tracker.onHandoffsInjected("session_2", ["ho_2"])
      await tracker.onSessionSettled("session_1", "completed")

      // then
      expect(tracker.getPendingCount()).toBe(1)
      expect(tracker.getSettledCount()).toBe(1)
      expect(tracker.getPendingSessionIds()).toEqual(["session_2"])
    })
  })
})
