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
 */

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
  schemaVersion: 2,
  // RAPTOR hierarchical memory defaults
  weeklySummaries: [],
  monthlySummaries: [],
  longTermKnowledge: [],
  lastWeeklyAggregation: undefined,
  lastMonthlyAggregation: undefined,
  lastKnowledgeExtraction: undefined,
}

export const DEFAULT_CONFIG: UserMemoryConfig = {
  enabled: true,
  persist_preferences: true,
  persist_work_history: true,
  max_history_entries: 50,
  auto_inject: true,
}

/** Current schema version - increment when making breaking changes */
export const CURRENT_SCHEMA_VERSION = 2

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
