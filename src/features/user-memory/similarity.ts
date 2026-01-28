/**
 * Semantic Similarity Module
 *
 * Enhanced similarity calculation for lesson clustering.
 * Combines word overlap, synonym expansion, and n-gram matching.
 *
 * With embeddings enabled, supports three-way hybrid search:
 * - Vector similarity (semantic understanding)
 * - BM25 (keyword precision)
 * - Jaccard (n-gram/synonym matching)
 */

import {
  preprocessText,
  expandWithSynonyms,
  extractNgrams,
} from "./text-processing"
import type {
  EmbeddingConfig,
  EmbeddingProvider,
  EmbeddingCache,
  HybridWeights,
  HybridSimilarityResult,
} from "./embeddings/types"
import {
  calculateHybridSimilarity as calculateHybridSimilarityCore,
  calculateHybridSimilarityWithoutVector,
} from "./embeddings/hybrid"

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
  /** Enable synonym canonicalization + expansion (default: true) */
  useSynonyms: boolean
  /** Enable Porter stemming (default: true) */
  useStemming: boolean
  /** Threshold for high confidence match */
  highConfidenceThreshold: number
  /** Threshold for candidate selection */
  candidateThreshold: number
}

export const DEFAULT_SIMILARITY_CONFIG: SimilarityConfig = {
  baseWeight: 0.5,
  synonymWeight: 0.3,
  ngramWeight: 0.2,
  useSynonyms: true,
  useStemming: true,
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
  const words1 = preprocessText(text1, {
    useStemming: config.useStemming,
    useSynonyms: config.useSynonyms,
  })
  const words2 = preprocessText(text2, {
    useStemming: config.useStemming,
    useSynonyms: config.useSynonyms,
  })

  // Base word overlap
  const baseOverlap = jaccardSimilarity(words1, words2)

  // Synonym-expanded overlap
  const synonymOverlap = config.useSynonyms
    ? jaccardSimilarity(expandWithSynonyms(words1), expandWithSynonyms(words2))
    : 0

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

// ============================================================================
// Hybrid Similarity (Vector + BM25 + Jaccard)
// ============================================================================

/**
 * Context for hybrid similarity calculation.
 * Created once and reused for multiple comparisons.
 */
export interface HybridSimilarityContext {
  provider: EmbeddingProvider
  cache: EmbeddingCache
  weights: HybridWeights
}

/**
 * Calculate three-way hybrid similarity between two texts.
 *
 * When embeddings are enabled, combines:
 * - Vector similarity (semantic understanding via embeddings)
 * - BM25 (keyword precision)
 * - Jaccard (n-gram and synonym matching)
 *
 * Falls back to BM25 + Jaccard when embeddings are disabled.
 *
 * @param text1 - First text to compare
 * @param text2 - Second text to compare
 * @param context - Optional hybrid context with provider, cache, and weights
 * @param id1 - Optional ID for text1 (for caching)
 * @param id2 - Optional ID for text2 (for caching)
 * @returns Hybrid similarity result
 */
export async function calculateSimilarityWithEmbeddings(
  text1: string,
  text2: string,
  context?: HybridSimilarityContext,
  id1?: string,
  id2?: string
): Promise<HybridSimilarityResult> {
  if (context) {
    // Full hybrid with vector
    return calculateHybridSimilarityCore(
      text1,
      text2,
      context.provider,
      context.cache,
      context.weights,
      id1,
      id2
    )
  }

  // Fallback: BM25 + Jaccard only
  return calculateHybridSimilarityWithoutVector(text1, text2)
}

/**
 * Synchronous hybrid similarity without vector component.
 * Useful when embeddings are disabled or for quick comparisons.
 *
 * @param text1 - First text to compare
 * @param text2 - Second text to compare
 * @param weights - Optional hybrid weights
 * @returns Hybrid similarity result
 */
export function calculateSimilaritySync(
  text1: string,
  text2: string,
  weights?: HybridWeights
): HybridSimilarityResult {
  return calculateHybridSimilarityWithoutVector(text1, text2, weights)
}
