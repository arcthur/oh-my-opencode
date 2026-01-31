/**
 * Recovery Pattern Detector
 *
 * Detects sequences where multiple tool failures are followed by success,
 * extracting the complete "recovery journey" as a reusable pattern.
 */

import type {
  RecoveryPattern,
  FailedAttempt,
  SuccessfulResolution,
  ContextSignature,
  ErrorCategory,
  RecoveryPatternStats,
} from "./types"

// ============================================================================
// Tool Execution Tracking
// ============================================================================

/**
 * A tracked tool execution event
 */
export interface ToolExecution {
  tool: string
  args: Record<string, unknown>
  success: boolean
  error?: string
  result?: string
  timestamp: number
}

// ============================================================================
// Configuration
// ============================================================================

export interface RecoveryDetectorConfig {
  /** Minimum failures before success to capture */
  minFailures: number

  /** Maximum failures to include in sequence */
  maxFailures: number

  /** Sliding window size for detection */
  windowSize: number
}

export const DEFAULT_RECOVERY_DETECTOR_CONFIG: RecoveryDetectorConfig = {
  minFailures: 2,
  maxFailures: 5,
  windowSize: 10,
}

// ============================================================================
// Error Classification
// ============================================================================

/**
 * Classify an error message into a category
 */
export function classifyError(error: string): ErrorCategory {
  const lower = error.toLowerCase()

  if (/type\s*(error|mismatch)|cannot\s+assign|is not assignable|expected.*got/.test(lower)) {
    return "type-error"
  }
  if (/module\s+not\s+found|cannot\s+find\s+module|no\s+such\s+file|enoent/.test(lower)) {
    return "module-not-found"
  }
  if (/syntax\s*error|unexpected\s+token|parsing\s+error|unterminated/.test(lower)) {
    return "syntax-error"
  }
  if (/permission\s+denied|eacces|eperm|access\s+denied/.test(lower)) {
    return "permission-denied"
  }
  if (/econnrefused|etimedout|network|fetch\s+failed|socket\s+hang/.test(lower)) {
    return "network-error"
  }
  if (/validation|invalid|required\s+field|must\s+be|schema/.test(lower)) {
    return "validation-error"
  }
  if (/runtime|uncaught|exception|referenceerror|rangeerror/.test(lower)) {
    return "runtime-error"
  }

  return "unknown"
}

// ============================================================================
// Same-Intent Detection
// ============================================================================

/**
 * Extract the command prefix from a bash command
 */
function extractCommandPrefix(command: unknown): string {
  if (typeof command !== "string") return ""
  return command.trim().split(/\s+/)[0] || ""
}

/**
 * Get the file path from tool arguments
 */
function getFilePath(args: Record<string, unknown>): string | undefined {
  return (args.file_path ?? args.filePath ?? args.path) as string | undefined
}

/**
 * Get the pattern from tool arguments
 */
function getPattern(args: Record<string, unknown>): string | undefined {
  return args.pattern as string | undefined
}

/**
 * Check if two tool executions target the same intent
 */
export function isSameIntent(a: ToolExecution, b: ToolExecution): boolean {
  if (a.tool !== b.tool) return false

  switch (a.tool) {
    case "Edit":
    case "Write":
    case "Read":
      return getFilePath(a.args) === getFilePath(b.args)

    case "Bash": {
      const aCmd = extractCommandPrefix(a.args.command)
      const bCmd = extractCommandPrefix(b.args.command)
      return aCmd === bCmd && aCmd !== ""
    }

    case "Grep":
    case "Glob":
      return getPattern(a.args) === getPattern(b.args)

    default:
      // Same tool = same intent for unknown tools
      return true
  }
}

// ============================================================================
// Context Signature Extraction
// ============================================================================

/**
 * Extract file patterns from tool arguments
 */
function extractFilePatterns(executions: ToolExecution[]): string[] {
  const patterns = new Set<string>()

  for (const exec of executions) {
    const filePath = getFilePath(exec.args)
    if (filePath) {
      // Extract extension pattern
      const ext = filePath.match(/\.[a-z0-9]+$/i)?.[0]
      if (ext) patterns.add(`*${ext}`)

      // Extract directory pattern
      const dir = filePath.split("/").slice(0, -1).join("/")
      if (dir) patterns.add(`${dir}/*`)
    }

    const pattern = getPattern(exec.args)
    if (pattern) patterns.add(pattern)
  }

  return [...patterns].slice(0, 5) // Limit to 5 patterns
}

/**
 * Extract tool chain from executions
 */
function extractToolChain(failures: ToolExecution[], success: ToolExecution): string[] {
  const chain = failures.map((f) => f.tool)
  chain.push(success.tool)
  return [...new Set(chain)] // Deduplicate
}

/**
 * Build context signature from a recovery sequence
 */
function buildContextSignature(
  failures: ToolExecution[],
  success: ToolExecution
): ContextSignature {
  // Determine primary error category from failures
  const errorCategories = failures
    .filter((f) => f.error)
    .map((f) => classifyError(f.error!))

  // Use most common category
  const categoryCounts = new Map<ErrorCategory, number>()
  for (const cat of errorCategories) {
    categoryCounts.set(cat, (categoryCounts.get(cat) ?? 0) + 1)
  }

  let primaryCategory: ErrorCategory = "unknown"
  let maxCount = 0
  for (const [cat, count] of categoryCounts) {
    if (count > maxCount) {
      maxCount = count
      primaryCategory = cat
    }
  }

  return {
    filePatterns: extractFilePatterns([...failures, success]),
    errorCategory: primaryCategory,
    toolChain: extractToolChain(failures, success),
  }
}

// ============================================================================
// Recovery Pattern Detector
// ============================================================================

/**
 * Generates a unique ID for a recovery pattern
 */
function generatePatternId(failures: ToolExecution[]): string {
  const timestamp = Date.now()
  const hash = failures
    .map((f) => `${f.tool}:${f.error?.slice(0, 20) ?? ""}`)
    .join("|")
    .split("")
    .reduce((a, b) => ((a << 5) - a + b.charCodeAt(0)) | 0, 0)
    .toString(16)
    .replace("-", "n")

  return `rp_${timestamp}_${hash}`
}

/**
 * Sanitize tool arguments by removing potentially sensitive data
 */
function sanitizeArgs(args: Record<string, unknown>): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {}
  const sensitiveKeys = ["password", "token", "key", "secret", "credential", "auth"]

  for (const [key, value] of Object.entries(args)) {
    const lowerKey = key.toLowerCase()
    if (sensitiveKeys.some((s) => lowerKey.includes(s))) {
      sanitized[key] = "[REDACTED]"
    } else if (typeof value === "string" && value.length > 500) {
      sanitized[key] = value.slice(0, 500) + "..."
    } else {
      sanitized[key] = value
    }
  }

  return sanitized
}

/**
 * Recovery Pattern Detector
 *
 * Monitors tool executions and detects recovery patterns
 * when failures are followed by success.
 */
export class RecoveryPatternDetector {
  private buffer: ToolExecution[] = []
  private config: RecoveryDetectorConfig

  constructor(config: Partial<RecoveryDetectorConfig> = {}) {
    this.config = { ...DEFAULT_RECOVERY_DETECTOR_CONFIG, ...config }
  }

  /**
   * Process a tool execution event
   * Returns a RecoveryPattern if one was detected
   */
  onToolExecuted(execution: ToolExecution): RecoveryPattern | null {
    // Add to buffer
    this.buffer.push(execution)

    // Trim buffer to window size
    while (this.buffer.length > this.config.windowSize) {
      this.buffer.shift()
    }

    // Only check for patterns on success
    if (!execution.success) {
      return null
    }

    // Scan backward for consecutive failures with same intent
    const failures: ToolExecution[] = []
    for (let i = this.buffer.length - 2; i >= 0; i--) {
      const prev = this.buffer[i]

      // Stop at success (different recovery sequence)
      if (prev.success) break

      // Check if same intent
      if (this.isSameIntentAsSuccess(prev, execution)) {
        failures.unshift(prev)
      }

      // Limit failures
      if (failures.length >= this.config.maxFailures) break
    }

    // Check minimum failures
    if (failures.length < this.config.minFailures) {
      return null
    }

    return this.buildPattern(failures, execution)
  }

  /**
   * Check if a failure has the same intent as the success
   */
  private isSameIntentAsSuccess(failure: ToolExecution, success: ToolExecution): boolean {
    return isSameIntent(failure, success)
  }

  /**
   * Build a recovery pattern from failures and success
   */
  private buildPattern(
    failures: ToolExecution[],
    success: ToolExecution
  ): RecoveryPattern {
    const now = Date.now()

    const failureSequence: FailedAttempt[] = failures.map((f) => ({
      tool: f.tool,
      args: sanitizeArgs(f.args),
      error: f.error ?? "Unknown error",
      timestamp: f.timestamp,
    }))

    const resolution: SuccessfulResolution = {
      tool: success.tool,
      args: sanitizeArgs(success.args),
      result: success.result?.slice(0, 200) ?? "Success",
      timestamp: success.timestamp,
    }

    const stats: RecoveryPatternStats = {
      occurrences: 1,
      firstSeen: now,
      lastSeen: now,
      successfulApplications: 0,
    }

    return {
      id: generatePatternId(failures),
      failureSequence,
      resolution,
      insight: undefined, // Populated async by LLM
      contextSignature: buildContextSignature(failures, success),
      stats,
    }
  }

  /**
   * Reset the detector buffer
   */
  reset(): void {
    this.buffer = []
  }

  /**
   * Get current buffer size (for debugging)
   */
  getBufferSize(): number {
    return this.buffer.length
  }
}

// ============================================================================
// Pattern Deduplication
// ============================================================================

/**
 * Calculate set overlap ratio
 */
function calculateSetOverlap(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1
  if (a.size === 0 || b.size === 0) return 0

  let intersection = 0
  for (const item of a) {
    if (b.has(item)) intersection++
  }

  const union = a.size + b.size - intersection
  return union > 0 ? intersection / union : 0
}

/**
 * Check if two patterns should be merged
 */
export function shouldMergePatterns(a: RecoveryPattern, b: RecoveryPattern): boolean {
  // Same error category
  if (a.contextSignature.errorCategory !== b.contextSignature.errorCategory) {
    return false
  }

  // Same tool chain
  const chainA = a.contextSignature.toolChain.join(",")
  const chainB = b.contextSignature.toolChain.join(",")
  if (chainA !== chainB) {
    return false
  }

  // Similar file patterns (>50% overlap)
  const overlap = calculateSetOverlap(
    new Set(a.contextSignature.filePatterns),
    new Set(b.contextSignature.filePatterns)
  )

  return overlap > 0.5
}

/**
 * Merge a new pattern into an existing one
 */
export function mergePatterns(
  existing: RecoveryPattern,
  incoming: RecoveryPattern
): RecoveryPattern {
  return {
    ...existing,
    stats: {
      ...existing.stats,
      occurrences: existing.stats.occurrences + 1,
      lastSeen: incoming.stats.lastSeen,
    },
    // Keep existing insight if present, otherwise use incoming
    insight: existing.insight ?? incoming.insight,
  }
}

/**
 * Add a pattern to a collection, merging if duplicate
 */
export function addOrMergePattern(
  patterns: RecoveryPattern[],
  newPattern: RecoveryPattern
): RecoveryPattern[] {
  const existingIndex = patterns.findIndex((p) => shouldMergePatterns(p, newPattern))

  if (existingIndex >= 0) {
    const merged = mergePatterns(patterns[existingIndex], newPattern)
    return [...patterns.slice(0, existingIndex), merged, ...patterns.slice(existingIndex + 1)]
  }

  return [...patterns, newPattern]
}
