/**
 * Memory Operations Log
 *
 * Independent trace log for user-memory operations.
 * Stored separately from governance tracer to maintain clean separation:
 * - Governance tracer: execution flow (hook → tool → agent)
 * - Memory operations log: data processing operations
 *
 * Format: JSONL (append-only)
 * Location: ~/.opencode/memory/operations.jsonl
 */

import { existsSync, mkdirSync, appendFileSync, readFileSync, writeFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { homedir } from "node:os"

// ============================================================================
// Types
// ============================================================================

/**
 * Memory operation types
 */
export type MemoryOperationType =
  | "memory-injection"
  | "explicit-memory-capture"
  | "embedding-search"
  | "weekly-aggregation"
  | "monthly-aggregation"
  | "knowledge-extraction"
  | "entity-extraction"
  | "bm25-index-build"
  | "work-history-capture"
  | "pattern-aggregation"

/**
 * Operation status
 */
export type OperationStatus = "started" | "completed" | "failed" | "skipped"

/**
 * Single operation log entry
 */
export interface MemoryOperationEntry {
  /** Unique operation ID */
  id: string
  /** Operation type */
  operation: MemoryOperationType
  /** Session ID (if available) */
  sessionId?: string
  /** Operation status */
  status: OperationStatus
  /** Start timestamp */
  startedAt: number
  /** End timestamp (if completed) */
  endedAt?: number
  /** Duration in ms */
  durationMs?: number
  /** Input summary (sanitized) */
  input?: Record<string, unknown>
  /** Output summary (sanitized) */
  output?: Record<string, unknown>
  /** Error message (if failed) */
  error?: string
  /** Additional metadata */
  metadata?: Record<string, unknown>
}

/**
 * Operations log summary for display
 */
export interface OperationsLogSummary {
  /** Total operations count */
  totalOperations: number
  /** Operations by type */
  byType: Record<MemoryOperationType, number>
  /** Operations by status */
  byStatus: Record<OperationStatus, number>
  /** Recent operations (last N) */
  recentOperations: MemoryOperationEntry[]
  /** Average duration by type (ms) */
  avgDurationByType: Record<string, number>
  /** Total duration (ms) */
  totalDurationMs: number
  /** Time range */
  timeRange: {
    earliest: number
    latest: number
  } | null
}

/**
 * Filter for querying operations
 */
export interface OperationsFilter {
  /** Filter by operation type */
  operation?: MemoryOperationType
  /** Filter by session ID */
  sessionId?: string
  /** Filter by status */
  status?: OperationStatus
  /** After timestamp */
  after?: number
  /** Before timestamp */
  before?: number
  /** Limit results */
  limit?: number
}

// ============================================================================
// Storage
// ============================================================================

const MEMORY_DIR = join(homedir(), ".opencode", "memory")
const OPERATIONS_LOG_FILE = join(MEMORY_DIR, "operations.jsonl")
const MAX_LOG_SIZE_BYTES = 5 * 1024 * 1024 // 5MB
const ROTATION_KEEP_ENTRIES = 1000

/**
 * Ensure memory directory exists
 */
function ensureDir(): void {
  if (!existsSync(MEMORY_DIR)) {
    mkdirSync(MEMORY_DIR, { recursive: true })
  }
}

/**
 * Generate unique operation ID
 */
function generateId(): string {
  return `op_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 8)}`
}

/**
 * Append an entry to the operations log
 */
export function appendOperationEntry(entry: MemoryOperationEntry): void {
  try {
    ensureDir()
    const line = JSON.stringify(entry) + "\n"
    appendFileSync(OPERATIONS_LOG_FILE, line)
  } catch {
    // Silent fail - logging should not break memory operations
  }
}

/**
 * Read all operation entries from log
 */
export function readOperationEntries(filter?: OperationsFilter): MemoryOperationEntry[] {
  try {
    if (!existsSync(OPERATIONS_LOG_FILE)) {
      return []
    }

    const content = readFileSync(OPERATIONS_LOG_FILE, "utf-8")
    const lines = content.split("\n").filter((l) => l.trim())
    let entries: MemoryOperationEntry[] = []

    for (const line of lines) {
      try {
        const entry = JSON.parse(line) as MemoryOperationEntry
        entries.push(entry)
      } catch {
        // Skip malformed lines
      }
    }

    // Apply filters
    if (filter) {
      if (filter.operation) {
        entries = entries.filter((e) => e.operation === filter.operation)
      }
      if (filter.sessionId) {
        entries = entries.filter((e) => e.sessionId === filter.sessionId)
      }
      if (filter.status) {
        entries = entries.filter((e) => e.status === filter.status)
      }
      if (filter.after) {
        entries = entries.filter((e) => e.startedAt >= filter.after!)
      }
      if (filter.before) {
        entries = entries.filter((e) => e.startedAt <= filter.before!)
      }
      if (filter.limit) {
        entries = entries.slice(-filter.limit)
      }
    }

    return entries
  } catch {
    return []
  }
}

/**
 * Get operations log summary
 */
export function getOperationsLogSummary(limit: number = 20): OperationsLogSummary {
  const entries = readOperationEntries()

  const byType: Record<string, number> = {}
  const byStatus: Record<string, number> = {}
  const durationsByType: Record<string, number[]> = {}
  let totalDurationMs = 0
  let earliest = Infinity
  let latest = 0

  for (const entry of entries) {
    // Count by type
    byType[entry.operation] = (byType[entry.operation] || 0) + 1

    // Count by status
    byStatus[entry.status] = (byStatus[entry.status] || 0) + 1

    // Track durations
    if (entry.durationMs !== undefined) {
      if (!durationsByType[entry.operation]) {
        durationsByType[entry.operation] = []
      }
      durationsByType[entry.operation].push(entry.durationMs)
      totalDurationMs += entry.durationMs
    }

    // Track time range
    if (entry.startedAt < earliest) earliest = entry.startedAt
    if (entry.startedAt > latest) latest = entry.startedAt
  }

  // Calculate averages
  const avgDurationByType: Record<string, number> = {}
  for (const [type, durations] of Object.entries(durationsByType)) {
    avgDurationByType[type] = Math.round(
      durations.reduce((a, b) => a + b, 0) / durations.length
    )
  }

  return {
    totalOperations: entries.length,
    byType: byType as Record<MemoryOperationType, number>,
    byStatus: byStatus as Record<OperationStatus, number>,
    recentOperations: entries.slice(-limit),
    avgDurationByType,
    totalDurationMs,
    timeRange: entries.length > 0 ? { earliest, latest } : null,
  }
}

/**
 * Rotate log file if too large
 */
export function rotateLogIfNeeded(): void {
  try {
    if (!existsSync(OPERATIONS_LOG_FILE)) return

    const stats = statSync(OPERATIONS_LOG_FILE)
    if (stats.size < MAX_LOG_SIZE_BYTES) return

    // Keep only recent entries
    const entries = readOperationEntries()
    const toKeep = entries.slice(-ROTATION_KEEP_ENTRIES)
    const dropped = entries.length - toKeep.length

    // Rewrite file
    const content = toKeep.map((e) => JSON.stringify(e)).join("\n") + "\n"
    writeFileSync(OPERATIONS_LOG_FILE, content)

    // Log rotation event
    if (dropped > 0) {
      const rotationEntry: MemoryOperationEntry = {
        id: `op_rotation_${Date.now().toString(36)}`,
        operation: "pattern-aggregation", // reuse existing type for housekeeping
        status: "completed",
        startedAt: Date.now(),
        endedAt: Date.now(),
        durationMs: 0,
        metadata: {
          event: "log-rotation",
          entriesDropped: dropped,
          entriesKept: toKeep.length,
          previousSizeBytes: stats.size,
        },
      }
      appendFileSync(OPERATIONS_LOG_FILE, JSON.stringify(rotationEntry) + "\n")
    }
  } catch {
    // Silent fail - rotation should not break memory operations
  }
}

/**
 * Clear operations log
 */
export function clearOperationsLog(): void {
  try {
    if (existsSync(OPERATIONS_LOG_FILE)) {
      writeFileSync(OPERATIONS_LOG_FILE, "")
    }
  } catch {
    // Silent fail
  }
}

// ============================================================================
// Operation Tracker (for easy start/end tracking)
// ============================================================================

/**
 * Operation tracker for convenient start/end logging
 */
export class OperationTracker {
  private entry: MemoryOperationEntry

  constructor(
    operation: MemoryOperationType,
    options?: {
      sessionId?: string
      input?: Record<string, unknown>
      metadata?: Record<string, unknown>
    }
  ) {
    this.entry = {
      id: generateId(),
      operation,
      sessionId: options?.sessionId,
      status: "started",
      startedAt: Date.now(),
      input: options?.input,
      metadata: options?.metadata,
    }
  }

  /**
   * Mark operation as completed
   */
  complete(output?: Record<string, unknown>): MemoryOperationEntry {
    const now = Date.now()
    this.entry.status = "completed"
    this.entry.endedAt = now
    this.entry.durationMs = now - this.entry.startedAt
    this.entry.output = output
    appendOperationEntry(this.entry)
    return this.entry
  }

  /**
   * Mark operation as failed
   */
  fail(error: string | Error): MemoryOperationEntry {
    const now = Date.now()
    this.entry.status = "failed"
    this.entry.endedAt = now
    this.entry.durationMs = now - this.entry.startedAt
    this.entry.error = error instanceof Error ? error.message : error
    appendOperationEntry(this.entry)
    return this.entry
  }

  /**
   * Mark operation as skipped
   */
  skip(reason?: string): MemoryOperationEntry {
    this.entry.status = "skipped"
    this.entry.endedAt = Date.now()
    this.entry.durationMs = 0
    if (reason) {
      this.entry.metadata = { ...this.entry.metadata, skipReason: reason }
    }
    appendOperationEntry(this.entry)
    return this.entry
  }
}

/**
 * Create a new operation tracker
 */
export function trackOperation(
  operation: MemoryOperationType,
  options?: {
    sessionId?: string
    input?: Record<string, unknown>
    metadata?: Record<string, unknown>
  }
): OperationTracker {
  return new OperationTracker(operation, options)
}

/**
 * Wrap an async function with operation tracking
 */
export async function withOperationTracking<T>(
  operation: MemoryOperationType,
  fn: () => Promise<T>,
  options?: {
    sessionId?: string
    input?: Record<string, unknown>
    metadata?: Record<string, unknown>
    outputMapper?: (result: T) => Record<string, unknown>
  }
): Promise<T> {
  const tracker = trackOperation(operation, options)
  try {
    const result = await fn()
    const output = options?.outputMapper ? options.outputMapper(result) : undefined
    tracker.complete(output)
    return result
  } catch (error) {
    tracker.fail(error instanceof Error ? error : String(error))
    throw error
  }
}

// ============================================================================
// Formatting for Display
// ============================================================================

/**
 * Format operations log as YAML for display
 */
export function formatOperationsLogAsYaml(limit: number = 20): string {
  const summary = getOperationsLogSummary(limit)
  const lines: string[] = []

  lines.push("# Memory Operations Log")
  lines.push("")
  lines.push("summary:")
  lines.push(`  total_operations: ${summary.totalOperations}`)
  lines.push(`  total_duration_ms: ${summary.totalDurationMs}`)

  if (summary.timeRange) {
    lines.push(`  time_range:`)
    lines.push(`    earliest: ${new Date(summary.timeRange.earliest).toISOString()}`)
    lines.push(`    latest: ${new Date(summary.timeRange.latest).toISOString()}`)
  }

  lines.push("")
  lines.push("by_type:")
  for (const [type, count] of Object.entries(summary.byType)) {
    const avgMs = summary.avgDurationByType[type] ?? 0
    lines.push(`  ${type}: ${count} (avg ${avgMs}ms)`)
  }

  lines.push("")
  lines.push("by_status:")
  for (const [status, count] of Object.entries(summary.byStatus)) {
    lines.push(`  ${status}: ${count}`)
  }

  lines.push("")
  lines.push(`recent_operations: # last ${limit}`)
  for (const op of summary.recentOperations.slice(-limit)) {
    lines.push(`  - id: ${op.id}`)
    lines.push(`    operation: ${op.operation}`)
    lines.push(`    status: ${op.status}`)
    lines.push(`    started_at: ${new Date(op.startedAt).toISOString()}`)
    if (op.durationMs !== undefined) {
      lines.push(`    duration_ms: ${op.durationMs}`)
    }
    if (op.sessionId) {
      lines.push(`    session_id: ${op.sessionId}`)
    }
    if (op.output) {
      lines.push(`    output: ${JSON.stringify(op.output)}`)
    }
    if (op.error) {
      lines.push(`    error: ${op.error}`)
    }
  }

  return lines.join("\n")
}
