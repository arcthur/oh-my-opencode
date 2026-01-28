/**
 * Vector Search Module
 *
 * Cosine similarity-based vector search implementation.
 */

import type { VectorSearchResult } from "./types"

/**
 * Calculate cosine similarity between two vectors.
 *
 * @param a - First vector
 * @param b - Second vector
 * @returns Cosine similarity clamped to [0, 1] (negative -> 0)
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || b.length === 0) return 0

  const len = Math.min(a.length, b.length)
  let dotProduct = 0
  let normA = 0
  let normB = 0

  for (let i = 0; i < len; i++) {
    const av = a[i] ?? 0
    const bv = b[i] ?? 0
    dotProduct += av * bv
    normA += av * av
    normB += bv * bv
  }

  if (normA === 0 || normB === 0) return 0

  const similarity = dotProduct / (Math.sqrt(normA) * Math.sqrt(normB))

  // Clamp raw cosine to [0, 1] to avoid a 0.5 baseline for orthogonal vectors.
  // This makes the score compatible with other [0, 1] similarity signals (BM25 rank, Jaccard).
  return Math.max(0, Math.min(1, similarity))
}

/**
 * Raw cosine similarity without normalization.
 * Returns value in [-1, 1] range.
 */
export function rawCosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || b.length === 0) return 0

  const len = Math.min(a.length, b.length)
  let dotProduct = 0
  let normA = 0
  let normB = 0

  for (let i = 0; i < len; i++) {
    const av = a[i] ?? 0
    const bv = b[i] ?? 0
    dotProduct += av * bv
    normA += av * av
    normB += bv * bv
  }

  if (normA === 0 || normB === 0) return 0

  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB))
}

/**
 * Search candidates by vector similarity.
 *
 * @param queryVector - Query embedding vector
 * @param candidates - Candidate documents with vectors
 * @param topK - Number of top results to return
 * @param minScore - Minimum score threshold (default: 0)
 * @returns Top-k results sorted by score descending
 */
export function searchByVector(
  queryVector: number[],
  candidates: Array<{ id: string; vector: number[] }>,
  topK: number,
  minScore: number = 0
): VectorSearchResult[] {
  const scored = candidates
    .map((candidate) => ({
      id: candidate.id,
      score: cosineSimilarity(queryVector, candidate.vector),
    }))
    .filter((result) => result.score >= minScore && Number.isFinite(result.score))

  // Sort by score descending
  scored.sort((a, b) => b.score - a.score)

  return scored.slice(0, topK)
}

/**
 * Compute pairwise similarity between two texts using embeddings.
 *
 * @param vec1 - First embedding vector
 * @param vec2 - Second embedding vector
 * @returns Similarity score in [0, 1]
 */
export function vectorSimilarity(vec1: number[], vec2: number[]): number {
  return cosineSimilarity(vec1, vec2)
}

/**
 * Batch compute similarities between a query and multiple candidates.
 * More efficient than individual calls when processing many candidates.
 *
 * @param queryVector - Query embedding
 * @param candidateVectors - Array of candidate embeddings
 * @returns Array of similarity scores in same order as candidates
 */
export function batchVectorSimilarity(
  queryVector: number[],
  candidateVectors: number[][]
): number[] {
  return candidateVectors.map((candidate) => cosineSimilarity(queryVector, candidate))
}
