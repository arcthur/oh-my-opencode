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
  // Domain models
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
  // Session state types (unified)
  TrackedMessage,
  TrackedToolCall,
  SessionSnapshot,
  SessionRuntimeState,
  // Session reference types
  ParsedSessionReference,
  SessionReferenceType,
  SessionReferenceQuery,
  // Extraction types
  ExtractionContext,
  ExtractionMessage,
  ExtractionToolCall,
  // Active handoff types
  ActiveHandoffRequest,
  ActiveHandoffResult,
  // Config types (re-exported from schema)
  SessionHandoffConfig,
  ExtractorConfig,
} from "./types"

// Constant and utility exports
export { DEFAULT_HANDOFF_CONFIG, toSessionSnapshot } from "./types"

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

// Staleness detection exports
export {
  checkHandoffStaleness,
  formatStalenessWarning,
  getGitFileModTime,
  isSafeProjectRelativePath,
  type StalenessInfo,
} from "./staleness"

// Reference resolver exports
export {
  resolveSessionReference,
  type ResolveSessionReferenceOptions,
} from "./reference-resolver"

// Injector exports
export {
  selectHandoffsForInjection,
  generateInjectionContent,
} from "./injector"

// Hook exports
export {
  createSessionHandoffHook,
  clearAllSessionStates,
  type SessionHandoffHookContext,
} from "./hook"

// Goal extractor exports
export {
  filterPayloadByGoal,
  type GoalFilterOptions,
  type FilteredPayload,
} from "./goal-extractor"

// Prompt builder exports
export {
  buildHandoffPrompt,
  buildHandoffSummary,
  type PromptBuilderOptions,
} from "./prompt-builder"

// Launcher exports
export {
  executeActiveHandoff,
  buildQuickHandoff,
  type LauncherDependencies,
  type LauncherSessionInput,
} from "./launcher"

// Summarizer exports
export {
  createHandoffSummarizer,
  CircuitOpenError,
  type HandoffSummarizer,
  type CircuitState,
  type CreateHandoffSummarizerOptions,
} from "./summarizer"

// Command parser exports
export {
  parseHandoffCommand,
  isHandoffCommand,
  isManagementCommand,
  isGoalCommand,
  type ParsedHandoffCommand,
  type ManagementSubcommand,
} from "./command-parser"
