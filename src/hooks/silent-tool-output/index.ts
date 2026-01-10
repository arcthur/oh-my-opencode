/**
 * Silent Tool Output Hook
 *
 * Optimizes tool outputs to reduce context consumption:
 * - Write/Edit: Return only metadata (path, bytes, lines)
 * - Read for planning files: Minimal since PreToolUse injects full content
 * - Grep/Glob: Return file locations, not full content
 *
 * Core principle: "Trust the filesystem, not the context"
 */

import type { PluginInput, Hooks } from "../../types"

/** Tools that should have silent/optimized output */
const SILENT_WRITE_TOOLS = ["Write", "Edit", "NotebookEdit", "write", "edit"]
const SILENT_READ_TOOLS = ["Read", "read"]
const OPTIMIZE_SEARCH_TOOLS = ["Grep", "Glob", "grep", "glob", "safe_grep", "safe_glob"]

/** Planning file patterns */
const PLANNING_FILE_PATTERNS = [
  /task_plan\.md$/,
  /findings\.md$/,
  /progress\.md$/,
  /\.planning-state\.json$/,
]

interface SilentToolOutputConfig {
  /** Enable silent write output (default: true) */
  silentWrite: boolean
  /** Enable optimized read for planning files (default: true) */
  optimizePlanningReads: boolean
  /** Enable search result optimization (default: true) */
  optimizeSearch: boolean
  /** Max lines to show in search results (default: 20) */
  searchMaxLines: number
  /** Max content preview chars (default: 200) */
  previewMaxChars: number
}

const DEFAULT_CONFIG: SilentToolOutputConfig = {
  silentWrite: true,
  optimizePlanningReads: true,
  optimizeSearch: true,
  searchMaxLines: 20,
  previewMaxChars: 200,
}

/**
 * Check if path is a planning file
 */
function isPlanningFile(path: string): boolean {
  return PLANNING_FILE_PATTERNS.some(p => p.test(path))
}

/**
 * Count lines in content
 */
function countLines(content: string): number {
  return content.split("\n").length
}

/**
 * Extract path from tool input
 */
function extractPath(input: unknown): string | null {
  if (typeof input === "object" && input !== null) {
    const obj = input as Record<string, unknown>
    return (obj.file_path || obj.path || obj.filePath) as string | null
  }
  return null
}

/**
 * Create silent write output
 */
function createSilentWriteOutput(
  originalOutput: string,
  path: string | null,
  config: SilentToolOutputConfig
): string {
  // Extract useful info from original output
  const bytes = originalOutput.length
  const lines = countLines(originalOutput)

  // For planning files, extra minimal
  if (path && isPlanningFile(path)) {
    return `✓ ${path} updated`
  }

  // For regular files, include metadata
  const pathInfo = path ? path : "file"
  return `✓ ${pathInfo} written (${bytes} bytes, ${lines} lines)`
}

/**
 * Create optimized read output for planning files
 */
function createOptimizedReadOutput(
  originalOutput: string,
  path: string | null,
  config: SilentToolOutputConfig
): string {
  if (!path || !isPlanningFile(path)) {
    return originalOutput // Don't modify non-planning reads
  }

  // For planning files, return minimal since PreToolUse injects full content
  const lines = countLines(originalOutput)
  return `✓ ${path} loaded (${lines} lines) - content available in <task-plan-context>`
}

/**
 * Optimize search results
 */
function createOptimizedSearchOutput(
  originalOutput: string,
  config: SilentToolOutputConfig
): string {
  const lines = originalOutput.split("\n")

  if (lines.length <= config.searchMaxLines) {
    return originalOutput
  }

  // Truncate and add summary
  const truncated = lines.slice(0, config.searchMaxLines).join("\n")
  const remaining = lines.length - config.searchMaxLines

  return `${truncated}\n\n... and ${remaining} more results (use Read to view specific files)`
}

/**
 * Create the silent tool output hook
 */
export function createSilentToolOutputHook(
  ctx: PluginInput,
  config: Partial<SilentToolOutputConfig> = {}
): Hooks {
  const fullConfig = { ...DEFAULT_CONFIG, ...config }

  return {
    "tool.execute.after": async (
      input: { tool: string; input: unknown; sessionID: string; callID: string },
      output: { title: string; output: string; metadata: unknown }
    ) => {
      const toolName = input.tool
      const path = extractPath(input.input)

      // Silent Write/Edit
      if (fullConfig.silentWrite && SILENT_WRITE_TOOLS.includes(toolName)) {
        output.output = createSilentWriteOutput(output.output, path, fullConfig)
        return
      }

      // Optimized Read for planning files
      if (fullConfig.optimizePlanningReads && SILENT_READ_TOOLS.includes(toolName)) {
        if (path && isPlanningFile(path)) {
          output.output = createOptimizedReadOutput(output.output, path, fullConfig)
          return
        }
      }

      // Optimized Search results
      if (fullConfig.optimizeSearch && OPTIMIZE_SEARCH_TOOLS.includes(toolName)) {
        output.output = createOptimizedSearchOutput(output.output, fullConfig)
        return
      }
    },
  }
}

export type { SilentToolOutputConfig }
export { DEFAULT_CONFIG as DEFAULT_SILENT_CONFIG }
