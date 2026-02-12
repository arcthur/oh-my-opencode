/**
 * Execution Tracer Types
 *
 * Type definitions for runtime execution tracing.
 * Implements shadow execution / observability from design doc.
 */

// ============================================================================
// Core Trace Types
// ============================================================================

/**
 * Runtime execution trace
 * Built automatically, not defined statically
 */
export interface ExecutionTrace {
  /** Unique trace identifier */
  traceId: string

  /** Session this trace belongs to */
  sessionId: string

  /** Start time of the trace */
  startedAt: number

  /** End time (set when trace is finalized) */
  endedAt?: number

  /** All executed nodes */
  nodes: TraceNode[]

  /** Relationships between nodes */
  edges: TraceEdge[]

  /** Chronological event log */
  timeline: TraceEvent[]

  /** Aggregated metrics */
  metrics: TraceMetrics
}

/**
 * A single node in the execution trace
 */
export interface TraceNode {
  /** Unique node identifier */
  id: string

  /** Node type */
  type: TraceNodeType

  /** Human-readable name */
  name: string

  /** Execution timing */
  timing: {
    startedAt: number
    endedAt?: number
    durationMs?: number
  }

  /** Input snapshot (sanitized) */
  inputs: Record<string, unknown>

  /** Output snapshot (sanitized) */
  outputs?: Record<string, unknown>

  /** Resource consumption */
  resources: TraceResources

  /** Execution status */
  status: TraceNodeStatus

  /** Error details if failed */
  error?: TraceError

  /** Parent node ID (for nested execution) */
  parentId?: string

  /** Metadata tags */
  tags?: Record<string, string>
}

export type TraceNodeType = "hook" | "tool" | "agent" | "decision" | "checkpoint" | "governance-block"

export type TraceNodeStatus = "running" | "completed" | "failed" | "suspended"

export interface TraceResources {
  tokensUsed?: number
  apiCalls?: number
  filesRead?: number
  filesWritten?: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
  cacheHitRatio?: number
  prefixFingerprint?: string
}

export interface TraceError {
  type: string
  message: string
  stack?: string
  recoverable?: boolean
}

/**
 * Edge connecting two nodes
 */
export interface TraceEdge {
  /** Source node ID */
  from: string

  /** Target node ID */
  to: string

  /** Edge type */
  type: TraceEdgeType

  /** What triggered this edge */
  trigger: EdgeTrigger

  /** Data transferred (if data-flow) */
  dataKeys?: string[]

  /** Additional data for inferred edges */
  data?: Record<string, unknown>
}

export type TraceEdgeType = "data-flow" | "control-flow" | "trigger" | "spawn"

export interface EdgeTrigger {
  type:
    | "output"
    | "event"
    | "condition"
    | "explicit"
    | "state-dependency"
    | "file-dependency"
  /** Key or path for dependency-based triggers */
  key?: string
  path?: string
  eventType?: string
  details?: string
}

/**
 * Timeline event
 */
export interface TraceEvent {
  timestamp: number
  nodeId?: string
  type: TraceEventType
  details: Record<string, unknown>
}

export type TraceEventType =
  | "node-start"
  | "node-end"
  | "edge-created"
  | "state-change"
  | "state-write"
  | "state-read"
  | "proposal-submit"
  | "proposal-applied"
  | "file-dependency"
  | "event-emit"
  | "event-consume"
  | "resource-warning"
  | "error"

/**
 * Aggregated trace metrics
 */
export interface TraceMetrics {
  totalDurationMs: number
  totalTokensUsed: number
  totalApiCalls: number
  nodeCount: number
  edgeCount: number
  failedNodes: number
  suspendedNodes: number
}

// ============================================================================
// Compression Types
// ============================================================================

/**
 * Compressed trace for visualization
 */
export interface CompressedTrace {
  /** Original node count */
  originalCount: number

  /** Compressed node count */
  compressedCount: number

  /** Compression ratio */
  ratio: number

  /** Compressed nodes (GovernanceBlocks + critical nodes) */
  nodes: (TraceNode | GovernanceBlock)[]

  /** Edges (only between visible nodes) */
  edges: TraceEdge[]
}

/**
 * Governance block: Merged low-impact nodes
 */
export interface GovernanceBlock {
  type: "governance-block"

  /** Block identifier */
  id: string

  /** Number of merged nodes */
  mergedCount: number

  /** Time span of merged nodes */
  timeSpan: { start: number; end: number }

  /** Summary of merged activity */
  summary: string

  /** Aggregated resource usage */
  totalResources: {
    tokensUsed: number
    apiCalls: number
  }

  /** Original node IDs (for drill-down) */
  originalNodeIds: string[]
}

/**
 * Critical path trace: Only decision points
 */
export interface CriticalPathTrace {
  /** Critical nodes only */
  nodes: TraceNode[]

  /** Why each node is critical */
  criticality: Map<string, CriticalityReason>
}

export type CriticalityReason =
  | { type: "llm-decision"; decision: string }
  | { type: "condition-branch"; condition: string; result: boolean }
  | { type: "state-mutation"; keys: string[] }
  | { type: "approval-gate"; action: "approved" | "rejected" }
  | { type: "error"; error: string }
  | { type: "checkpoint"; checkpointId: string }

// ============================================================================
// Visualization Types
// ============================================================================

/**
 * Export format for visualization tools
 */
export interface TraceVisualization {
  /** D3.js / Mermaid compatible nodes */
  nodes: Array<{
    id: string
    label: string
    type: TraceNodeType
    status: TraceNodeStatus
    duration?: number
  }>

  /** D3.js / Mermaid compatible edges */
  edges: Array<{
    source: string
    target: string
    type: TraceEdgeType
  }>

  /** Gantt chart data */
  timeline: Array<{
    id: string
    name: string
    start: number
    end?: number
  }>

  /** Summary metrics */
  metrics: TraceMetrics
}

/**
 * Mermaid diagram output
 */
export interface MermaidDiagram {
  /** Mermaid syntax string */
  syntax: string

  /** Diagram type */
  type: "flowchart" | "gantt" | "sequenceDiagram"
}

// ============================================================================
// Configuration
// ============================================================================

/**
 * Compression rules configuration
 */
export interface CompressionRules {
  /** Consecutive hooks without state change -> merge */
  mergeThreshold: number

  /** Always keep these node types as critical */
  alwaysCritical: TraceNodeType[]

  /** Hooks that are always low-impact (can be merged) */
  lowImpactHooks: string[]

  /** State keys that indicate high-impact change */
  highImpactStateKeys: string[]
}

export const DEFAULT_COMPRESSION_RULES: CompressionRules = {
  mergeThreshold: 5,
  alwaysCritical: ["decision", "checkpoint"],
  lowImpactHooks: ["logger", "metrics", "telemetry"],
  highImpactStateKeys: ["plan", "task", "approval", "error"],
}

/**
 * Tracer configuration
 */
export interface TracerConfig {
  /** Enable tracing */
  enabled: boolean

  /** Maximum nodes to keep in memory */
  maxNodes: number

  /** Auto-compress after N nodes */
  autoCompressThreshold: number

  /** Sanitize sensitive data in inputs/outputs */
  sanitizeSensitiveData: boolean

  /** Compression rules */
  compression: CompressionRules
}

export const DEFAULT_TRACER_CONFIG: TracerConfig = {
  enabled: true,
  maxNodes: 1000,
  autoCompressThreshold: 500,
  sanitizeSensitiveData: true,
  compression: DEFAULT_COMPRESSION_RULES,
}
