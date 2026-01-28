/**
 * BM25 Ranking Module
 *
 * BM25 (Best Match 25) implementation for keyword-based ranking.
 * Following moltbot's approach for hybrid search.
 */

import { preprocessText } from "../text-processing"
import type {
  BM25Index,
  BM25Document,
  BM25Params,
  BM25SearchResult,
  SerializableBM25Index,
} from "./types"
import { DEFAULT_BM25_PARAMS, BM25_INDEX_VERSION } from "./types"

/**
 * Tokenize text for BM25 indexing.
 * Reuses preprocessText from text-processing.ts for consistency.
 */
function tokenize(text: string): string[] {
  const words = preprocessText(text, {
    useStemming: true,
    useSynonyms: false, // BM25 uses exact terms, no synonym expansion
  })
  return Array.from(words)
}

/**
 * Build BM25 index from documents.
 *
 * @param documents - Documents to index
 * @returns BM25 index structure
 */
export function buildBM25Index(
  documents: Array<{ id: string; text: string }>
): BM25Index {
  const indexedDocs: BM25Document[] = []
  const documentFrequency = new Map<string, number>()
  let totalLength = 0

  for (const doc of documents) {
    const terms = tokenize(doc.text)
    const termFrequency = new Map<string, number>()

    // Count term frequencies
    for (const term of terms) {
      termFrequency.set(term, (termFrequency.get(term) ?? 0) + 1)
    }

    // Update document frequency (count docs containing each term)
    const uniqueTerms = new Set(terms)
    for (const term of uniqueTerms) {
      documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1)
    }

    totalLength += terms.length

    indexedDocs.push({
      id: doc.id,
      terms,
      termFrequency,
      length: terms.length,
    })
  }

  const avgDocLength = documents.length > 0 ? totalLength / documents.length : 0

  return {
    documents: indexedDocs,
    documentFrequency,
    avgDocLength,
    totalDocuments: documents.length,
    version: BM25_INDEX_VERSION,
    lastUpdated: Date.now(),
  }
}

/**
 * Calculate IDF (Inverse Document Frequency) for a term.
 *
 * Uses the standard BM25 IDF formula:
 * IDF(t) = log((N - df(t) + 0.5) / (df(t) + 0.5) + 1)
 *
 * where N = total documents, df(t) = documents containing term t
 */
function calculateIDF(term: string, index: BM25Index): number {
  const df = index.documentFrequency.get(term) ?? 0
  const N = index.totalDocuments

  // Robertson/Sparck-Jones IDF with smoothing
  return Math.log((N - df + 0.5) / (df + 0.5) + 1)
}

/**
 * Calculate BM25 score for a document given a query.
 *
 * BM25 score formula:
 * score = sum(IDF(t) * (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * (docLen / avgDocLen))))
 *
 * for each query term t
 */
function calculateBM25Score(
  queryTerms: string[],
  doc: BM25Document,
  index: BM25Index,
  params: BM25Params = DEFAULT_BM25_PARAMS
): number {
  const { k1, b } = params
  let score = 0

  for (const term of queryTerms) {
    const tf = doc.termFrequency.get(term) ?? 0
    if (tf === 0) continue

    const idf = calculateIDF(term, index)
    const lengthNorm = 1 - b + b * (doc.length / index.avgDocLength)
    const tfNorm = (tf * (k1 + 1)) / (tf + k1 * lengthNorm)

    score += idf * tfNorm
  }

  return score
}

/**
 * Search BM25 index with a query.
 *
 * @param query - Search query text
 * @param index - BM25 index
 * @param topK - Number of top results to return
 * @param params - BM25 parameters (optional)
 * @returns Top-k results with normalized scores
 */
export function bm25Search(
  query: string,
  index: BM25Index,
  topK: number,
  params: BM25Params = DEFAULT_BM25_PARAMS
): BM25SearchResult[] {
  const queryTerms = tokenize(query)

  if (queryTerms.length === 0 || index.documents.length === 0) {
    return []
  }

  // Calculate raw BM25 scores
  const results: Array<{ id: string; rawScore: number }> = []

  for (const doc of index.documents) {
    const rawScore = calculateBM25Score(queryTerms, doc, index, params)
    if (rawScore > 0) {
      results.push({ id: doc.id, rawScore })
    }
  }

  // Sort by raw score descending
  results.sort((a, b) => b.rawScore - a.rawScore)

  // Take top-k and normalize scores
  const topResults = results.slice(0, topK)

  // Normalize scores to [0, 1] using rank-based normalization (moltbot approach)
  return topResults.map((result, rank) => ({
    id: result.id,
    rawScore: result.rawScore,
    score: bm25RankToScore(rank),
  }))
}

/**
 * Convert BM25 rank to normalized score.
 * Following moltbot's formula: score = 1 / (1 + rank)
 *
 * Rank 0 -> score 1.0
 * Rank 1 -> score 0.5
 * Rank 2 -> score 0.33
 * etc.
 *
 * @param rank - 0-indexed rank position
 * @returns Normalized score in (0, 1]
 */
export function bm25RankToScore(rank: number): number {
  return 1 / (1 + Math.max(0, rank))
}

/**
 * Calculate pairwise BM25-style similarity between two texts.
 * Useful for clustering where we compare two texts directly.
 *
 * This builds a minimal index with just the second text as a "document"
 * and scores the first text as a query against it.
 */
export function bm25PairwiseSimilarity(text1: string, text2: string): number {
  const queryTerms = tokenize(text1)
  const docTerms = tokenize(text2)

  if (queryTerms.length === 0 || docTerms.length === 0) {
    return 0
  }

  // Build term frequency for doc
  const termFrequency = new Map<string, number>()
  for (const term of docTerms) {
    termFrequency.set(term, (termFrequency.get(term) ?? 0) + 1)
  }

  // Count matching terms
  let matchScore = 0
  const querySet = new Set(queryTerms)
  const docSet = new Set(docTerms)

  for (const term of querySet) {
    if (docSet.has(term)) {
      // Simple term match weighting
      const tf = termFrequency.get(term) ?? 0
      matchScore += Math.log(1 + tf)
    }
  }

  // Normalize by query length
  const normalizedScore = matchScore / Math.log(1 + queryTerms.length)

  // Clamp to [0, 1]
  return Math.min(1, Math.max(0, normalizedScore))
}

// ============================================================================
// Serialization
// ============================================================================

/**
 * Serialize BM25 index to JSON-compatible format.
 */
export function serializeBM25Index(index: BM25Index): SerializableBM25Index {
  return {
    documents: index.documents.map((doc) => ({
      id: doc.id,
      terms: doc.terms,
      termFrequency: Object.fromEntries(doc.termFrequency),
      length: doc.length,
    })),
    documentFrequency: Object.fromEntries(index.documentFrequency),
    avgDocLength: index.avgDocLength,
    totalDocuments: index.totalDocuments,
    version: index.version,
    lastUpdated: index.lastUpdated,
  }
}

/**
 * Deserialize BM25 index from JSON format.
 */
export function deserializeBM25Index(data: SerializableBM25Index): BM25Index {
  return {
    documents: data.documents.map((doc) => ({
      id: doc.id,
      terms: doc.terms,
      termFrequency: new Map(Object.entries(doc.termFrequency)),
      length: doc.length,
    })),
    documentFrequency: new Map(Object.entries(data.documentFrequency)),
    avgDocLength: data.avgDocLength,
    totalDocuments: data.totalDocuments,
    version: data.version,
    lastUpdated: data.lastUpdated,
  }
}
