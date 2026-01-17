/**
 * Semantic Similarity Module
 *
 * Enhanced similarity calculation for lesson clustering.
 * Combines word overlap, synonym expansion, and n-gram matching.
 */

import {
  preprocessText,
  expandWithSynonyms,
  extractNgrams,
} from "./text-processing"

// ============================================================================
// Similarity Configuration
// ============================================================================

export interface SimilarityConfig {
  /** Weight for base word overlap (default: 0.5) */
  baseWeight: number
  /** Weight for synonym-expanded overlap (default: 0.3) */
  synonymWeight: number
  /** Weight for bigram overlap (default: 0.2) */
  ngramWeight: number
  /** Threshold for high confidence match */
  highConfidenceThreshold: number
  /** Threshold for candidate selection */
  candidateThreshold: number
}

export const DEFAULT_SIMILARITY_CONFIG: SimilarityConfig = {
  baseWeight: 0.5,
  synonymWeight: 0.3,
  ngramWeight: 0.2,
  highConfidenceThreshold: 0.6,
  candidateThreshold: 0.25,
}

// ============================================================================
// Jaccard Similarity
// ============================================================================

/**
 * Calculate Jaccard similarity between two sets
 */
export function jaccardSimilarity<T>(setA: Set<T>, setB: Set<T>): number {
  if (setA.size === 0 && setB.size === 0) return 1.0
  if (setA.size === 0 || setB.size === 0) return 0.0

  let intersection = 0
  for (const item of setA) {
    if (setB.has(item)) intersection++
  }

  const union = setA.size + setB.size - intersection
  return union > 0 ? intersection / union : 0
}

// ============================================================================
// Enhanced Similarity
// ============================================================================

export type SimilarityConfidence = "high" | "medium" | "low"

export interface SimilarityResult {
  /** Overall similarity score (0-1) */
  score: number
  /** Confidence level for auto-merge decisions */
  confidence: SimilarityConfidence
  /** Component scores for debugging */
  components: {
    baseOverlap: number
    synonymOverlap: number
    ngramOverlap: number
  }
}

/**
 * Calculate enhanced similarity between two text strings.
 *
 * Combines multiple signals:
 * 1. Base word overlap (preprocessed, stemmed)
 * 2. Synonym-expanded overlap
 * 3. Bigram overlap for phrase matching
 *
 * @param text1 - First text to compare
 * @param text2 - Second text to compare
 * @param config - Similarity configuration
 */
export function calculateSimilarity(
  text1: string,
  text2: string,
  config: SimilarityConfig = DEFAULT_SIMILARITY_CONFIG
): SimilarityResult {
  // Preprocess both texts
  const words1 = preprocessText(text1)
  const words2 = preprocessText(text2)

  // Base word overlap
  const baseOverlap = jaccardSimilarity(words1, words2)

  // Synonym-expanded overlap
  const expanded1 = expandWithSynonyms(words1)
  const expanded2 = expandWithSynonyms(words2)
  const synonymOverlap = jaccardSimilarity(expanded1, expanded2)

  // Bigram overlap for phrase matching
  const ngrams1 = extractNgrams(text1, 2)
  const ngrams2 = extractNgrams(text2, 2)
  const ngramOverlap = jaccardSimilarity(ngrams1, ngrams2)

  // Weighted combination
  const score =
    config.baseWeight * baseOverlap +
    config.synonymWeight * synonymOverlap +
    config.ngramWeight * ngramOverlap

  // Determine confidence level
  let confidence: SimilarityConfidence
  if (score >= config.highConfidenceThreshold) {
    confidence = "high"
  } else if (score >= config.candidateThreshold) {
    confidence = "medium"
  } else {
    confidence = "low"
  }

  return {
    score,
    confidence,
    components: {
      baseOverlap,
      synonymOverlap,
      ngramOverlap,
    },
  }
}

