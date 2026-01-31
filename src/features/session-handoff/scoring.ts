/**
 * Handoff Scoring System
 *
 * Multi-factor scoring combining semantic relevance,
 * temporal freshness, and authority from citation history.
 */

import type {
  HandoffPackage,
  HandoffMetrics,
  HalfLifeConfig,
  ScoringWeights,
  ScoredHandoff,
} from "./types"
import {
  DEFAULT_HANDOFF_METRICS,
  DEFAULT_HALF_LIFE_CONFIG,
  DEFAULT_SCORING_WEIGHTS,
} from "./types"

// ============================================================================
// Configuration
// ============================================================================

export interface ScoringConfig {
  /** Scoring weights (must sum to 1.0) */
  weights: ScoringWeights

  /** Half-life configuration for temporal decay */
  halfLife: HalfLifeConfig

  /** Minimum score for injection */
  minScore: number
}

export const DEFAULT_SCORING_CONFIG: ScoringConfig = {
  weights: DEFAULT_SCORING_WEIGHTS,
  halfLife: DEFAULT_HALF_LIFE_CONFIG,
  minScore: 0.25,
}

// ============================================================================
// Temporal Freshness (Half-Life Decay)
// ============================================================================

/**
 * Calculate temporal freshness using half-life decay
 *
 * Formula: freshness = 0.5^(ageDays / halfLifeDays)
 *
 * This gives:
 * - Age = 0: freshness = 1.0
 * - Age = halfLife: freshness = 0.5
 * - Age = 2*halfLife: freshness = 0.25
 * - Pinned: freshness = 1.0 (no decay)
 */
export function calculateFreshness(
  metrics: HandoffMetrics,
  createdAt: number,
  halfLifeConfig: HalfLifeConfig,
  now: number = Date.now()
): number {
  // Use lastCitedAt if available, otherwise createdAt
  const referenceTime = metrics.lastCitedAt > 0 ? metrics.lastCitedAt : createdAt
  const ageMs = now - referenceTime
  const ageDays = ageMs / (1000 * 60 * 60 * 24)

  // Pinned handoffs don't decay
  if (metrics.manualPinned) {
    return 1.0
  }

  // Select half-life based on handoff characteristics
  const halfLifeDays = metrics.isArchitectural
    ? halfLifeConfig.architectural
    : halfLifeConfig.default

  // Exponential decay: freshness = 0.5^(age/halfLife)
  return Math.pow(0.5, ageDays / halfLifeDays)
}

// ============================================================================
// Semantic Relevance
// ============================================================================

/**
 * Simple keyword-based relevance scoring
 * In production, this would use embeddings for semantic similarity
 */
export function calculateKeywordRelevance(
  handoff: HandoffPackage,
  query: string
): number {
  const queryLower = query.toLowerCase()
  const queryWords = new Set(
    queryLower
      .split(/\s+/)
      .filter((w) => w.length > 2)
      .filter((w) => !STOP_WORDS.has(w))
  )

  if (queryWords.size === 0) return 0.5 // Neutral if no meaningful words

  // Collect all text from handoff
  const handoffText = [
    handoff.metadata.originalGoal,
    ...handoff.payload.decisions.map((d) => `${d.what} ${d.chosen} ${d.why}`),
    ...handoff.payload.antiPatterns.map((a) => `${a.approach} ${a.reason}`),
    ...handoff.payload.domainContext,
    ...handoff.metadata.keyFiles,
  ]
    .join(" ")
    .toLowerCase()

  // Count matching words
  let matches = 0
  for (const word of queryWords) {
    if (handoffText.includes(word)) {
      matches++
    }
  }

  return matches / queryWords.size
}

/**
 * Common stop words to ignore in relevance scoring
 */
const STOP_WORDS = new Set([
  "the",
  "a",
  "an",
  "and",
  "or",
  "but",
  "in",
  "on",
  "at",
  "to",
  "for",
  "of",
  "with",
  "by",
  "from",
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "being",
  "have",
  "has",
  "had",
  "do",
  "does",
  "did",
  "will",
  "would",
  "could",
  "should",
  "may",
  "might",
  "can",
  "this",
  "that",
  "these",
  "those",
  "it",
  "its",
  "i",
  "you",
  "we",
  "they",
  "he",
  "she",
  "my",
  "your",
  "our",
  "their",
])

// ============================================================================
// Combined Scoring
// ============================================================================

/**
 * Compute combined score for a handoff
 *
 * Formula: (relevance × W_r) + (freshness × W_f) + (authority × W_a)
 */
export function computeHandoffScore(
  handoff: HandoffPackage,
  query: string,
  config: ScoringConfig = DEFAULT_SCORING_CONFIG,
  now: number = Date.now()
): ScoredHandoff {
  const metrics = handoff.metrics ?? DEFAULT_HANDOFF_METRICS
  const { weights, halfLife } = config

  // 1. Semantic relevance
  const relevance = calculateKeywordRelevance(handoff, query)

  // 2. Temporal freshness
  const freshness = calculateFreshness(metrics, handoff.createdAt, halfLife, now)

  // 3. Authority from citation history
  const authority = metrics.authorityScore

  // Weighted combination
  const score =
    relevance * weights.relevance +
    freshness * weights.freshness +
    authority * weights.authority

  return {
    handoff,
    score,
    components: {
      relevance,
      freshness,
      authority,
    },
  }
}

/**
 * Score and rank multiple handoffs
 */
export function scoreAndRankHandoffs(
  handoffs: HandoffPackage[],
  query: string,
  config: ScoringConfig = DEFAULT_SCORING_CONFIG,
  now: number = Date.now()
): ScoredHandoff[] {
  return handoffs
    .map((h) => computeHandoffScore(h, query, config, now))
    .sort((a, b) => b.score - a.score)
}

/**
 * Filter handoffs by minimum score
 */
export function filterByMinScore(
  scoredHandoffs: ScoredHandoff[],
  minScore: number = DEFAULT_SCORING_CONFIG.minScore
): ScoredHandoff[] {
  return scoredHandoffs.filter((s) => s.score >= minScore)
}

// ============================================================================
// Integration with Embedding-based Relevance
// ============================================================================

/**
 * Compute score with pre-computed embedding relevance
 * Use this when embeddings are available
 */
export function computeHandoffScoreWithEmbedding(
  handoff: HandoffPackage,
  embeddingRelevance: number,
  config: ScoringConfig = DEFAULT_SCORING_CONFIG,
  now: number = Date.now()
): ScoredHandoff {
  const metrics = handoff.metrics ?? DEFAULT_HANDOFF_METRICS
  const { weights, halfLife } = config

  // Use provided embedding relevance instead of keyword-based
  const relevance = embeddingRelevance

  // 2. Temporal freshness
  const freshness = calculateFreshness(metrics, handoff.createdAt, halfLife, now)

  // 3. Authority from citation history
  const authority = metrics.authorityScore

  // Weighted combination
  const score =
    relevance * weights.relevance +
    freshness * weights.freshness +
    authority * weights.authority

  return {
    handoff,
    score,
    components: {
      relevance,
      freshness,
      authority,
    },
  }
}

// ============================================================================
// Score Explanation
// ============================================================================

/**
 * Generate human-readable explanation of a score
 */
export function explainScore(scored: ScoredHandoff): string {
  const { score, components } = scored
  const { relevance, freshness, authority } = components

  const parts: string[] = []

  // Relevance explanation
  if (relevance >= 0.7) {
    parts.push("highly relevant to query")
  } else if (relevance >= 0.4) {
    parts.push("moderately relevant")
  } else {
    parts.push("low relevance")
  }

  // Freshness explanation
  if (freshness >= 0.8) {
    parts.push("very fresh")
  } else if (freshness >= 0.5) {
    parts.push("reasonably fresh")
  } else {
    parts.push("aging")
  }

  // Authority explanation
  if (authority >= 0.8) {
    parts.push("high authority (proven useful)")
  } else if (authority >= 0.6) {
    parts.push("good authority")
  } else if (authority < 0.3) {
    parts.push("low authority")
  }

  return `Score: ${(score * 100).toFixed(0)}% (${parts.join(", ")})`
}

// ============================================================================
// Scoring Weight Validation
// ============================================================================

/**
 * Validate that scoring weights sum to 1.0
 */
export function validateWeights(weights: ScoringWeights): boolean {
  const sum = weights.relevance + weights.freshness + weights.authority
  return Math.abs(sum - 1.0) < 0.001 // Allow small floating point error
}

/**
 * Normalize weights to sum to 1.0
 */
export function normalizeWeights(weights: ScoringWeights): ScoringWeights {
  const sum = weights.relevance + weights.freshness + weights.authority

  if (sum === 0) {
    return DEFAULT_SCORING_WEIGHTS
  }

  return {
    relevance: weights.relevance / sum,
    freshness: weights.freshness / sum,
    authority: weights.authority / sum,
  }
}
