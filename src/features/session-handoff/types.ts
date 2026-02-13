/**
 * Session Handoff Types
 *
 * Structured knowledge extraction and transfer between sessions.
 * Captures decisions, artifacts, anti-patterns, and domain knowledge.
 */

// ============================================================================
// Core Types
// ============================================================================

/**
 * A structured "graduation certificate" for a completed session
 */
export interface HandoffPackage {
  /** Unique identifier (format: "ho_{timestamp}_{hash}") */
  id: string

  /** Source session ID */
  sourceSessionId: string

  /** Creation timestamp */
  createdAt: number

  /** Expiration timestamp */
  expiresAt: number

  /** Package metadata */
  metadata: HandoffMetadata

  /** Knowledge payload */
  payload: HandoffPayload

  /** Embedding index for semantic search (lazy-computed) */
  embeddingIndex?: EmbeddingIndexEntry[]

  /** Usage metrics for scoring and L3 promotion (added in schema v2) */
  metrics?: HandoffMetrics
}

/**
 * Handoff metadata
 */
export interface HandoffMetadata {
  /** Original goal/request from the session */
  originalGoal: string

  /** Session duration in milliseconds */
  durationMs: number

  /** Project path where work occurred */
  projectPath: string

  /** Target intent description (optional, for guided handoffs) */
  targetIntent?: string

  /** Key files involved */
  keyFiles: string[]

  /** Session outcome */
  outcome: "completed" | "partial" | "blocked"
}

/**
 * Handoff payload containing extracted knowledge
 */
export interface HandoffPayload {
  /** Key decisions made during the session */
  decisions: Decision[]

  /** Files created or modified */
  artifacts: Artifact[]

  /** Approaches that failed (to prevent re-exploration) */
  antiPatterns: AntiPattern[]

  /** Domain knowledge discovered */
  domainContext: string[]

  /** Remaining tasks (optional, for continuation) */
  remainingTasks?: string[]

  /** Captured recovery patterns: failure sequences that led to success */
  recoveryPatterns?: RecoveryPattern[]
}

// ============================================================================
// Decision Types
// ============================================================================

/**
 * A technical decision with rationale
 */
export interface Decision {
  /** What decision was made */
  what: string

  /** The chosen approach */
  chosen: string

  /** Rationale for the choice */
  why: string

  /** Alternatives that were considered and rejected */
  rejected?: RejectedAlternative[]

  /** Files affected by this decision */
  relatedFiles?: string[]

  /** Decision category for filtering */
  category?: DecisionCategory
}

export type DecisionCategory = "architecture" | "implementation" | "tooling" | "convention"

export interface RejectedAlternative {
  approach: string
  reason: string
}

// ============================================================================
// Artifact Types
// ============================================================================

/**
 * A file that was created or modified
 */
export interface Artifact {
  /** File path (relative to project root) */
  path: string

  /** Change type */
  changeType: "created" | "modified" | "deleted"

  /** Brief summary of what changed */
  summary: string

  /** Key line ranges with descriptions (optional) */
  lineRanges?: LineRange[]

  /** Dependencies this file introduced or modified */
  dependencies?: string[]
}

export interface LineRange {
  start: number
  end: number
  description: string
}

// ============================================================================
// Anti-Pattern Types
// ============================================================================

/**
 * An approach that failed and should be avoided
 */
export interface AntiPattern {
  /** The approach that was tried */
  approach: string

  /** Why it failed */
  reason: string

  /** Error signature for matching (optional) */
  errorSignature?: string

  /** Context in which this failed */
  context?: string
}

// ============================================================================
// Recovery Pattern Types
// ============================================================================

/**
 * Error category for pattern matching
 */
export type ErrorCategory =
  | "type-error"
  | "module-not-found"
  | "syntax-error"
  | "runtime-error"
  | "permission-denied"
  | "network-error"
  | "validation-error"
  | "unknown"

/**
 * A failed tool attempt in a recovery sequence
 */
export interface FailedAttempt {
  /** Tool that failed */
  tool: string

  /** Tool arguments (sanitized - no secrets) */
  args: Record<string, unknown>

  /** Error message or failure indicator */
  error: string

  /** Timestamp of attempt */
  timestamp: number
}

/**
 * A successful resolution that followed failures
 */
export interface SuccessfulResolution {
  /** Tool that succeeded */
  tool: string

  /** Tool arguments */
  args: Record<string, unknown>

  /** Success indicator or result summary */
  result: string

  /** Timestamp of success */
  timestamp: number
}

/**
 * LLM-generated insight about a recovery pattern
 */
export interface RecoveryInsight {
  /** One-sentence summary of the lesson */
  summary: string

  /** What to verify BEFORE attempting similar operations */
  precheck: string

  /** The critical change that led to success */
  keyDifference: string

  /** Confidence in the insight (0-1) */
  confidence: number
}

/**
 * Context signature for matching similar recovery scenarios
 */
export interface ContextSignature {
  /** File patterns involved (e.g., ["*.tsx", "package.json"]) */
  filePatterns: string[]

  /** Error category for matching */
  errorCategory: ErrorCategory

  /** Tool chain that was used */
  toolChain: string[]
}

/**
 * Statistics for a recovery pattern
 */
export interface RecoveryPatternStats {
  /** Number of times this pattern has been observed */
  occurrences: number

  /** Timestamp of first observation */
  firstSeen: number

  /** Timestamp of most recent observation */
  lastSeen: number

  /** Number of times this pattern was successfully applied in injection */
  successfulApplications: number
}

/**
 * A captured recovery sequence: failures followed by successful resolution.
 * More actionable than AntiPattern because it includes "what worked".
 */
export interface RecoveryPattern {
  /** Unique identifier (format: "rp_{timestamp}_{hash}") */
  id: string

  /** Sequence of failed attempts leading to resolution */
  failureSequence: FailedAttempt[]

  /** The successful resolution */
  resolution: SuccessfulResolution

  /** LLM-generated lesson learned (populated async) */
  insight?: RecoveryInsight

  /** Context signature for matching similar scenarios */
  contextSignature: ContextSignature

  /** Statistics */
  stats: RecoveryPatternStats
}

// ============================================================================
// Handoff Metrics Types
// ============================================================================

/**
 * Usage metrics for a handoff package.
 * Tracks citation history and successful application rate.
 */
export interface HandoffMetrics {
  /** Number of times this handoff was injected into a session */
  citationCount: number

  /** Number of sessions where injection led to successful outcome */
  successfulCitations: number

  /** Timestamp of most recent citation */
  lastCitedAt: number

  /** Whether this contains architectural decisions (longer half-life) */
  isArchitectural: boolean

  /** Whether user manually pinned this handoff */
  manualPinned: boolean

  /** Computed authority score (0-1), updated on citation */
  authorityScore: number

  /** IDs of sessions that cited this handoff (max 20, FIFO) */
  citedBySessions: string[]
}

/**
 * Default metrics for new handoffs
 */
export const DEFAULT_HANDOFF_METRICS: HandoffMetrics = {
  citationCount: 0,
  successfulCitations: 0,
  lastCitedAt: 0,
  isArchitectural: false,
  manualPinned: false,
  authorityScore: 0.5, // Neutral starting point
  citedBySessions: [],
}

/**
 * Half-life configuration for temporal decay
 */
export interface HalfLifeConfig {
  /** Default half-life in days */
  default: number

  /** Half-life for architectural decisions */
  architectural: number
}

/**
 * Default half-life configuration
 */
export const DEFAULT_HALF_LIFE_CONFIG: HalfLifeConfig = {
  default: 14,
  architectural: 90,
}

/**
 * Scoring weights configuration
 */
export interface ScoringWeights {
  /** Weight for semantic relevance (0-1) */
  relevance: number

  /** Weight for temporal freshness (0-1) */
  freshness: number

  /** Weight for authority score (0-1) */
  authority: number
}

/**
 * Default scoring weights (must sum to 1.0)
 */
export const DEFAULT_SCORING_WEIGHTS: ScoringWeights = {
  relevance: 0.5,
  freshness: 0.25,
  authority: 0.25,
}

/**
 * Handoff with computed score for injection selection
 */
export interface ScoredHandoff {
  handoff: HandoffPackage
  score: number
  components: {
    relevance: number
    freshness: number
    authority: number
  }
}

// ============================================================================
// Embedding Types
// ============================================================================

export interface EmbeddingIndexEntry {
  /** Stable identifier for this entry */
  id: string

  /** Content that was embedded */
  content: string

  /** Category: decision, artifact, antiPattern, domainContext */
  category: "decision" | "artifact" | "antiPattern" | "domainContext"

  /** Index within category */
  index: number

  /**
   * Embedding vector (legacy inline format).
   * Prefer storing vectors in `handoffs/embeddings/*.bin` and use `vectorIndex` instead.
   */
  vector?: number[]

  /** Index into the persisted embeddings file (handoffs/embeddings/{handoffId}.bin) */
  vectorIndex?: number
}

// ============================================================================
// Index Types (for storage)
// ============================================================================

/**
 * Handoff index schema version
 */
export type HandoffIndexVersion = 1 | 2

/**
 * Handoff index (v2 with metrics support)
 */
export interface HandoffIndex {
  /** Schema version */
  version: HandoffIndexVersion

  /** Indexed handoffs */
  handoffs: HandoffIndexEntry[]

  /** Last cleanup timestamp */
  lastCleanup: number

  /** L3 promoted handoff IDs (exempt from expiration) */
  l3Promoted?: string[]
}

/**
 * Metrics summary for quick filtering (stored in index)
 */
export interface HandoffMetricsSummary {
  authorityScore: number
  citationCount: number
  isArchitectural: boolean
  manualPinned: boolean
}

export interface HandoffIndexEntry {
  id: string
  sourceSessionId: string
  projectPath: string
  originalGoal: string
  createdAt: number
  expiresAt: number
  outcome: "completed" | "partial" | "blocked"
  decisionCount: number
  artifactCount: number

  /** Metrics summary for scoring without loading full package */
  metricsSummary?: HandoffMetricsSummary

  /** Count of recovery patterns */
  recoveryPatternCount?: number
}

/**
 * L3 promotion reasons
 */
export type L3PromotionReason =
  | "proven-valuable"
  | "architectural-decision"
  | "user-pinned"
  | "high-authority"

// ============================================================================
// Configuration (re-exported from schema - single source of truth)
// ============================================================================

// Types derived from zod schema
export type {
  SessionHandoffConfig,
  HandoffExtractorConfig as ExtractorConfig,
} from "../../config/schema"

// Default config instance parsed from schema (ensures nested defaults apply)
export { DEFAULT_SESSION_HANDOFF_CONFIG as DEFAULT_HANDOFF_CONFIG } from "../../config/schema"

// ============================================================================
// Session State Types (unified for hook/launcher/extractor)
// ============================================================================

/**
 * Message tracked during a session
 */
export interface TrackedMessage {
  role: "user" | "assistant"
  content: string
  timestamp: number
}

/**
 * Tool call tracked during a session
 */
export interface TrackedToolCall {
  tool: string
  args: Record<string, unknown>
  result: string
  success: boolean
}

/**
 * Snapshot of session state - used for extraction and handoff creation.
 * Immutable view of the session at a point in time.
 */
export interface SessionSnapshot {
  projectPath: string
  startTime: number
  messages: TrackedMessage[]
  toolCalls: TrackedToolCall[]
  /** File paths that were modified during the session */
  fileChanges: string[]
}

/**
 * Runtime session state - extends snapshot with mutable tracking flags.
 * Used internally by the hook for state management.
 */
export interface SessionRuntimeState extends Omit<SessionSnapshot, "fileChanges"> {
  /** File changes as Set for efficient deduplication during tracking */
  fileChanges: Set<string>
  /** Whether handoff context has been injected for this session */
  injected: boolean
  /** Whether handoff has been extracted for this session */
  extracted: boolean
}

/**
 * Convert runtime state to snapshot for extraction/handoff
 */
export function toSessionSnapshot(state: SessionRuntimeState): SessionSnapshot {
  return {
    projectPath: state.projectPath,
    startTime: state.startTime,
    messages: state.messages,
    toolCalls: state.toolCalls,
    fileChanges: [...state.fileChanges],
  }
}

// ============================================================================
// Session Reference Types (for @session:id syntax)
// ============================================================================

export type SessionReferenceType = "full" | "relative" | "handoff" | "latest"

export interface ParsedSessionReference {
  /** Reference type */
  type: SessionReferenceType

  /** Session identifier or relative offset */
  identifier: string

  /** Optional query */
  query?: SessionReferenceQuery
}

export type SessionReferenceQuery =
  | { type: "section"; section: "decisions" | "artifacts" | "antiPatterns" | "context" }
  | { type: "semantic"; query: string }

// ============================================================================
// Extraction Context Types
// ============================================================================

export interface ExtractionContext {
  /** Session ID being extracted */
  sessionId: string

  /** Project path */
  projectPath: string

  /** Session messages (summarized) */
  messages: ExtractionMessage[]

  /** Tool calls with outcomes */
  toolCalls: ExtractionToolCall[]

  /** Files modified during session */
  fileChanges: string[]

  /** Session start timestamp */
  startTime: number

  /** Session end timestamp */
  endTime: number
}

export interface ExtractionMessage {
  role: "user" | "assistant"
  content: string
  timestamp?: number
}

export interface ExtractionToolCall {
  tool: string
  args: Record<string, unknown>
  result: string
  success: boolean
}

// ============================================================================
// Active Handoff Types (Goal-Oriented)
// ============================================================================

/**
 * Request for an active (goal-oriented) handoff
 */
export interface ActiveHandoffRequest {
  /** The goal/task for the new session */
  goal: string

  /** Source session ID */
  sourceSessionId: string

  /** Project path */
  projectPath: string

  /** Launch mode: auto creates new session, preview returns prompt only */
  launchMode: "auto" | "preview"
}

/**
 * Result of an active handoff operation
 */
export interface ActiveHandoffResult {
  /** The created handoff package */
  handoffPackage: HandoffPackage

  /** The generated prompt for the new session */
  prompt: string

  /** New session ID (if launchMode was "auto") */
  newSessionId?: string

  /** User-facing message describing what happened */
  message: string

  /** Count of decisions transferred */
  decisionsTransferred: number

  /** Count of anti-patterns transferred */
  antiPatternsTransferred: number

  /** Key files included */
  keyFiles: string[]
}

/**
 * Request for orchestrator-driven automatic handoff.
 */
export interface AutoHandoffRequest {
  /** Source session ID */
  sessionID: string

  /** Goal/task for the transfer */
  goal: string

  /** Trigger reason (used for audit/debug) */
  reason: string

  /** Launch mode override (defaults from config when omitted) */
  launchMode?: "auto" | "preview"

  /** Optional unresolved discoveries to include in prompt context */
  unresolvedDiscoveries?: Array<{
    id: string
    claim: string
    sourceEventId?: string
    retrievalPath?: string
  }>
}

/**
 * Result of automatic handoff request.
 */
export interface AutoHandoffResult {
  /** Status of the handoff request */
  status: "launched" | "preview" | "failed"

  /** Generated handoff prompt (always returned for observability/fallback) */
  prompt: string

  /** User-facing summary */
  message: string

  /** Created handoff id when extraction succeeded */
  handoffId?: string

  /** New session id when launch mode is auto and launch succeeded */
  newSessionId?: string

  /** True when request failed and caller should use preview prompt fallback */
  fallbackPreview: boolean
}
