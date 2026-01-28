/**
 * Hybrid Search Module
 *
 * Three-way hybrid search combining:
 * - Vector similarity (semantic)
 * - BM25 (keyword precision)
 * - Jaccard (n-gram/synonym matching)
 */

import type {
  EmbeddingProvider,
  EmbeddingCache,
  BM25Index,
  HybridWeights,
  HybridSearchResult,
  HybridSimilarityResult,
  VectorSearchResult,
  BM25SearchResult,
} from "./types"
import { DEFAULT_HYBRID_WEIGHTS } from "./types"
import { cosineSimilarity, rawCosineSimilarity } from "./search"
import { bm25Search, bm25PairwiseSimilarity } from "./bm25"
import { getCachedEmbedding, setCachedEmbedding } from "./cache"
import { calculateSimilarity, type SimilarityConfig } from "../similarity"

// ============================================================================
// Hybrid Search
// ============================================================================

/**
 * Normalize scores to [0, 1] using per-query min-max scaling.
 * If all scores are (nearly) identical, returns 0.5 for all to avoid amplifying noise.
 */
export function normalizeScoresMinMax(scores: number[]): number[] {
  if (scores.length === 0) return []
  let min = Number.POSITIVE_INFINITY
  let max = Number.NEGATIVE_INFINITY

  for (const s of scores) {
    if (!Number.isFinite(s)) continue
    if (s < min) min = s
    if (s > max) max = s
  }

  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    return scores.map(() => 0.5)
  }

  const range = max - min
  if (range < 1e-9) {
    return scores.map(() => 0.5)
  }

  return scores.map((s) => {
    const v = (s - min) / range
    return Math.max(0, Math.min(1, v))
  })
}

/**
 * Candidate for hybrid search
 */
export interface HybridCandidate {
  id: string
  text: string
  vector?: number[] // Pre-computed or from cache
}

/**
 * Perform three-way hybrid search.
 *
 * @param query - Search query text
 * @param candidates - Candidate documents
 * @param weights - Hybrid weights
 * @param provider - Embedding provider
 * @param cache - Embedding cache
 * @param bm25Index - BM25 index
 * @param topK - Number of top results
 * @returns Hybrid search results
 */
export async function searchHybrid(
  query: string,
  candidates: HybridCandidate[],
  weights: HybridWeights,
  provider: EmbeddingProvider,
  cache: EmbeddingCache,
  bm25Index: BM25Index,
  topK: number
): Promise<HybridSearchResult[]> {
  if (candidates.length === 0) {
    return []
  }

  // 1. Get query embedding
  const [queryVector] = await provider.embed([query])

  // 2. Prepare candidate vectors
  const candidatesWithVectors = await Promise.all(
    candidates.map(async (c) => {
      // Try cache first
      let vector = c.vector ?? getCachedEmbedding(cache, c.id, c.text)

      // Compute if not cached
      if (!vector) {
        const [computed] = await provider.embed([c.text])
        vector = computed
        setCachedEmbedding(cache, c.id, c.text, vector)
      }

      return { id: c.id, vector }
    })
  )

  // 3. Vector similarity for each candidate, then normalize per query (more stable across models/providers).
  //    - Use raw cosine similarity, clamp negative correlations to 0 (no semantic match)
  //    - Min-max scale across this query's candidate set to avoid baseline shifts and model-dependent score ranges.
  const rawVectorScores = candidatesWithVectors.map((c) => Math.max(0, rawCosineSimilarity(queryVector, c.vector)))
  const normalizedVectorScores = normalizeScoresMinMax(rawVectorScores)
  const vectorResults: VectorSearchResult[] = candidatesWithVectors.map((c, i) => ({
    id: c.id,
    score: normalizedVectorScores[i] ?? 0,
  }))

  // 4. BM25 search
  const bm25Results = bm25Search(query, bm25Index, candidates.length)

  // 5. Jaccard similarity for each candidate
  const jaccardResults = candidates.map((c) => {
    const result = calculateSimilarity(query, c.text)
    return { id: c.id, score: result.score }
  })

  // 6. Merge results
  return mergeHybridResults(
    vectorResults,
    bm25Results,
    jaccardResults,
    weights,
    topK
  )
}

/**
 * Merge results from three search methods.
 *
 * @param vectorResults - Vector search results
 * @param bm25Results - BM25 search results
 * @param jaccardResults - Jaccard similarity results
 * @param weights - Hybrid weights
 * @param topK - Number of top results
 * @returns Merged and sorted results
 */
export function mergeHybridResults(
  vectorResults: VectorSearchResult[],
  bm25Results: BM25SearchResult[],
  jaccardResults: Array<{ id: string; score: number }>,
  weights: HybridWeights,
  topK: number
): HybridSearchResult[] {
  // Create unified map by ID
  const resultMap = new Map<
    string,
    { vectorScore: number; bm25Score: number; jaccardScore: number }
  >()

  // Initialize with vector results
  for (const result of vectorResults) {
    resultMap.set(result.id, {
      vectorScore: result.score,
      bm25Score: 0,
      jaccardScore: 0,
    })
  }

  // Overlay BM25 results
  for (const result of bm25Results) {
    const existing = resultMap.get(result.id)
    if (existing) {
      existing.bm25Score = result.score
    } else {
      resultMap.set(result.id, {
        vectorScore: 0,
        bm25Score: result.score,
        jaccardScore: 0,
      })
    }
  }

  // Overlay Jaccard results
  for (const result of jaccardResults) {
    const existing = resultMap.get(result.id)
    if (existing) {
      existing.jaccardScore = result.score
    } else {
      resultMap.set(result.id, {
        vectorScore: 0,
        bm25Score: 0,
        jaccardScore: result.score,
      })
    }
  }

  // Calculate combined scores and sort
  const results: HybridSearchResult[] = []

  for (const [id, scores] of resultMap) {
    const combinedScore =
      weights.vector * scores.vectorScore +
      weights.bm25 * scores.bm25Score +
      weights.jaccard * scores.jaccardScore

    results.push({
      id,
      vectorScore: scores.vectorScore,
      bm25Score: scores.bm25Score,
      jaccardScore: scores.jaccardScore,
      combinedScore,
    })
  }

  // Sort by combined score descending
  results.sort((a, b) => b.combinedScore - a.combinedScore)

  return results.slice(0, topK)
}

// ============================================================================
// Pairwise Hybrid Similarity
// ============================================================================

/**
 * Calculate three-way hybrid similarity between two texts.
 * Used for clustering and deduplication.
 *
 * @param text1 - First text
 * @param text2 - Second text
 * @param provider - Embedding provider
 * @param cache - Embedding cache
 * @param weights - Hybrid weights
 * @param id1 - Optional ID for text1 (for caching)
 * @param id2 - Optional ID for text2 (for caching)
 * @returns Hybrid similarity result
 */
export async function calculateHybridSimilarity(
  text1: string,
  text2: string,
  provider: EmbeddingProvider,
  cache: EmbeddingCache,
  weights: HybridWeights = DEFAULT_HYBRID_WEIGHTS,
  id1?: string,
  id2?: string
): Promise<HybridSimilarityResult> {
  // 1. Vector similarity
  let vec1 = id1 ? getCachedEmbedding(cache, id1, text1) : null
  let vec2 = id2 ? getCachedEmbedding(cache, id2, text2) : null

  // Compute missing embeddings
  const textsToEmbed: string[] = []
  const indices: Array<1 | 2> = []

  if (!vec1) {
    textsToEmbed.push(text1)
    indices.push(1)
  }
  if (!vec2) {
    textsToEmbed.push(text2)
    indices.push(2)
  }

  if (textsToEmbed.length > 0) {
    const embeddings = await provider.embed(textsToEmbed)
    for (let i = 0; i < indices.length; i++) {
      if (indices[i] === 1) {
        vec1 = embeddings[i]
        if (id1) setCachedEmbedding(cache, id1, text1, vec1)
      } else {
        vec2 = embeddings[i]
        if (id2) setCachedEmbedding(cache, id2, text2, vec2)
      }
    }
  }

  const vectorScore = cosineSimilarity(vec1!, vec2!)

  // 2. BM25-style similarity (pairwise)
  const bm25Score = bm25PairwiseSimilarity(text1, text2)

  // 3. Jaccard similarity (existing)
  const jaccardResult = calculateSimilarity(text1, text2)
  const jaccardScore = jaccardResult.score

  // 4. Combined score
  const combinedScore =
    weights.vector * vectorScore +
    weights.bm25 * bm25Score +
    weights.jaccard * jaccardScore

  // 5. Determine confidence
  let confidence: "high" | "medium" | "low"
  if (combinedScore >= 0.6) {
    confidence = "high"
  } else if (combinedScore >= 0.25) {
    confidence = "medium"
  } else {
    confidence = "low"
  }

  return {
    score: combinedScore,
    confidence,
    components: {
      vectorScore,
      bm25Score,
      jaccardScore,
    },
  }
}

/**
 * Calculate hybrid similarity without embeddings.
 * Fallback when embeddings are disabled.
 */
export function calculateHybridSimilarityWithoutVector(
  text1: string,
  text2: string,
  weights: HybridWeights = DEFAULT_HYBRID_WEIGHTS
): HybridSimilarityResult {
  // Only use BM25 and Jaccard
  const bm25Score = bm25PairwiseSimilarity(text1, text2)
  const jaccardResult = calculateSimilarity(text1, text2)
  const jaccardScore = jaccardResult.score

  // Redistribute vector weight to other two (guard against division by zero)
  const nonVectorSum = weights.bm25 + weights.jaccard
  let adjustedBm25Weight: number
  let adjustedJaccardWeight: number

  if (nonVectorSum === 0) {
    // If both BM25 and Jaccard weights are 0, split evenly
    adjustedBm25Weight = 0.5
    adjustedJaccardWeight = 0.5
  } else {
    adjustedBm25Weight = weights.bm25 + weights.vector * (weights.bm25 / nonVectorSum)
    adjustedJaccardWeight = weights.jaccard + weights.vector * (weights.jaccard / nonVectorSum)
  }

  const combinedScore =
    adjustedBm25Weight * bm25Score + adjustedJaccardWeight * jaccardScore

  let confidence: "high" | "medium" | "low"
  if (combinedScore >= 0.6) {
    confidence = "high"
  } else if (combinedScore >= 0.25) {
    confidence = "medium"
  } else {
    confidence = "low"
  }

  return {
    score: combinedScore,
    confidence,
    components: {
      vectorScore: 0, // No vector score
      bm25Score,
      jaccardScore,
    },
  }
}

// ============================================================================
// Batch Operations
// ============================================================================

/**
 * Batch embed texts with caching.
 *
 * @param texts - Texts to embed
 * @param ids - Corresponding IDs for caching
 * @param provider - Embedding provider
 * @param cache - Embedding cache
 * @param batchSize - Batch size for API calls
 * @returns Embeddings in same order as input
 */
export async function batchEmbed(
  texts: string[],
  ids: string[],
  provider: EmbeddingProvider,
  cache: EmbeddingCache,
  batchSize: number = 20
): Promise<number[][]> {
  const results: Array<number[] | null> = new Array(texts.length).fill(null)
  const toCompute: Array<{ index: number; text: string; id: string }> = []

  // Check cache first
  for (let i = 0; i < texts.length; i++) {
    const cached = getCachedEmbedding(cache, ids[i], texts[i])
    if (cached) {
      results[i] = cached
    } else {
      toCompute.push({ index: i, text: texts[i], id: ids[i] })
    }
  }

  // Batch compute missing embeddings
  for (let i = 0; i < toCompute.length; i += batchSize) {
    const batch = toCompute.slice(i, i + batchSize)
    const batchTexts = batch.map((item) => item.text)
    const embeddings = await provider.embed(batchTexts)

    // Store results and update cache
    for (let j = 0; j < batch.length; j++) {
      const item = batch[j]
      const embedding = embeddings[j]
      results[item.index] = embedding
      setCachedEmbedding(cache, item.id, item.text, embedding)
    }
  }

  return results as number[][]
}
