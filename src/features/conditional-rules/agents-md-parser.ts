/**
 * AGENTS.md Parser
 *
 * Parses AGENTS.md files with conditional include directives.
 *
 * Supported syntax:
 * ```markdown
 * # Global Rules
 * These apply to all files in this directory.
 *
 * <!-- include: **\/*.tsx -->
 * ## React Rules
 * These only apply to .tsx files.
 * <!-- /include -->
 * ```
 */

import { readFileSync } from "node:fs"
import { readdir, stat } from "node:fs/promises"
import { join, relative, dirname } from "node:path"
import type { ParsedAgentsMd, ConditionalBlock, AgentsMdConfig } from "./types"
import { DEFAULT_AGENTS_MD_CONFIG } from "./types"

// ============================================================================
// Parsing
// ============================================================================

/**
 * Parse an AGENTS.md file into structured data
 */
export function parseAgentsMd(content: string, filePath: string, projectRoot: string): ParsedAgentsMd {
  const lines = content.split("\n")
  const result: ParsedAgentsMd = {
    globalRules: "",
    conditionalBlocks: [],
    sourcePath: filePath,
    depth: calculateDepth(filePath, projectRoot),
  }

  let currentBlock: ConditionalBlock | null = null
  const globalLines: string[] = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    // Check for include start: <!-- include: pattern -->
    const includeMatch = line.match(/<!--\s*include:\s*(.+?)\s*-->/)
    if (includeMatch) {
      // Save any accumulated global content before entering block
      if (currentBlock === null && globalLines.length > 0) {
        // Don't clear global lines, they accumulate
      }

      currentBlock = {
        pattern: includeMatch[1].trim(),
        content: "",
        lineStart: i + 1,
        lineEnd: -1,
      }
      continue
    }

    // Check for include end: <!-- /include -->
    if (line.match(/<!--\s*\/include\s*-->/)) {
      if (currentBlock) {
        currentBlock.lineEnd = i
        // Trim trailing whitespace from content
        currentBlock.content = currentBlock.content.trimEnd()
        if (currentBlock.content) {
          result.conditionalBlocks.push(currentBlock)
        }
        currentBlock = null
      }
      continue
    }

    // Accumulate content
    if (currentBlock) {
      currentBlock.content += line + "\n"
    } else {
      globalLines.push(line)
    }
  }

  // Handle unclosed block (treat rest as conditional content)
  if (currentBlock) {
    currentBlock.lineEnd = lines.length - 1
    currentBlock.content = currentBlock.content.trimEnd()
    if (currentBlock.content) {
      result.conditionalBlocks.push(currentBlock)
    }
  }

  // Process global rules
  result.globalRules = globalLines.join("\n").trim()

  return result
}

/**
 * Calculate directory depth relative to project root
 */
function calculateDepth(filePath: string, projectRoot: string): number {
  const rel = relative(projectRoot, dirname(filePath))
  if (!rel || rel === ".") return 0
  return rel.split(/[/\\]/).filter(Boolean).length
}

// ============================================================================
// Discovery
// ============================================================================

/**
 * Discover all AGENTS.md files in project tree
 */
export async function discoverAgentsMdFiles(
  projectRoot: string,
  config: AgentsMdConfig = DEFAULT_AGENTS_MD_CONFIG
): Promise<ParsedAgentsMd[]> {
  if (!config.enabled) return []

  const results: ParsedAgentsMd[] = []
  const maxDepth = config.max_depth ?? 10
  const fileNames = new Set((config.file_names ?? DEFAULT_AGENTS_MD_CONFIG.file_names).map((n) => n.toLowerCase()))

  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > maxDepth) return

    let entries: string[]
    try {
      entries = await readdir(dir)
    } catch {
      return
    }

    for (const entry of entries) {
      // Check ignore patterns
      if (shouldIgnore(entry, config.ignore)) continue

      const fullPath = join(dir, entry)

      let stats
      try {
        stats = await stat(fullPath)
      } catch {
        continue
      }

      if (stats.isDirectory()) {
        await walk(fullPath, depth + 1)
      } else if (fileNames.has(entry.toLowerCase())) {
        try {
          const content = readFileSync(fullPath, "utf-8")
          const parsed = parseAgentsMd(content, fullPath, projectRoot)
          results.push(parsed)
        } catch {
          // Skip unreadable files
        }
      }
    }
  }

  await walk(projectRoot, 0)

  // Sort by depth (deeper directories first for cascading priority)
  results.sort((a, b) => b.depth - a.depth)

  return results
}

/**
 * Check if path should be ignored
 */
function shouldIgnore(name: string, ignorePatterns: string[]): boolean {
  const effectiveIgnore = ignorePatterns ?? DEFAULT_AGENTS_MD_CONFIG.ignore

  // Direct name match
  if (effectiveIgnore.includes(name)) return true

  // Hidden directories/files
  if (name.startsWith(".") && name !== ".opencode") return true

  return false
}

// ============================================================================
// Utilities
// ============================================================================

/**
 * Get the directory path for an AGENTS.md file (relative to project root)
 */
export function getAgentsMdDirectory(parsed: ParsedAgentsMd, projectRoot: string): string {
  const dir = dirname(parsed.sourcePath)
  const rel = relative(projectRoot, dir)
  return rel || "."
}

/**
 * Read and parse a single AGENTS.md file
 */
export function readAgentsMd(filePath: string, projectRoot: string): ParsedAgentsMd | null {
  try {
    const content = readFileSync(filePath, "utf-8")
    return parseAgentsMd(content, filePath, projectRoot)
  } catch {
    return null
  }
}
