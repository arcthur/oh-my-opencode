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
// Configuration
// ============================================================================

export interface SessionHandoffConfig {
  /** Enable session handoff feature */
  enabled: boolean

  /** Automatically extract handoff on session end */
  auto_extract: boolean

  /** Automatically inject relevant handoffs on session start */
  auto_inject: boolean

  /** Minimum messages for auto-extraction */
  min_messages_for_extract: number

  /** Minimum file modifications for auto-extraction (prevents "chat-only" sessions from generating handoffs) */
  min_file_changes_for_extract: number

  /** Maximum handoffs to inject */
  max_inject_count: number

  /** Handoff expiration in days */
  expiry_days: number

  /** Run extraction asynchronously in background (non-blocking) */
  async_extraction: boolean

  /** Extractor configuration */
  extractor: ExtractorConfig
}

export interface ExtractorConfig {
  /** Model for extraction */
  model: "haiku" | "sonnet" | "opus"

  /** Maximum decisions to extract */
  max_decisions: number

  /** Maximum artifacts to track */
  max_artifacts: number

  /** Generate embedding index */
  generate_embeddings: boolean
}

export const DEFAULT_HANDOFF_CONFIG: SessionHandoffConfig = {
  enabled: true,
  auto_extract: true,
  auto_inject: true,
  min_messages_for_extract: 5,
  min_file_changes_for_extract: 1,
  max_inject_count: 3,
  expiry_days: 7,
  async_extraction: true,
  extractor: {
    model: "haiku",
    max_decisions: 10,
    max_artifacts: 20,
    generate_embeddings: true,
  },
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
