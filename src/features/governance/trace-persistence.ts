/**
 * Trace Persistence
 *
 * Persists execution traces to disk for post-session debugging.
 * Traces are stored in compressed format to reduce storage.
 *
 * Location: ~/.orchestrator/traces/{sessionId}.json
 */

import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync, unlinkSync, statSync } from "node:fs"
import { join } from "node:path"
import { homedir } from "node:os"
import type {
  ExecutionTrace,
  TraceNode,
  TraceEdge,
  TraceEvent,
  TraceMetrics,
  CompressedTrace,
} from "./tracer-types"
import { log } from "../../shared/logger"

// ============================================================================
// Types
// ============================================================================

/**
 * Persisted trace format (compressed for storage)
 */
export interface PersistedTrace {
  /** Format version */
  version: 1
  /** Session ID */
  sessionId: string
  /** Trace ID */
  traceId: string
  /** When trace started */
  startedAt: number
  /** When trace ended */
  endedAt: number
  /** Total duration in ms */
  durationMs: number
  /** Summary metrics */
  metrics: TraceMetrics
  /** Critical nodes only (filtered) */
  nodes: PersistedTraceNode[]
  /** Edges between nodes */
  edges: TraceEdge[]
  /** Recent timeline events (last N) */
  recentTimeline: TraceEvent[]
  /** Compression stats */
  compression: {
    originalNodeCount: number
    persistedNodeCount: number
    originalTimelineCount: number
    persistedTimelineCount: number
  }
}

/**
 * Simplified node for persistence (reduced size)
 */
export interface PersistedTraceNode {
  id: string
  type: TraceNode["type"]
  name: string
  status: TraceNode["status"]
  startedAt: number
  durationMs?: number
  /** Summarized inputs (keys only, not values) */
  inputKeys?: string[]
  /** Summarized outputs (keys only, not values) */
  outputKeys?: string[]
  /** Resource usage */
  resources?: TraceNode["resources"]
  /** Error summary if failed */
  error?: { type: string; message: string }
  /** Parent node for hierarchy */
  parentId?: string
}

/**
 * Query filter for traces
 */
export interface TraceQueryFilter {
  /** Session ID filter */
  sessionId?: string
  /** After timestamp */
  after?: number
  /** Before timestamp */
  before?: number
  /** Limit results */
  limit?: number
}

/**
 * Trace list entry (for listing without loading full trace)
 */
export interface TraceListEntry {
  sessionId: string
  traceId: string
  startedAt: number
  endedAt: number
  durationMs: number
  nodeCount: number
  filePath: string
}

// ============================================================================
// Configuration
// ============================================================================

const TRACES_DIR = join(homedir(), ".orchestrator", "traces")
const MAX_TIMELINE_EVENTS = 100
const MAX_TRACES_RETENTION = 50 // Keep last 50 traces
const CRITICAL_NODE_TYPES: TraceNode["type"][] = ["tool", "agent", "decision", "checkpoint"]

// ============================================================================
// Storage Functions
// ============================================================================

/**
 * Ensure traces directory exists
 */
function ensureTracesDir(): void {
  if (!existsSync(TRACES_DIR)) {
    mkdirSync(TRACES_DIR, { recursive: true })
  }
}

/**
 * Get trace file path for a session
 */
function getTraceFilePath(sessionId: string): string {
  return join(TRACES_DIR, `${sessionId}.json`)
}

/**
 * Compress a trace node for persistence
 */
function compressNode(node: TraceNode): PersistedTraceNode {
  return {
    id: node.id,
    type: node.type,
    name: node.name,
    status: node.status,
    startedAt: node.timing.startedAt,
    durationMs: node.timing.durationMs,
    inputKeys: node.inputs ? Object.keys(node.inputs) : undefined,
    outputKeys: node.outputs ? Object.keys(node.outputs) : undefined,
    resources: node.resources,
    error: node.error ? { type: node.error.type, message: node.error.message } : undefined,
    parentId: node.parentId,
  }
}

/**
 * Filter nodes to keep only critical ones
 */
function filterCriticalNodes(nodes: TraceNode[]): TraceNode[] {
  return nodes.filter((node) => {
    // Keep critical node types
    if (CRITICAL_NODE_TYPES.includes(node.type)) return true
    // Keep failed nodes
    if (node.status === "failed") return true
    // Keep nodes with significant duration (> 100ms)
    if (node.timing.durationMs && node.timing.durationMs > 100) return true
    return false
  })
}

/**
 * Persist an execution trace to disk
 */
export function persistTrace(trace: ExecutionTrace): PersistedTrace | null {
  try {
    ensureTracesDir()

    const criticalNodes = filterCriticalNodes(trace.nodes)
    const recentTimeline = trace.timeline.slice(-MAX_TIMELINE_EVENTS)

    const persisted: PersistedTrace = {
      version: 1,
      sessionId: trace.sessionId,
      traceId: trace.traceId,
      startedAt: trace.startedAt,
      endedAt: trace.endedAt ?? Date.now(),
      durationMs: (trace.endedAt ?? Date.now()) - trace.startedAt,
      metrics: trace.metrics,
      nodes: criticalNodes.map(compressNode),
      edges: trace.edges,
      recentTimeline,
      compression: {
        originalNodeCount: trace.nodes.length,
        persistedNodeCount: criticalNodes.length,
        originalTimelineCount: trace.timeline.length,
        persistedTimelineCount: recentTimeline.length,
      },
    }

    const filePath = getTraceFilePath(trace.sessionId)
    writeFileSync(filePath, JSON.stringify(persisted)) // Compact JSON for performance

    log("[trace-persistence] saved trace", {
      sessionId: trace.sessionId,
      nodes: persisted.compression.persistedNodeCount,
      original: persisted.compression.originalNodeCount,
    })

    // Cleanup old traces
    cleanupOldTraces()

    return persisted
  } catch (error) {
    log("[trace-persistence] failed to save trace", { error: String(error) })
    return null
  }
}

/**
 * Load a persisted trace by session ID
 */
export function loadTrace(sessionId: string): PersistedTrace | null {
  try {
    const filePath = getTraceFilePath(sessionId)
    if (!existsSync(filePath)) {
      return null
    }

    const content = readFileSync(filePath, "utf-8")
    return JSON.parse(content) as PersistedTrace
  } catch (error) {
    log("[trace-persistence] failed to load trace", { sessionId, error: String(error) })
    return null
  }
}

/**
 * List all available traces
 */
export function listTraces(filter?: TraceQueryFilter): TraceListEntry[] {
  try {
    ensureTracesDir()

    const files = readdirSync(TRACES_DIR).filter((f) => f.endsWith(".json"))
    let entries: TraceListEntry[] = []

    for (const file of files) {
      const filePath = join(TRACES_DIR, file)
      try {
        const content = readFileSync(filePath, "utf-8")
        const trace = JSON.parse(content) as PersistedTrace

        entries.push({
          sessionId: trace.sessionId,
          traceId: trace.traceId,
          startedAt: trace.startedAt,
          endedAt: trace.endedAt,
          durationMs: trace.durationMs,
          nodeCount: trace.compression.originalNodeCount,
          filePath,
        })
      } catch {
        // Skip malformed files
      }
    }

    // Apply filters
    if (filter?.sessionId) {
      entries = entries.filter((e) => e.sessionId === filter.sessionId)
    }
    if (filter?.after) {
      entries = entries.filter((e) => e.startedAt >= filter.after!)
    }
    if (filter?.before) {
      entries = entries.filter((e) => e.startedAt <= filter.before!)
    }

    // Sort by startedAt descending (most recent first)
    entries.sort((a, b) => b.startedAt - a.startedAt)

    if (filter?.limit) {
      entries = entries.slice(0, filter.limit)
    }

    return entries
  } catch (error) {
    log("[trace-persistence] failed to list traces", { error: String(error) })
    return []
  }
}

/**
 * Get the most recent trace
 */
export function getLatestTrace(): PersistedTrace | null {
  const entries = listTraces({ limit: 1 })
  if (entries.length === 0) return null
  return loadTrace(entries[0].sessionId)
}

/**
 * Delete a trace by session ID
 */
export function deleteTrace(sessionId: string): boolean {
  try {
    const filePath = getTraceFilePath(sessionId)
    if (existsSync(filePath)) {
      unlinkSync(filePath)
      return true
    }
    return false
  } catch {
    return false
  }
}

/**
 * Cleanup old traces to stay within retention limit
 */
function cleanupOldTraces(): void {
  try {
    const entries = listTraces()
    if (entries.length <= MAX_TRACES_RETENTION) return

    // Delete oldest traces
    const toDelete = entries.slice(MAX_TRACES_RETENTION)
    for (const entry of toDelete) {
      try {
        unlinkSync(entry.filePath)
      } catch {
        // Ignore deletion errors
      }
    }

    if (toDelete.length > 0) {
      log("[trace-persistence] cleaned up old traces", { deleted: toDelete.length })
    }
  } catch {
    // Silent fail
  }
}

// ============================================================================
// Formatting Functions
// ============================================================================

/**
 * Format a persisted trace as YAML for display
 */
export function formatTraceAsYaml(trace: PersistedTrace): string {
  const lines: string[] = []

  lines.push("# Execution Trace")
  lines.push("")
  lines.push("metadata:")
  lines.push(`  session_id: ${trace.sessionId}`)
  lines.push(`  trace_id: ${trace.traceId}`)
  lines.push(`  started_at: ${new Date(trace.startedAt).toISOString()}`)
  lines.push(`  ended_at: ${new Date(trace.endedAt).toISOString()}`)
  lines.push(`  duration_ms: ${trace.durationMs}`)

  lines.push("")
  lines.push("metrics:")
  lines.push(`  total_nodes: ${trace.metrics.nodeCount}`)
  lines.push(`  total_edges: ${trace.metrics.edgeCount}`)
  lines.push(`  total_tokens: ${trace.metrics.totalTokensUsed}`)
  lines.push(`  total_api_calls: ${trace.metrics.totalApiCalls}`)

  lines.push("")
  lines.push("compression:")
  lines.push(`  original_nodes: ${trace.compression.originalNodeCount}`)
  lines.push(`  persisted_nodes: ${trace.compression.persistedNodeCount}`)

  lines.push("")
  lines.push(`nodes: # ${trace.nodes.length} critical nodes`)
  for (const node of trace.nodes.slice(0, 30)) {
    lines.push(`  - id: ${node.id}`)
    lines.push(`    type: ${node.type}`)
    lines.push(`    name: ${node.name}`)
    lines.push(`    status: ${node.status}`)
    if (node.durationMs) {
      lines.push(`    duration_ms: ${node.durationMs}`)
    }
    if (node.error) {
      lines.push(`    error: ${node.error.message}`)
    }
  }

  if (trace.nodes.length > 30) {
    lines.push(`  # ... and ${trace.nodes.length - 30} more nodes`)
  }

  return lines.join("\n")
}

/**
 * Generate Mermaid flowchart from persisted trace
 */
export function traceToMermaid(trace: PersistedTrace): string {
  const lines: string[] = ["flowchart TD"]

  // Add nodes
  for (const node of trace.nodes) {
    const label = `${node.name} (${node.durationMs ?? 0}ms)`
    let shape = { open: "[", close: "]" }

    if (node.type === "decision") shape = { open: "{", close: "}" }
    else if (node.type === "checkpoint") shape = { open: "[[", close: "]]" }
    else if (node.type === "agent") shape = { open: "((", close: "))" }

    lines.push(`    ${node.id}${shape.open}"${label}"${shape.close}`)

    // Add styling for status
    if (node.status === "failed") {
      lines.push(`    style ${node.id} fill:#f44336,stroke:#333`)
    } else if (node.status === "completed") {
      lines.push(`    style ${node.id} fill:#4CAF50,stroke:#333`)
    }
  }

  // Add edges
  for (const edge of trace.edges) {
    const fromExists = trace.nodes.some((n) => n.id === edge.from)
    const toExists = trace.nodes.some((n) => n.id === edge.to)

    if (fromExists && toExists) {
      const arrow = edge.type === "data-flow" ? "==>" : "-->"
      lines.push(`    ${edge.from} ${arrow} ${edge.to}`)
    }
  }

  return lines.join("\n")
}

/**
 * Get traces summary for dashboard
 */
export function getTracesSummary(): {
  totalTraces: number
  recentTraces: TraceListEntry[]
  totalDurationMs: number
  avgDurationMs: number
} {
  const entries = listTraces({ limit: 10 })
  const totalDurationMs = entries.reduce((sum, e) => sum + e.durationMs, 0)

  return {
    totalTraces: entries.length,
    recentTraces: entries,
    totalDurationMs,
    avgDurationMs: entries.length > 0 ? Math.round(totalDurationMs / entries.length) : 0,
  }
}
