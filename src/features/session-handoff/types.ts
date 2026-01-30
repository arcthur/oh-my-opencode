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

export interface HandoffIndex {
  /** Schema version */
  version: 1

  /** Indexed handoffs */
  handoffs: HandoffIndexEntry[]

  /** Last cleanup timestamp */
  lastCleanup: number
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
}

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
