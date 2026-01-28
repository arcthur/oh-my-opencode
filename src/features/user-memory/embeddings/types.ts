/**
 * Embedding Types
 *
 * Type definitions for the vector search system.
 * Supports three-way hybrid search: Vector + BM25 + Jaccard.
 */

// ============================================================================
// Configuration Types
// ============================================================================

/**
 * Embedding provider type
 */
export type EmbeddingProviderType = "local" | "openai"

/**
 * Configuration for the embedding system
 */
export interface EmbeddingConfig {
  /** Enable vector search (default: false - opt-in) */
  enabled: boolean
  /** Embedding provider (default: "local") */
  provider: EmbeddingProviderType
  /** OpenAI model when using openai provider */
  openai_model?: string
  /** Local model path/name */
  local_model?: string
  /** Enable embedding cache (default: true) */
  cache_enabled: boolean
  /** Batch size for embedding calls (default: 20) */
  batch_size: number
  /** Three-way hybrid search weights (defaults to DEFAULT_HYBRID_WEIGHTS) */
  hybrid_weights?: Partial<HybridWeights>
}

/**
 * Three-way hybrid search weights.
 * Must sum to 1.0.
 */
export interface HybridWeights {
  /** Weight for vector (semantic) similarity */
  vector: number
  /** Weight for BM25 (keyword) similarity */
  bm25: number
  /** Weight for Jaccard (n-gram/synonym) similarity */
  jaccard: number
}

export const DEFAULT_HYBRID_WEIGHTS: HybridWeights = {
  vector: 0.5,
  bm25: 0.3,
  jaccard: 0.2,
}

export const DEFAULT_EMBEDDING_CONFIG: EmbeddingConfig = {
  enabled: false,
  provider: "local",
  cache_enabled: true,
  batch_size: 20,
  hybrid_weights: DEFAULT_HYBRID_WEIGHTS,
}

// ============================================================================
// Embedding Provider Types
// ============================================================================

/**
 * Embedding provider interface.
 * Abstracts different embedding backends (local, OpenAI, etc.)
 */
export interface EmbeddingProvider {
  /** Provider name for identification */
  readonly name: string
  /** Embedding dimension */
  readonly dimension: number
  /** Generate embeddings for texts */
  embed(texts: string[]): Promise<number[][]>
  /** Check if provider is available */
  isAvailable(): Promise<boolean>
}

// ============================================================================
// Cache Types
// ============================================================================

/**
 * Single embedding vector with metadata
 */
export interface EmbeddingVector {
  /** Unique ID matching the source entry */
  id: string
  /** Content hash for cache invalidation */
  contentHash: string
  /** The embedding vector */
  vector: number[]
  /** Timestamp when computed */
  computedAt: number
}

/**
 * Embedding cache structure
 */
export interface EmbeddingCache {
  /** Cache version for migrations */
  version: number
  /** Provider used to generate embeddings */
  provider: string
  /** Model used */
  model: string
  /** Embedding dimension */
  dimension: number
  /** Cached embeddings by entry ID */
  entries: Record<string, EmbeddingVector>
  /** Last updated timestamp */
  lastUpdated: number
}

export const EMBEDDING_CACHE_VERSION = 1

// ============================================================================
// BM25 Index Types
// ============================================================================

/**
 * Document in BM25 index
 */
export interface BM25Document {
  /** Document ID */
  id: string
  /** Tokenized terms */
  terms: string[]
  /** Term frequency map */
  termFrequency: Map<string, number>
  /** Document length (number of terms) */
  length: number
}

/**
 * BM25 index structure
 */
export interface BM25Index {
  /** Indexed documents */
  documents: BM25Document[]
  /** Document frequency for each term */
  documentFrequency: Map<string, number>
  /** Average document length */
  avgDocLength: number
  /** Total number of documents */
  totalDocuments: number
  /** Index version */
  version: number
  /** Last updated timestamp */
  lastUpdated: number
}

export const BM25_INDEX_VERSION = 1

/**
 * BM25 parameters (tunable)
 */
export interface BM25Params {
  /** Term frequency saturation (default: 1.2) */
  k1: number
  /** Length normalization (default: 0.75) */
  b: number
}

export const DEFAULT_BM25_PARAMS: BM25Params = {
  k1: 1.2,
  b: 0.75,
}

// ============================================================================
// Search Result Types
// ============================================================================

/**
 * Vector search result
 */
export interface VectorSearchResult {
  id: string
  score: number // Cosine similarity [0, 1]
}

/**
 * BM25 search result
 */
export interface BM25SearchResult {
  id: string
  score: number // Normalized BM25 score [0, 1]
  rawScore: number // Raw BM25 score
}

/**
 * Hybrid search result combining all three signals
 */
export interface HybridSearchResult {
  id: string
  vectorScore: number
  bm25Score: number
  jaccardScore: number
  combinedScore: number
}

/**
 * Hybrid similarity result for pairwise comparison
 */
export interface HybridSimilarityResult {
  /** Combined similarity score */
  score: number
  /** Confidence level for merge decisions */
  confidence: "high" | "medium" | "low"
  /** Component scores */
  components: {
    vectorScore: number
    bm25Score: number
    jaccardScore: number
  }
}

// ============================================================================
// Serializable Types (for JSON persistence)
// ============================================================================

/**
 * Serializable BM25 index (for JSON storage)
 */
export interface SerializableBM25Index {
  documents: Array<{
    id: string
    terms: string[]
    termFrequency: Record<string, number>
    length: number
  }>
  documentFrequency: Record<string, number>
  avgDocLength: number
  totalDocuments: number
  version: number
  lastUpdated: number
}

/**
 * Combined cache file structure
 */
export interface EmbeddingCacheFile {
  embeddings: EmbeddingCache
  bm25Index: SerializableBM25Index | null
}
