/**
 * Silent Tool Output Hook
 *
 * Addresses the Reddit community observation: even when content is written to
 * persistent files, the tool output returns full content back into context,
 * defeating the purpose of "Filesystem = Disk" pattern.
 *
 * Optimizations:
 * - Write/Edit: Return only metadata (path, bytes, lines) instead of content
 * - Read for planning files: Minimal output since PreToolUse injects content
 * - Grep/Glob: Truncate results with "use Read for details" hint
 *
 * Core principle: "Trust the filesystem, not the context"
 *
 * @example
 * // Before optimization:
 * Write("file.ts", <200 lines>) -> "Successfully wrote:\n<200 lines>"
 *
 * // After optimization:
 * Write("file.ts", <200 lines>) -> "✓ file.ts written (5000 bytes, 200 lines)"
 */

import type { PluginInput, Hooks } from "../../types"

/** Tools that produce write operations */
const WRITE_TOOLS = ["Write", "Edit", "NotebookEdit", "write", "edit"]

/** Tools that produce read operations */
const READ_TOOLS = ["Read", "read"]

/** Tools that produce search results */
const SEARCH_TOOLS = ["Grep", "Glob", "grep", "glob", "safe_grep", "safe_glob"]

/**
 * Patterns to identify planning-related files.
 * These files are handled specially because:
 * 1. PreToolUse hook injects their content before tool execution
 * 2. Reading them again would be redundant in context
 */
const PLANNING_FILE_PATTERNS = [
  /task_plan\.md$/,
  /findings\.md$/,
  /progress\.md$/,
  /\.planning-state\.json$/,
]

/**
 * Configuration for silent tool output behavior.
 * Uses snake_case to match schema convention.
 */
export interface SilentToolOutputConfig {
  /**
   * Replace write tool outputs with metadata only.
   * Instead of returning the written content, returns:
   * "✓ {path} written ({bytes} bytes, {lines} lines)"
   * @default true
   */
  silent_write: boolean

  /**
   * Optimize read outputs for planning files.
   * Since PreToolUse injects task_plan.md content, reading it again
   * is redundant. Returns minimal confirmation instead.
   * @default true
   */
  optimize_planning_reads: boolean

  /**
   * Truncate search results to reduce context consumption.
   * Provides file locations instead of full content matches.
   * @default true
   */
  optimize_search: boolean

  /**
   * Maximum lines to include in search results before truncation.
   * Remaining results shown as "... and N more results"
   * @default 20
   */
  search_max_lines: number

  /**
   * Maximum characters for content preview (if enabled)
   * @default 200
   */
  preview_max_chars: number
}

/**
 * Default configuration - aggressive optimization enabled
 */
const DEFAULT_CONFIG: SilentToolOutputConfig = {
  silent_write: true,
  optimize_planning_reads: true,
  optimize_search: true,
  search_max_lines: 20,
  preview_max_chars: 200,
}

/**
 * Check if a file path matches planning file patterns
 */
function isPlanningFile(filePath: string): boolean {
  return PLANNING_FILE_PATTERNS.some(pattern => pattern.test(filePath))
}

/**
 * Count newlines in content to determine line count
 */
function countLines(content: string): number {
  if (!content) return 0
  return content.split("\n").length
}

/**
 * Extract file path from tool input object.
 * Handles various tool input formats.
 */
function extractPath(input: unknown): string | null {
  if (typeof input !== "object" || input === null) {
    return null
  }

  const obj = input as Record<string, unknown>

  // Try common path field names
  const pathFields = ["file_path", "path", "filePath", "notebook_path"]
  for (const field of pathFields) {
    if (typeof obj[field] === "string") {
      return obj[field] as string
    }
  }

  return null
}

/**
 * Create optimized output for write operations.
 *
 * Replaces full content echo with metadata summary:
 * - File path
 * - Byte count
 * - Line count
 *
 * For planning files, uses even shorter format since they're
 * frequently accessed and injected via PreToolUse.
 */
function createSilentWriteOutput(
  originalOutput: string,
  filePath: string | null
): string {
  const bytes = Buffer.byteLength(originalOutput, "utf-8")
  const lines = countLines(originalOutput)

  // Extra minimal for planning files (frequently accessed)
  if (filePath && isPlanningFile(filePath)) {
    return `✓ ${filePath} updated`
  }

  // Standard format with metadata
  const displayPath = filePath || "file"
  return `✓ ${displayPath} written (${bytes} bytes, ${lines} lines)`
}

/**
 * Create optimized output for read operations on planning files.
 *
 * Since PreToolUse hook injects task_plan.md content before tool execution,
 * the Read tool output is redundant. Return minimal confirmation that
 * references the injected content location.
 */
function createOptimizedReadOutput(
  originalOutput: string,
  filePath: string | null
): string {
  // Only optimize planning file reads
  if (!filePath || !isPlanningFile(filePath)) {
    return originalOutput
  }

  const lines = countLines(originalOutput)
  return `✓ ${filePath} loaded (${lines} lines) - content available in <task-plan-context>`
}

/**
 * Truncate search results to reduce context consumption.
 *
 * Keeps first N lines and adds summary of remaining results.
 * Encourages using Read tool for detailed content inspection.
 */
function createOptimizedSearchOutput(
  originalOutput: string,
  maxLines: number
): string {
  const lines = originalOutput.split("\n")

  // No truncation needed
  if (lines.length <= maxLines) {
    return originalOutput
  }

  // Truncate and add hint
  const truncated = lines.slice(0, maxLines).join("\n")
  const remaining = lines.length - maxLines

  return `${truncated}\n\n... and ${remaining} more results (use Read tool to view specific files)`
}

/**
 * Create the silent tool output hook.
 *
 * Attaches to the "tool.execute.after" event to modify tool outputs
 * before they enter the context window.
 *
 * @param ctx - Plugin context
 * @param config - Partial configuration (merged with defaults)
 * @returns Hooks object with tool.execute.after handler
 */
export function createSilentToolOutputHook(
  ctx: PluginInput,
  config: Partial<SilentToolOutputConfig> = {}
): Hooks {
  const fullConfig = { ...DEFAULT_CONFIG, ...config }

  return {
    /**
     * Post-execution hook for tool output optimization.
     *
     * Intercepts tool outputs and replaces verbose content with
     * minimal metadata summaries.
     */
    "tool.execute.after": async (
      input: {
        tool: string
        input: unknown
        sessionID: string
        callID: string
      },
      output: {
        title: string
        output: string
        metadata: unknown
      }
    ) => {
      const toolName = input.tool
      const filePath = extractPath(input.input)

      // Handle Write/Edit tools - replace content with metadata
      if (fullConfig.silent_write && WRITE_TOOLS.includes(toolName)) {
        output.output = createSilentWriteOutput(output.output, filePath)
        return
      }

      // Handle Read for planning files - minimize since PreToolUse injects
      if (fullConfig.optimize_planning_reads && READ_TOOLS.includes(toolName)) {
        if (filePath && isPlanningFile(filePath)) {
          output.output = createOptimizedReadOutput(output.output, filePath)
          return
        }
      }

      // Handle search tools - truncate long results
      if (fullConfig.optimize_search && SEARCH_TOOLS.includes(toolName)) {
        output.output = createOptimizedSearchOutput(
          output.output,
          fullConfig.search_max_lines
        )
        return
      }
    },
  }
}

// Export types and defaults for external configuration
export type { SilentToolOutputConfig }
export { DEFAULT_CONFIG as DEFAULT_SILENT_CONFIG }
