/**
 * Session Handoff Module
 *
 * Structured knowledge extraction and transfer between sessions.
 *
 * Features:
 * - Automatic handoff extraction on session end
 * - Knowledge injection on session start
 * - @session:id reference syntax for explicit retrieval
 * - Embedding-based semantic search (optional)
 */

// Type exports
export type {
  HandoffPackage,
  HandoffMetadata,
  HandoffPayload,
  Decision,
  RejectedAlternative,
  DecisionCategory,
  Artifact,
  LineRange,
  AntiPattern,
  EmbeddingIndexEntry,
  HandoffIndex,
  HandoffIndexEntry,
  SessionHandoffConfig,
  ExtractorConfig,
  ParsedSessionReference,
  SessionReferenceType,
  SessionReferenceQuery,
  ExtractionContext,
  ExtractionMessage,
  ExtractionToolCall,
} from "./types"

// Constant exports
export { DEFAULT_HANDOFF_CONFIG } from "./types"

// Storage exports
export {
  loadIndex,
  saveIndex,
  generateHandoffId,
  saveHandoff,
  loadHandoff,
  deleteHandoff,
  findHandoffsForProject,
  findRecentHandoffs,
  findHandoffBySessionId,
  getRecentSessionHandoffs,
  cleanupExpired,
  shouldRunCleanup,
  saveEmbeddings,
  loadEmbeddings,
  HANDOFFS_DIR,
  INDEX_FILE,
  EMBEDDINGS_DIR,
} from "./storage"

// Extractor exports
export {
  buildExtractionContext,
  extractPayload,
  createHandoffPackage,
  type ExtractorDependencies,
} from "./extractor"

// Embeddings exports
export {
  buildEmbeddingIndexEntries,
  generateEmbeddingVectors,
  cosineSimilarity,
} from "./embeddings"

// Injector exports
export {
  selectHandoffsForInjection,
  generateInjectionContent,
  resolveSessionReference,
} from "./injector"

// Hook exports
export {
  createSessionHandoffHook,
  clearAllSessionStates,
  type SessionHandoffHookContext,
} from "./hook"

// Summarizer exports
export {
  createHandoffSummarizer,
  CircuitOpenError,
  type HandoffSummarizer,
  type CircuitState,
  type CreateHandoffSummarizerOptions,
} from "./summarizer"
