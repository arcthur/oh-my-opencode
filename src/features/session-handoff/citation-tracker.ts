/**
 * Citation Tracker
 *
 * Tracks handoff citations (injections) and session outcomes
 * to calculate authority scores and support L3 promotion.
 *
 * Key design decisions:
 * 1. Bayesian smoothing for authority to avoid cold-start penalty
 * 2. Two-phase tracking: injection (record pending) → settlement (update metrics)
 * 3. Authority only updated on settlement, not injection
 */

import type {
  HandoffPackage,
  HandoffMetrics,
  HandoffMetricsSummary,
  L3PromotionReason,
} from "./types"
import { DEFAULT_HANDOFF_METRICS } from "./types"

// ============================================================================
// Types
// ============================================================================

/**
 * Session outcome for citation tracking
 */
export type SessionOutcome = "completed" | "partial" | "blocked"

/**
 * Pending citation to be resolved when session ends
 */
interface PendingCitation {
  sessionId: string
  handoffIds: string[]
  injectedAt: number
  /** Cached outcome from intermediate checks (e.g., idle events) */
  intermediateOutcome?: SessionOutcome
}

// ============================================================================
// Bayesian Authority Configuration
// ============================================================================

/**
 * Bayesian prior configuration for authority smoothing
 *
 * Uses Beta(priorSuccesses, priorFailures) prior.
 * Beta(1, 1) = uniform prior, equivalent to:
 * - 1 pseudo-success
 * - 1 pseudo-failure
 * - Starting success rate = 1/2 = 0.5
 *
 * This ensures:
 * - New handoffs start at 0.5 (neutral)
 * - First citation doesn't crash authority to 0
 * - Gradual convergence to true success rate
 */
export interface BayesianPrior {
  /** Pseudo-successes (default: 1) */
  priorSuccesses: number
  /** Pseudo-citations (default: 2, so prior rate = 0.5) */
  priorTotal: number
}

export const DEFAULT_BAYESIAN_PRIOR: BayesianPrior = {
  priorSuccesses: 1,
  priorTotal: 2,
}

// ============================================================================
// Authority Score Calculation
// ============================================================================

/**
 * Calculate authority score using Bayesian smoothing
 *
 * Formula: smoothedSuccessRate * (1 + citationBoost)
 * Where:
 *   smoothedSuccessRate = (successes + prior.successes) / (citations + prior.total)
 *   citationBoost = log10(citations + 1) / 2
 *
 * Benefits over naive calculation:
 * - New handoffs: 0.5 (neutral, not penalized)
 * - First pending citation: (0+1)/(1+2) = 0.33 (mild drop, not 0)
 * - First successful citation: (1+1)/(1+2) = 0.67 (mild boost)
 * - Converges to true rate as citations accumulate
 *
 * Examples:
 * | Citations | Successful | Naive Rate | Smoothed Rate | Authority |
 * |-----------|------------|------------|---------------|-----------|
 * | 0         | 0          | -          | 0.50          | 0.50      |
 * | 1         | 0          | 0.00       | 0.33          | 0.33      |
 * | 1         | 1          | 1.00       | 0.67          | 0.77      |
 * | 5         | 3          | 0.60       | 0.57          | 0.77      |
 * | 10        | 8          | 0.80       | 0.75          | 1.00      |
 * | 10        | 2          | 0.20       | 0.25          | 0.34      |
 */
export function calculateAuthorityScore(
  metrics: HandoffMetrics,
  prior: BayesianPrior = DEFAULT_BAYESIAN_PRIOR
): number {
  const { citationCount, successfulCitations } = metrics

  // Bayesian smoothed success rate
  const smoothedRate =
    (successfulCitations + prior.priorSuccesses) / (citationCount + prior.priorTotal)

  // Boost for well-cited handoffs (logarithmic scaling)
  // log10(1) = 0, log10(11) ≈ 1, log10(101) ≈ 2
  const citationBoost = Math.log10(citationCount + 1) / 2

  // Combined score, capped at 1.0
  return Math.min(1.0, smoothedRate * (1 + citationBoost))
}

/**
 * Calculate raw (non-smoothed) success rate for debugging
 */
export function calculateRawSuccessRate(metrics: HandoffMetrics): number {
  if (metrics.citationCount === 0) return 0.5
  return metrics.successfulCitations / metrics.citationCount
}

// ============================================================================
// Architectural Detection
// ============================================================================

/**
 * Check if a handoff contains architectural decisions
 */
export function isArchitecturalHandoff(handoff: HandoffPackage): boolean {
  const { decisions } = handoff.payload

  // Check for architecture-category decisions
  const hasArchDecision = decisions.some((d) => d.category === "architecture")

  // Check for high-impact decisions (affects multiple files)
  const hasHighImpact = decisions.some((d) => (d.relatedFiles?.length ?? 0) >= 3)

  // Check for convention/pattern decisions
  const hasConvention = decisions.some((d) => d.category === "convention")

  return hasArchDecision || hasHighImpact || hasConvention
}

// ============================================================================
// L3 Promotion
// ============================================================================

/**
 * L3 promotion rules
 */
interface L3PromotionRule {
  condition: (handoff: HandoffPackage) => boolean
  reason: L3PromotionReason
}

const L3_PROMOTION_RULES: L3PromotionRule[] = [
  {
    condition: (h) => (h.metrics?.successfulCitations ?? 0) >= 3,
    reason: "proven-valuable",
  },
  {
    condition: (h) => h.metrics?.isArchitectural === true,
    reason: "architectural-decision",
  },
  {
    condition: (h) => h.metrics?.manualPinned === true,
    reason: "user-pinned",
  },
  {
    condition: (h) => (h.metrics?.authorityScore ?? 0) >= 0.8,
    reason: "high-authority",
  },
]

/**
 * Check if a handoff qualifies for L3 promotion
 * Returns the promotion reason or null if not eligible
 */
export function checkL3Promotion(handoff: HandoffPackage): L3PromotionReason | null {
  for (const rule of L3_PROMOTION_RULES) {
    if (rule.condition(handoff)) {
      return rule.reason
    }
  }
  return null
}

// ============================================================================
// Metrics Summary
// ============================================================================

/**
 * Create a metrics summary for index storage
 */
export function createMetricsSummary(metrics: HandoffMetrics): HandoffMetricsSummary {
  return {
    authorityScore: metrics.authorityScore,
    citationCount: metrics.citationCount,
    isArchitectural: metrics.isArchitectural,
    manualPinned: metrics.manualPinned,
  }
}

function getL3PromotionReasonFromMetrics(metrics: HandoffMetrics): L3PromotionReason | null {
  if (metrics.successfulCitations >= 3) return "proven-valuable"
  if (metrics.isArchitectural) return "architectural-decision"
  if (metrics.manualPinned) return "user-pinned"
  if (metrics.authorityScore >= 0.8) return "high-authority"
  return null
}

// ============================================================================
// Citation Tracker
// ============================================================================

/**
 * Maximum number of session IDs to track in citedBySessions
 */
const MAX_CITED_BY_SESSIONS = 20

/**
 * Default max age for stale citation cleanup (24 hours)
 */
const DEFAULT_STALE_CITATION_AGE_MS = 24 * 60 * 60 * 1000

export interface CitationTrackerOptions {
  /** Bayesian prior for authority smoothing */
  prior?: BayesianPrior
  /** Auto-cleanup stale citations older than this (ms). 0 = disabled */
  autoCleanupAgeMs?: number
}

/**
 * Citation Tracker
 *
 * Tracks which handoffs are injected into sessions and
 * updates metrics based on session outcomes.
 *
 * Two-phase tracking:
 * 1. onHandoffsInjected(): Records pending citation (no authority update)
 * 2. onSessionSettled(): Updates metrics including authority
 *
 * This avoids the "cold start penalty" where pending citations
 * would temporarily crash authority scores.
 */
export class CitationTracker {
  /** Pending citations waiting for session outcome */
  private pendingCitations: Map<string, PendingCitation> = new Map()

  /** Sessions that have already been settled (to prevent double-counting) */
  private settledSessions: Set<string> = new Set()

  /** Callback to update handoff metrics in storage */
  private updateMetrics: (
    handoffId: string,
    updater: (metrics: HandoffMetrics) => HandoffMetrics
  ) => Promise<void>

  /** Callback to check L3 promotion after metrics update */
  private onL3Candidate?: (handoffId: string, reason: L3PromotionReason) => Promise<void>

  /** Bayesian prior for authority calculation */
  private prior: BayesianPrior

  /** Auto-cleanup age (0 = disabled) */
  private autoCleanupAgeMs: number

  constructor(
    updateMetrics: (
      handoffId: string,
      updater: (metrics: HandoffMetrics) => HandoffMetrics
    ) => Promise<void>,
    onL3Candidate?: (handoffId: string, reason: L3PromotionReason) => Promise<void>,
    options?: CitationTrackerOptions
  ) {
    this.updateMetrics = updateMetrics
    this.onL3Candidate = onL3Candidate
    this.prior = options?.prior ?? DEFAULT_BAYESIAN_PRIOR
    this.autoCleanupAgeMs = options?.autoCleanupAgeMs ?? 0
  }

  /**
   * Record that handoffs were injected into a session
   *
   * Phase 1: Only records pending citation.
   * Does NOT update citationCount or authorityScore yet.
   * This prevents the "cold start penalty" during pending period.
   */
  async onHandoffsInjected(sessionId: string, handoffIds: string[]): Promise<void> {
    if (handoffIds.length === 0) return

    // Run auto-cleanup if configured
    if (this.autoCleanupAgeMs > 0) {
      this.clearStaleCitations(this.autoCleanupAgeMs)
    }

    // Track pending citation (no metrics update yet)
    this.pendingCitations.set(sessionId, {
      sessionId,
      handoffIds,
      injectedAt: Date.now(),
    })
  }

  /**
   * Record an intermediate outcome (e.g., from session.idle)
   *
   * This caches the outcome but does NOT settle the citation.
   * Useful when idle fires before the session actually ends.
   */
  recordIntermediateOutcome(sessionId: string, outcome: SessionOutcome): void {
    const pending = this.pendingCitations.get(sessionId)
    if (pending) {
      pending.intermediateOutcome = outcome
    }
  }

  /**
   * Settle a session's citations with final outcome
   *
   * Phase 2: Updates all metrics including citationCount and authorityScore.
   * Should be called only once per session (on session.deleted).
   *
   * If no explicit outcome provided, uses cached intermediate outcome,
   * or defaults to "partial".
   */
  async onSessionSettled(sessionId: string, outcome?: SessionOutcome): Promise<void> {
    // Prevent double-settlement
    if (this.settledSessions.has(sessionId)) {
      return
    }

    const pending = this.pendingCitations.get(sessionId)
    if (!pending) return

    // Use provided outcome, or cached intermediate, or default to partial
    const finalOutcome = outcome ?? pending.intermediateOutcome ?? "partial"

    // Mark as settled
    this.settledSessions.add(sessionId)
    this.pendingCitations.delete(sessionId)

    // Limit settled sessions memory (keep last 1000)
    if (this.settledSessions.size > 1000) {
      const toRemove = Array.from(this.settledSessions).slice(0, 100)
      for (const id of toRemove) {
        this.settledSessions.delete(id)
      }
    }

    // Now update metrics for all cited handoffs
    for (const handoffId of pending.handoffIds) {
      let promotionReason: L3PromotionReason | null = null
      await this.updateMetrics(handoffId, (metrics) => {
        const newCitationCount = metrics.citationCount + 1
        const newSuccessful =
          finalOutcome === "completed"
            ? metrics.successfulCitations + 1
            : metrics.successfulCitations

        const citedBySessions = [...metrics.citedBySessions, sessionId].slice(
          -MAX_CITED_BY_SESSIONS
        )

        const updatedMetrics: HandoffMetrics = {
          ...metrics,
          citationCount: newCitationCount,
          successfulCitations: newSuccessful,
          lastCitedAt: Date.now(),
          citedBySessions,
          authorityScore: calculateAuthorityScore(
            {
              ...metrics,
              citationCount: newCitationCount,
              successfulCitations: newSuccessful,
            },
            this.prior
          ),
        }

        promotionReason = getL3PromotionReasonFromMetrics(updatedMetrics)
        return updatedMetrics
      })

      if (this.onL3Candidate && promotionReason) {
        await this.onL3Candidate(handoffId, promotionReason)
      }
    }
  }

  /**
   * Get pending citation for a session
   */
  getPendingCitation(sessionId: string): PendingCitation | undefined {
    return this.pendingCitations.get(sessionId)
  }

  /**
   * Check if a session has pending citations
   */
  hasPendingCitation(sessionId: string): boolean {
    return this.pendingCitations.has(sessionId)
  }

  /**
   * Check if a session has already been settled
   */
  isSettled(sessionId: string): boolean {
    return this.settledSessions.has(sessionId)
  }

  /**
   * Clear stale pending citations (older than maxAge)
   * Returns number of citations cleared
   */
  clearStaleCitations(maxAgeMs: number = DEFAULT_STALE_CITATION_AGE_MS): number {
    const now = Date.now()
    let cleared = 0

    for (const [sessionId, citation] of this.pendingCitations) {
      if (now - citation.injectedAt > maxAgeMs) {
        this.pendingCitations.delete(sessionId)
        cleared++
      }
    }

    return cleared
  }

  /**
   * Get count of pending citations (for debugging)
   */
  getPendingCount(): number {
    return this.pendingCitations.size
  }

  /**
   * Get count of settled sessions (for debugging)
   */
  getSettledCount(): number {
    return this.settledSessions.size
  }

  /**
   * Get all pending session IDs (for debugging/testing)
   */
  getPendingSessionIds(): string[] {
    return Array.from(this.pendingCitations.keys())
  }
}

// ============================================================================
// Session Outcome Detection
// ============================================================================

/**
 * Patterns that indicate task completion
 */
const COMPLETION_PATTERNS = [
  /\bdone\b/i,
  /\bcomplete[d]?\b/i,
  /\bfinish(ed)?\b/i,
  /\bship it\b/i,
  /\blgtm\b/i,
  /\bmerge[d]?\b/i,
  /\bcommit(ted)?\b/i,
]

/**
 * Patterns that indicate blocking errors
 */
const BLOCKING_PATTERNS = [
  /\bfatal\b/i,
  /\bcannot\s+continue\b/i,
  /\bblocked\b/i,
  /\bstuck\b/i,
  /\bgive\s*up\b/i,
  /\babort(ed)?\b/i,
]

/**
 * Check if messages contain completion markers
 */
export function hasCompletionMarker(messages: Array<{ content: string }>): boolean {
  // Check last few messages
  const recentMessages = messages.slice(-5)

  for (const msg of recentMessages) {
    if (COMPLETION_PATTERNS.some((p) => p.test(msg.content))) {
      return true
    }
  }

  return false
}

/**
 * Check if messages contain blocking error markers
 */
export function hasBlockingErrors(messages: Array<{ content: string }>): boolean {
  // Check last few messages
  const recentMessages = messages.slice(-5)

  for (const msg of recentMessages) {
    if (BLOCKING_PATTERNS.some((p) => p.test(msg.content))) {
      return true
    }
  }

  return false
}

/**
 * Determine session outcome from messages and file changes
 */
export function determineSessionOutcome(
  messages: Array<{ content: string }>,
  fileChanges: string[],
  durationMs: number
): SessionOutcome {
  // Check for explicit completion markers
  if (hasCompletionMarker(messages)) {
    return "completed"
  }

  // Check for blocking errors in recent messages
  if (hasBlockingErrors(messages)) {
    return "blocked"
  }

  // Heuristic: meaningful work done
  const hasSignificantChanges = fileChanges.length >= 2
  const hasReasonableDuration = durationMs > 5 * 60 * 1000 // 5 minutes

  if (hasSignificantChanges && hasReasonableDuration) {
    return "completed"
  }

  return "partial"
}
