/**
 * User Memory Types
 *
 * Hierarchical memory system for persistent context across sessions.
 * Inspired by Factory.ai Droid's memory architecture and RAPTOR recursive summarization.
 *
 * Memory Hierarchy (RAPTOR-style):
 * - L0: Raw WorkHistoryEntry[] (~7 days, 50 entries)
 * - L1: WeeklySummary[] (~3 months, 12 weeks)
 * - L2: MonthlySummary[] (~1 year, 12 months)
 * - L3: LongTermKnowledge[] (permanent, distilled insights)
 *
 * Enhanced with:
 * - Temporal Validity: valid_from/valid_until for facts
 * - Staleness Categories: exponential decay based on fact type
 * - Entity Memory: person/project/technology tracking (opt-in)
 * - Semantic Clustering: LLM-assisted knowledge merging
 */

// ============================================================================
// Temporal Validity Types
// ============================================================================

/**
 * Staleness category determines the decay rate for facts.
 * Different types of knowledge become stale at different rates.
 */
export type StalenessCategory =
  | "ephemeral" // 3 days: current task, active debugging
  | "short-term" // 2 weeks: project state, current focus
  | "medium-term" // 3 months: preferences, patterns
  | "long-term" // 1 year: skills, fundamental preferences
  | "permanent" // Never: explicit rules, core identity

/**
 * Validity range for aggregated facts (L1/L2 summaries).
 * Represents the union of all contained facts' validity periods.
 */
export interface FactsValidRange {
  /** Earliest valid_from among contained facts */
  earliest_valid_from: number
  /** Latest valid_until among contained facts (null = contains ongoing facts) */
  latest_valid_until?: number | null
}

/**
 * Half-life values in milliseconds for each staleness category.
 * At t=halfLife, staleness ≈ 0.5; at t=2*halfLife, staleness ≈ 0.75
 */
export const STALENESS_HALF_LIFE_MS: Record<StalenessCategory, number> = {
  ephemeral: 3 * 24 * 60 * 60 * 1000, // 3 days
  "short-term": 14 * 24 * 60 * 60 * 1000, // 2 weeks
  "medium-term": 90 * 24 * 60 * 60 * 1000, // 3 months
  "long-term": 365 * 24 * 60 * 60 * 1000, // 1 year
  permanent: Infinity, // Never decays
}

export interface EnvironmentInfo {
  /** Operating system */
  os?: string
  /** Shell type (bash, zsh, fish, etc.) */
  shell?: string
  /** Default editor */
  editor?: string
  /** Node.js version if applicable */
  nodeVersion?: string
  /** Python version if applicable */
  pythonVersion?: string
  /** Custom environment notes */
  notes?: string
}

export interface WorkHistoryEntry {
  /** Timestamp of the work session */
  timestamp: number
  /** Brief description of work done */
  summary: string
  /** Project/repository name */
  project?: string
  /** Files that were modified */
  filesModified?: string[]
  /** Outcome (success, partial, failed) */
  outcome?: "success" | "partial" | "failed"

  // Temporal validity fields (v3)
  /**
   * When this fact became valid. Usually same as timestamp.
   * Different when user says "I've been using X for 2 years" - valid_from would be 2 years ago.
   */
  valid_from?: number
  /**
   * First timestamp when this fact is no longer valid (exclusive upper bound).
   * null/undefined = ongoing (still valid today).
   */
  valid_until?: number | null
  /**
   * Staleness category for decay calculation.
   * Default: 'short-term' (work history decays over weeks)
   */
  staleness_category?: StalenessCategory
}

// ============================================================================
// RAPTOR Hierarchical Memory Types (L1-L3)
// ============================================================================

/**
 * Level 1: Weekly Summary
 * Aggregated from L0 WorkHistoryEntry[] when crossing week boundaries
 */
export interface WeeklySummary {
  /** ISO week start timestamp (Monday 00:00:00) */
  weekStart: number
  /** ISO week end timestamp (Sunday 23:59:59) */
  weekEnd: number
  /** LLM-generated summary of the week's work */
  summary: string
  /** Projects worked on during this week */
  projects: string[]
  /** Key achievements and completions */
  keyAchievements: string[]
  /** Lessons learned and insights gained */
  lessonsLearned: string[]
  /** Technology stack used */
  techStack: string[]
  /** Number of raw entries aggregated */
  entryCount: number

  // Temporal validity fields (v3)
  /**
   * Validity range of facts contained in this summary.
   * Union of all entry validity ranges for time-range queries.
   */
  facts_valid_range?: FactsValidRange
}

/**
 * Level 2: Monthly Summary
 * Aggregated from L1 WeeklySummary[] when crossing month boundaries
 */
export interface MonthlySummary {
  /** Month identifier in "YYYY-MM" format */
  month: string
  /** LLM-generated summary of the month's work */
  summary: string
  /** Projects worked on during this month */
  projects: string[]
  /** Key achievements across the month */
  keyAchievements: string[]
  /** Consolidated lessons learned */
  lessonsLearned: string[]
  /** Description of technology stack evolution */
  techStackEvolution: string
  /** Number of weeks aggregated */
  weekCount: number

  // Temporal validity fields (v3)
  /**
   * Validity range of facts contained in this summary.
   * Union of all weekly summary validity ranges.
   */
  facts_valid_range?: FactsValidRange
}

/**
 * Level 3: Long-term Knowledge
 * Distilled insights from L2 MonthlySummary[] that persist indefinitely
 */
export interface LongTermKnowledge {
  /** Category of knowledge */
  category: "lesson" | "pattern" | "preference" | "skill"
  /** The distilled knowledge content */
  content: string
  /** Confidence score (0-1) based on frequency of reinforcement */
  confidence: number
  /** Timestamp when first observed */
  firstSeen: number
  /** Timestamp of most recent reinforcement */
  lastReinforced: number
  /** Source months that contributed to this knowledge */
  sourceMonths: string[]

  // Temporal validity fields (v3)
  /**
   * Unique identifier for cross-referencing and supersession tracking.
   * Format: "k_{hash}_{timestamp_base36}"
   */
  id?: string
  /**
   * When this knowledge became valid.
   * Default: firstSeen (when first observed)
   */
  valid_from?: number
  /**
   * First timestamp when this knowledge is no longer valid (exclusive upper bound).
   * null/undefined = ongoing/still valid
   */
  valid_until?: number | null
  /**
   * Staleness category determines decay rate.
   * Inferred from content or explicitly set.
   */
  staleness_category?: StalenessCategory
  /**
   * ID of knowledge entry that superseded this one.
   * Used to track knowledge evolution.
   */
  superseded_by?: string
}

/**
 * Configuration for hierarchical memory aggregation
 */
export interface HierarchicalMemoryConfig {
  /** Enable hierarchical memory (default: true) */
  enabled: boolean
  /** Maximum weekly summaries to keep (default: 12) */
  weekly_summaries_limit: number
  /** Maximum monthly summaries to keep (default: 12) */
  monthly_summaries_limit: number
  /** Maximum long-term knowledge entries (default: 50) */
  long_term_knowledge_limit: number
  /** Model to use for aggregation (default: "haiku") */
  aggregation_model: "haiku" | "sonnet" | "opus"
  /** Automatically aggregate on session end (default: true) */
  auto_aggregate: boolean
}

export const DEFAULT_HIERARCHICAL_CONFIG: HierarchicalMemoryConfig = {
  enabled: true,
  weekly_summaries_limit: 12,
  monthly_summaries_limit: 12,
  long_term_knowledge_limit: 50,
  aggregation_model: "haiku",
  auto_aggregate: true,
}

/**
 * Consolidation trigger configuration.
 * Determines when to force aggregation based on data size, not just time boundaries.
 */
export interface ConsolidationConfig {
  /** Enable size-based consolidation triggers (default: true) */
  enabled: boolean
  /** Trigger L0->L1 when work history exceeds this (default: 30) */
  work_history_threshold: number
  /** Trigger L1->L2 when weekly summaries exceed this (default: 8) */
  weekly_summaries_threshold: number
  /** Trigger L2->L3 when monthly summaries exceed this (default: 6) */
  monthly_summaries_threshold: number
  // Note: Entity pruning uses EntityMemoryConfig.max_entities/max_relationships in hook.ts
}

export const DEFAULT_CONSOLIDATION_CONFIG: ConsolidationConfig = {
  enabled: true,
  work_history_threshold: 30,
  weekly_summaries_threshold: 8,
  monthly_summaries_threshold: 6,
}

export interface UserMemory {
  /** User preferences and settings */
  preferences: Record<string, string>
  /** Development environment information */
  environment: EnvironmentInfo
  /** Recent work history (last N entries) - L0 */
  workHistory: WorkHistoryEntry[]
  /** Custom rules/instructions to always apply */
  customRules: string[]
  /** Frequently used commands or patterns */
  frequentPatterns: string[]
  /** Things the user explicitly asked to remember */
  explicitMemories: Array<{
    content: string
    timestamp: number
    context?: string
  }>
  /** Last updated timestamp */
  lastUpdated: number
  /** Schema version for migration */
  schemaVersion: number

  // ============================================================================
  // RAPTOR Hierarchical Memory Fields (L1-L3)
  // ============================================================================

  /** L1: Weekly summaries (last 12 weeks) */
  weeklySummaries?: WeeklySummary[]
  /** L2: Monthly summaries (last 12 months) */
  monthlySummaries?: MonthlySummary[]
  /** L3: Long-term distilled knowledge */
  longTermKnowledge?: LongTermKnowledge[]

  /** Timestamp of last weekly aggregation */
  lastWeeklyAggregation?: number
  /** Timestamp of last monthly aggregation */
  lastMonthlyAggregation?: number
  /** Timestamp of last yearly/knowledge extraction */
  lastKnowledgeExtraction?: number

  // Entity Memory fields (v3)
  /** Entity graph for relationship tracking */
  entityGraph?: EntityGraph
  /** Last entity extraction timestamp */
  lastEntityExtraction?: number
}

export interface UserMemoryConfig {
  /** Enable user memory persistence (default: true) */
  enabled: boolean
  /** Persist user preferences (default: true) */
  persist_preferences: boolean
  /** Persist work history (default: true) */
  persist_work_history: boolean
  /** Max work history entries to keep (default: 50) */
  max_history_entries: number
  /** Auto-inject memory context on session start (default: true) */
  auto_inject: boolean
}

export const DEFAULT_USER_MEMORY: UserMemory = {
  preferences: {},
  environment: {},
  workHistory: [],
  customRules: [],
  frequentPatterns: [],
  explicitMemories: [],
  lastUpdated: Date.now(),
  schemaVersion: 3,
  // RAPTOR hierarchical memory defaults
  weeklySummaries: [],
  monthlySummaries: [],
  longTermKnowledge: [],
  lastWeeklyAggregation: undefined,
  lastMonthlyAggregation: undefined,
  lastKnowledgeExtraction: undefined,
  // Entity Memory defaults (v3)
  entityGraph: undefined, // Not initialized until enabled
  lastEntityExtraction: undefined,
}

export const DEFAULT_CONFIG: UserMemoryConfig = {
  enabled: true,
  persist_preferences: true,
  persist_work_history: true,
  max_history_entries: 50,
  auto_inject: true,
}

/** Current schema version - increment when making breaking changes */
export const CURRENT_SCHEMA_VERSION = 3

// ============================================================================
// Temporal Validity Configuration
// ============================================================================

/**
 * Configuration for temporal validity system
 */
export interface TemporalValidityConfig {
  /** Enable temporal validity filtering (default: true) */
  enabled: boolean
  /** Maximum staleness score to include in injection (0-1, default: 0.7) */
  staleness_threshold: number
  /** Decay factor for effective confidence calculation (default: 0.5) */
  decay_factor: number
  /** Include explicitly expired facts in queries (default: false) */
  include_expired: boolean
}

export const DEFAULT_TEMPORAL_VALIDITY_CONFIG: TemporalValidityConfig = {
  enabled: true,
  staleness_threshold: 0.7,
  decay_factor: 0.5,
  include_expired: false,
}

/**
 * Pattern Statistics for tracking frequent tool usage
 */
export interface PatternEntry {
  /** Tool name (e.g., "Read", "Bash", "Grep") */
  tool: string
  /** Normalized arguments pattern (e.g., "src/hooks/*") */
  argsPattern: string
  /** Total occurrence count */
  count: number
  /** Last usage timestamp */
  lastUsed: number
  /** Unique session IDs where this pattern appeared */
  sessionIds: string[]
}

export interface PatternStats {
  /** Pattern entries keyed by signature (tool::argsPattern) */
  patterns: Record<string, PatternEntry>
  /** Last aggregation timestamp */
  lastAggregated: number
}

export interface FrequentPatternConfig {
  /** Enable pattern tracking (default: true) */
  enabled: boolean
  /** Minimum occurrences to be considered frequent (default: 5) */
  min_occurrences: number
  /** Minimum unique sessions required (default: 2) */
  min_sessions: number
  /** Maximum patterns to keep (default: 20) */
  max_patterns: number
  /** Days after which patterns decay in relevance (default: 30) */
  decay_days: number
}

export const DEFAULT_PATTERN_CONFIG: FrequentPatternConfig = {
  enabled: true,
  min_occurrences: 5,
  min_sessions: 2,
  max_patterns: 20,
  decay_days: 30,
}

export const DEFAULT_PATTERN_STATS: PatternStats = {
  patterns: {},
  lastAggregated: 0,
}

// ============================================================================
// Entity Memory Types (Phase 2)
// ============================================================================

/**
 * Entity type classification.
 * Deliberately coarse-grained to reduce misclassification.
 */
export type EntityType =
  | "person" // Human entities: colleagues, reviewers
  | "project" // Codebases, repos, products
  | "technology" // Languages, frameworks, tools
  | "organization" // Companies, teams, departments
  | "concept" // Abstract: patterns, methodologies

/**
 * Relationship predicate types.
 * Intentionally limited set for reliability.
 */
export type RelationshipPredicate =
  | "works_on" // person -> project
  | "collaborates_with" // person -> person
  | "uses" // project -> technology
  | "part_of" // project -> organization
  | "reviewed_by" // code/PR -> person
  | "depends_on" // project -> project/technology
  | "mentioned_with" // generic co-occurrence

/**
 * A mention of an entity in context
 */
export interface EntityMention {
  /** Source text snippet (max 100 chars for context) */
  context: string
  /** Timestamp of the mention */
  timestamp: number
  /** Source type: workHistory summary or weekly summary */
  source: "L0" | "L1"
  /** Optional: source identifier (weekStart for L1) */
  sourceId?: string
}

/**
 * An entity node in the graph
 */
export interface EntityNode {
  /** Unique entity identifier (normalized canonical name) */
  id: string
  /** Display name (most common form) */
  name: string
  /** Entity type classification */
  type: EntityType
  /** Known aliases that resolve to this entity */
  aliases: string[]
  /** Confidence that aliases are correct (0-1) */
  aliasConfidence: Record<string, number>
  /** Recent mentions (limited to last 10 for context) */
  mentions: EntityMention[]
  /** Total mention count across all time */
  mentionCount: number
  /** First time this entity was seen */
  firstSeen: number
  /** Last time this entity was mentioned */
  lastSeen: number
  /** Free-form metadata extracted from context */
  metadata: Record<string, string>
}

/**
 * A relationship between two entities
 */
export interface EntityRelationship {
  /** Unique relationship identifier */
  id: string
  /** Subject entity ID */
  subject: string
  /** Relationship type */
  predicate: RelationshipPredicate
  /** Object entity ID */
  object: string
  /** Confidence score (0-1) based on co-occurrence frequency */
  confidence: number
  /** Number of times this relationship was observed */
  observationCount: number
  /** First observation timestamp */
  firstObserved: number
  /** Last observation timestamp */
  lastObserved: number
  /** Optional context snippets (last 3) */
  contextSamples: string[]
}

/**
 * The complete entity graph
 */
export interface EntityGraph {
  /** All entity nodes, keyed by ID */
  nodes: Record<string, EntityNode>
  /** All relationships */
  relationships: EntityRelationship[]
  /** Alias resolution index: alias -> canonical ID */
  aliasIndex: Record<string, string>
  /** Last entity extraction timestamp */
  lastExtraction: number
  /** Schema version for entity graph */
  graphVersion: number
}

/**
 * Entity Memory configuration
 */
export interface EntityMemoryConfig {
  /** Enable entity extraction (default: false - opt-in) */
  enabled: boolean
  /** Maximum entities to track (default: 200) */
  max_entities: number
  /** Maximum relationships to track (default: 500) */
  max_relationships: number
  /**
   * Minimum mentions threshold used for retention priority and injection gating (default: 2).
   * Note: Entities below this may still be retained if the graph is under capacity.
   */
  min_mentions: number
  /** Minimum confidence to include in injection (default: 0.4) */
  injection_confidence_threshold: number
  /** Entity types to extract (default: all) */
  extract_types: EntityType[]
}

export const DEFAULT_ENTITY_MEMORY_CONFIG: EntityMemoryConfig = {
  enabled: false, // Opt-in by default
  max_entities: 200,
  max_relationships: 500,
  min_mentions: 2,
  injection_confidence_threshold: 0.4,
  extract_types: ["person", "project", "technology", "organization", "concept"],
}

export const DEFAULT_ENTITY_GRAPH: EntityGraph = {
  nodes: {},
  relationships: [],
  aliasIndex: {},
  lastExtraction: 0,
  graphVersion: 1,
}

// ============================================================================
// Semantic Clustering Configuration (Phase 3)
// ============================================================================

/**
 * Configuration for semantic clustering with LLM-assisted merging
 */
export interface SemanticClusteringConfig {
  /** Enable LLM-assisted clustering (default: true) */
  enabled: boolean
  /** Word overlap threshold for definite match (default: 0.6) */
  high_confidence_threshold: number
  /** Word overlap threshold for candidate selection (default: 0.25) */
  candidate_threshold: number
  /** Maximum LLM calls per aggregation (default: 20) */
  max_llm_calls: number
  /** Enable synonym expansion (default: true) */
  use_synonyms: boolean
  /** Enable Porter stemming (default: true) */
  use_stemming: boolean
}

export const DEFAULT_SEMANTIC_CLUSTERING_CONFIG: SemanticClusteringConfig = {
  enabled: true,
  high_confidence_threshold: 0.6,
  candidate_threshold: 0.25,
  max_llm_calls: 20,
  use_synonyms: true,
  use_stemming: true,
}

// ============================================================================
// Embedding Configuration (Vector Search)
// ============================================================================

// Re-export embedding types for convenience
export type {
  EmbeddingConfig,
  EmbeddingProvider,
  EmbeddingCache,
  EmbeddingCacheFile,
  HybridWeights,
  HybridSimilarityResult,
} from "./embeddings/types"

export {
  DEFAULT_EMBEDDING_CONFIG,
  DEFAULT_HYBRID_WEIGHTS,
} from "./embeddings/types"
