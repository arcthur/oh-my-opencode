/**
 * User Memory Module
 *
 * Provides persistent memory across sessions, inspired by Factory.ai Droid's
 * hierarchical memory system and RAPTOR recursive summarization.
 *
 * Memory Hierarchy (RAPTOR-style):
 * - L0: Raw WorkHistoryEntry[] (~7 days, 50 entries)
 * - L1: WeeklySummary[] (~3 months, 12 weeks)
 * - L2: MonthlySummary[] (~1 year, 12 months)
 * - L3: LongTermKnowledge[] (permanent, distilled insights)
 *
 * Core Features:
 * - User preferences and environment info
 * - Work history with automatic aggregation
 * - Custom rules and explicit memories
 * - Hierarchical summarization across time scales
 * - Circuit breaker for LLM resilience
 */

// Type exports
export type {
  UserMemory,
  UserMemoryConfig,
  EnvironmentInfo,
  WorkHistoryEntry,
  // RAPTOR hierarchical memory types
  WeeklySummary,
  MonthlySummary,
  LongTermKnowledge,
  HierarchicalMemoryConfig,
} from "./types"

// Constant exports
export {
  DEFAULT_USER_MEMORY,
  DEFAULT_CONFIG,
  CURRENT_SCHEMA_VERSION,
  DEFAULT_HIERARCHICAL_CONFIG,
} from "./types"

// Storage API exports
export {
  loadUserMemory,
  saveUserMemory,
  setPreference,
  getPreference,
  addWorkHistoryEntry,
  addExplicitMemory,
  addCustomRule,
  removeCustomRule,
  updateEnvironment,
  clearUserMemory,
  getMemorySummary,
} from "./storage"

// Hook exports
export {
  createUserMemoryHook,
  createDefaultUserMemorySummarizer,
  type UserMemoryHookConfig,
  type UserMemorySummarizer,
  type UserMemoryPromptKind,
} from "./hook"

// Summarizer exports (for advanced use cases)
export {
  createUserMemorySummarizer,
  createAggregationSummarizer,
  CircuitOpenError,
  type CircuitState,
  type SummarizerOptions,
} from "./summarizer"

// Schema exports (for validation and parsing)
export {
  PROMPT_TAGS,
  detectPromptKind,
  parseWeeklySummarization,
  parseMonthlySummarization,
  parseKnowledgeExtraction,
  parseMergeDecision,
  parseMonthToTimestamp,
  extractAssistantText,
  type PromptKind,
  type WeeklySummarizationResponse,
  type MonthlySummarizationResponse,
  type KnowledgeExtractionResponse,
  type MergeDecisionResponse,
} from "./schemas"

// Aggregation API exports (for advanced use cases)
export {
  // Time boundary utilities
  getWeekStart,
  getWeekEnd,
  getMonthStart,
  formatMonth,
  crossedWeekBoundary,
  crossedMonthBoundary,
  crossedKnowledgeExtractionBoundary,
  // Aggregation functions
  aggregateToWeekly,
  aggregateToMonthly,
  extractLongTermKnowledge,
  performAggregations,
  initializeAggregationTimestamps,
  mergeKnowledge,
  // Metadata extraction
  extractProjects,
  extractTechStack,
  // Types
  type SummarizeFunction,
} from "./aggregation"

// Prompt utilities (for custom summarization)
export {
  buildWeeklySummaryPrompt,
  buildMonthlySummaryPrompt,
  buildKnowledgeExtractionPrompt,
  parseSummarizationResponse,
  parseKnowledgeExtractionResponse,
  fallbackWeeklySummary,
  fallbackMonthlySummary,
  SUMMARIZATION_SYSTEM_PROMPT,
} from "./prompts"
