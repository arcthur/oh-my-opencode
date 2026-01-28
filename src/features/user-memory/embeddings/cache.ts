/**
 * Embedding Cache Module
 *
 * JSON-based cache for embeddings and BM25 index.
 * Uses atomic writes for crash safety.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from "node:fs"
import { dirname, join } from "node:path"
import { homedir } from "node:os"
import type {
  EmbeddingCache,
  EmbeddingCacheFile,
  EmbeddingConfig,
  EmbeddingVector,
  BM25Index,
  SerializableBM25Index,
} from "./types"
import { EMBEDDING_CACHE_VERSION } from "./types"
import { serializeBM25Index, deserializeBM25Index } from "./bm25"

// ============================================================================
// Cache File Paths
// ============================================================================

const MEMORY_DIR = join(homedir(), ".opencode", "memory")
const EMBEDDING_CACHE_FILE = join(MEMORY_DIR, "embeddings.json")

/**
 * Ensure the memory directory exists.
 */
function ensureMemoryDir(): void {
  if (!existsSync(MEMORY_DIR)) {
    mkdirSync(MEMORY_DIR, { recursive: true })
  }
}

// ============================================================================
// Content Hashing
// ============================================================================

/**
 * Compute a simple hash of content for cache invalidation.
 * Uses djb2 algorithm - fast and deterministic.
 *
 * @param content - Text content to hash
 * @returns Hash string
 */
export function computeContentHash(content: string): string {
  let hash = 5381
  for (let i = 0; i < content.length; i++) {
    const char = content.charCodeAt(i)
    hash = ((hash << 5) + hash) ^ char // hash * 33 ^ char
  }
  // Convert to unsigned 32-bit integer, then to base36
  return (hash >>> 0).toString(36)
}

// ============================================================================
// Cache Loading
// ============================================================================

/**
 * Load embedding cache from disk.
 *
 * @returns Cache data or null if not found/invalid
 */
export function loadEmbeddingCache(): EmbeddingCacheFile | null {
  try {
    if (!existsSync(EMBEDDING_CACHE_FILE)) {
      return null
    }

    const raw = readFileSync(EMBEDDING_CACHE_FILE, "utf-8")
    const data = JSON.parse(raw) as EmbeddingCacheFile

    // Validate structure
    if (!data.embeddings || typeof data.embeddings.version !== "number") {
      return null
    }

    return data
  } catch {
    return null
  }
}

/**
 * Load only the embedding cache portion.
 */
export function loadEmbeddingsOnly(): EmbeddingCache | null {
  const cacheFile = loadEmbeddingCache()
  return cacheFile?.embeddings ?? null
}

/**
 * Load only the BM25 index portion.
 */
export function loadBM25Index(): BM25Index | null {
  const cacheFile = loadEmbeddingCache()
  if (!cacheFile?.bm25Index) return null
  return deserializeBM25Index(cacheFile.bm25Index)
}

// ============================================================================
// Cache Saving
// ============================================================================

/**
 * Atomic write to file using temp file + rename pattern.
 */
function atomicWriteFileSync(filePath: string, content: string): void {
  const dir = dirname(filePath)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }

  const tempPath = filePath + ".tmp"
  writeFileSync(tempPath, content, "utf-8")
  renameSync(tempPath, filePath)
}

/**
 * Save embedding cache to disk.
 *
 * @param embeddings - Embedding cache data
 * @param bm25Index - BM25 index (optional)
 */
export function saveEmbeddingCache(
  embeddings: EmbeddingCache,
  bm25Index: BM25Index | null = null
): void {
  ensureMemoryDir()

  const cacheFile: EmbeddingCacheFile = {
    embeddings,
    bm25Index: bm25Index ? serializeBM25Index(bm25Index) : null,
  }

  atomicWriteFileSync(EMBEDDING_CACHE_FILE, JSON.stringify(cacheFile, null, 2))
}

/**
 * Save only embeddings, preserving existing BM25 index.
 */
export function saveEmbeddingsOnly(embeddings: EmbeddingCache): void {
  const existing = loadEmbeddingCache()
  saveEmbeddingCache(embeddings, existing?.bm25Index ? deserializeBM25Index(existing.bm25Index) : null)
}

/**
 * Save only BM25 index, preserving existing embeddings.
 */
export function saveBM25IndexOnly(bm25Index: BM25Index): void {
  const existing = loadEmbeddingCache()
  const embeddings = existing?.embeddings ?? createEmptyEmbeddingCache("unknown", "unknown", 0)
  saveEmbeddingCache(embeddings, bm25Index)
}

// ============================================================================
// Cache Utilities
// ============================================================================

/**
 * Create an empty embedding cache.
 */
export function createEmptyEmbeddingCache(
  provider: string,
  model: string,
  dimension: number
): EmbeddingCache {
  return {
    version: EMBEDDING_CACHE_VERSION,
    provider,
    model,
    dimension,
    entries: {},
    lastUpdated: Date.now(),
  }
}

/**
 * Check if cache is valid for the given config.
 * Cache is invalid if provider or model changed.
 */
export function isCacheValid(cache: EmbeddingCache, config: EmbeddingConfig): boolean {
  if (cache.version !== EMBEDDING_CACHE_VERSION) {
    return false
  }

  if (cache.provider !== config.provider) {
    return false
  }

  // Check model compatibility based on provider
  if (config.provider === "openai" && config.openai_model) {
    // For OpenAI, we don't have model info until provider is created
    // Accept cache if provider matches
    return true
  }

  if (config.provider === "local" && config.local_model) {
    // For local, check model name if specified
    if (cache.model !== config.local_model) {
      return false
    }
  }

  return true
}

/**
 * Get cached embedding for an entry.
 *
 * @param cache - Embedding cache
 * @param id - Entry ID
 * @param content - Current content (for hash validation)
 * @returns Cached vector or null if not found/stale
 */
export function getCachedEmbedding(
  cache: EmbeddingCache,
  id: string,
  content: string
): number[] | null {
  const entry = cache.entries[id]
  if (!entry) return null

  // Validate content hash
  const currentHash = computeContentHash(content)
  if (entry.contentHash !== currentHash) {
    return null
  }

  return entry.vector
}

/**
 * Set cached embedding for an entry.
 */
export function setCachedEmbedding(
  cache: EmbeddingCache,
  id: string,
  content: string,
  vector: number[]
): void {
  cache.entries[id] = {
    id,
    contentHash: computeContentHash(content),
    vector,
    computedAt: Date.now(),
  }
  cache.lastUpdated = Date.now()
}

/**
 * Remove cached embedding for an entry.
 */
export function removeCachedEmbedding(cache: EmbeddingCache, id: string): void {
  delete cache.entries[id]
  cache.lastUpdated = Date.now()
}

/**
 * Get all cached entry IDs.
 */
export function getCachedEntryIds(cache: EmbeddingCache): string[] {
  return Object.keys(cache.entries)
}

/**
 * Get cache statistics.
 */
export function getCacheStats(cache: EmbeddingCache): {
  entryCount: number
  provider: string
  model: string
  dimension: number
  lastUpdated: Date
} {
  return {
    entryCount: Object.keys(cache.entries).length,
    provider: cache.provider,
    model: cache.model,
    dimension: cache.dimension,
    lastUpdated: new Date(cache.lastUpdated),
  }
}
