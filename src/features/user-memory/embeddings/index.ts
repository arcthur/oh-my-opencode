/**
 * Embeddings Module
 *
 * Three-way hybrid search: Vector + BM25 + Jaccard
 *
 * @example
 * ```typescript
 * import { createEmbeddingProvider, searchHybrid, buildBM25Index } from './embeddings'
 *
 * // Create provider
 * const provider = await createEmbeddingProvider({ provider: 'local', ... })
 *
 * // Build BM25 index
 * const bm25Index = buildBM25Index(documents)
 *
 * // Search
 * const results = await searchHybrid(query, candidates, weights, provider, cache, bm25Index, 10)
 * ```
 */

// Types
export type {
  EmbeddingConfig,
  EmbeddingProvider,
  EmbeddingCache,
  EmbeddingVector,
  EmbeddingProviderType,
  HybridWeights,
  HybridSearchResult,
  HybridSimilarityResult,
  VectorSearchResult,
  BM25Index,
  BM25SearchResult,
  BM25Params,
  EmbeddingCacheFile,
  SerializableBM25Index,
} from "./types"

// Constants
export {
  DEFAULT_EMBEDDING_CONFIG,
  DEFAULT_HYBRID_WEIGHTS,
  DEFAULT_BM25_PARAMS,
  EMBEDDING_CACHE_VERSION,
  BM25_INDEX_VERSION,
} from "./types"

// Provider
export {
  createEmbeddingProvider,
  isProviderAvailable,
  getProviderWithFallback,
} from "./provider"

// Vector Search
export {
  cosineSimilarity,
  rawCosineSimilarity,
  searchByVector,
  vectorSimilarity,
  batchVectorSimilarity,
} from "./search"

// BM25
export {
  buildBM25Index,
  bm25Search,
  bm25RankToScore,
  bm25PairwiseSimilarity,
  serializeBM25Index,
  deserializeBM25Index,
} from "./bm25"

// Cache
export {
  loadEmbeddingCache,
  loadEmbeddingsOnly,
  loadBM25Index,
  saveEmbeddingCache,
  saveEmbeddingsOnly,
  saveBM25IndexOnly,
  createEmptyEmbeddingCache,
  isCacheValid,
  getCachedEmbedding,
  setCachedEmbedding,
  removeCachedEmbedding,
  getCachedEntryIds,
  getCacheStats,
  computeContentHash,
} from "./cache"

// Hybrid Search
export {
  searchHybrid,
  mergeHybridResults,
  calculateHybridSimilarity,
  calculateHybridSimilarityWithoutVector,
  batchEmbed,
  type HybridCandidate,
} from "./hybrid"

// Providers
export { createLocalProvider, getModelDimension } from "./providers/local"
export { createOpenAIProvider, getOpenAIModelDimension } from "./providers/openai"
