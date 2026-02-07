/**
 * Hash Utilities for Cartography
 *
 * Provides MD5 hashing for change detection in files and directories.
 */

import { createHash } from "node:crypto"
import { readFileSync, statSync, readdirSync } from "node:fs"
import { join, extname, sep } from "node:path"
import { CODE_EXTENSIONS } from "./constants"
import { getGlobMatcher } from "./pattern-matcher"

/**
 * Calculate MD5 hash of a string
 */
export function md5(content: string): string {
  return createHash("md5").update(content, "utf8").digest("hex")
}

/**
 * Calculate MD5 hash of a file's content
 * Returns null if file cannot be read
 */
export function hashFile(filePath: string): string | null {
  try {
    const content = readFileSync(filePath, "utf8")
    return md5(content)
  } catch {
    return null
  }
}

/**
 * Calculate composite hash for a directory
 * Based on sorted file paths and their content hashes
 */
export function hashDirectory(
  dirPath: string,
  options: {
    includePatterns?: Set<string>
    excludePatterns?: Set<string>
    maxDepth?: number
  } = {}
): string {
  const { includePatterns, excludePatterns, maxDepth = 10 } = options

  const fileHashes: string[] = []

  const normalizedIncludePatterns = includePatterns
    ? new Set([...includePatterns].map(normalizeGlob))
    : undefined
  const normalizedExcludePatterns = excludePatterns
    ? new Set([...excludePatterns].map(normalizeGlob))
    : undefined

  function collectFiles(dir: string, depth: number): void {
    if (depth > maxDepth) return

    try {
      const entries = readdirSync(dir, { withFileTypes: true })

      for (const entry of entries) {
        const fullPath = join(dir, entry.name)
        const relativePath = fullPath.substring(dirPath.length + 1)
        const normalizedRelativePath = normalizePath(relativePath)

        // Skip excluded patterns
        if (
          normalizedExcludePatterns &&
          shouldExclude(normalizedRelativePath, normalizedExcludePatterns)
        ) {
          continue
        }

        if (entry.isDirectory()) {
          // Skip common non-code directories
          if (isIgnoredDirectory(entry.name)) continue
          collectFiles(fullPath, depth + 1)
        } else if (entry.isFile()) {
          const ext = extname(entry.name)

          // Only hash code files by default, or matching include patterns
          if (normalizedIncludePatterns) {
            if (!shouldInclude(normalizedRelativePath, normalizedIncludePatterns)) continue
          } else if (!CODE_EXTENSIONS.has(ext)) {
            continue
          }

          const hash = hashFile(fullPath)
          if (hash) {
            // Include relative path in hash for determinism
            fileHashes.push(`${normalizedRelativePath}:${hash}`)
          }
        }
      }
    } catch {
      // Directory not readable, skip
    }
  }

  collectFiles(dirPath, 0)

  // Sort for deterministic ordering
  fileHashes.sort()

  // Create composite hash
  return md5(fileHashes.join("\n"))
}

/**
 * Check if a path should be excluded based on patterns
 */
function shouldExclude(path: string, patterns: Set<string>): boolean {
  for (const pattern of patterns) {
    if (matchPattern(path, pattern)) return true
  }
  return false
}

/**
 * Check if a path should be included based on patterns
 */
function shouldInclude(path: string, patterns: Set<string>): boolean {
  for (const pattern of patterns) {
    if (matchPattern(path, pattern)) return true
  }
  return false
}

/**
 * Normalize path separators for glob matching.
 */
function normalizePath(path: string): string {
  return path.split(sep).join("/")
}

function normalizeGlob(pattern: string): string {
  return pattern.split(sep).join("/")
}

function matchPattern(path: string, pattern: string): boolean {
  const normalizedPattern = normalizeGlob(pattern)
  return getGlobMatcher(normalizedPattern)(path)
}

/**
 * Check if a directory name should be ignored
 */
function isIgnoredDirectory(name: string): boolean {
  const ignoredDirs = new Set([
    "node_modules",
    ".git",
    ".svn",
    ".hg",
    "dist",
    "build",
    ".next",
    ".nuxt",
    ".venv",
    "venv",
    "__pycache__",
    ".pytest_cache",
    "target",
    ".cargo",
    "coverage",
    ".nyc_output",
    ".turbo",
    ".cache",
  ])
  return ignoredDirs.has(name) || name.startsWith(".")
}

/**
 * Calculate file modification time hash
 * Useful for quick staleness checks without reading file content
 */
export function hashFileStats(filePath: string): string | null {
  try {
    const stats = statSync(filePath)
    return md5(`${stats.mtime.getTime()}:${stats.size}`)
  } catch {
    return null
  }
}

/**
 * Compare two sets of file hashes and return changes
 */
export function compareHashes(
  oldHashes: Record<string, string>,
  newHashes: Record<string, string>
): {
  added: string[]
  modified: string[]
  deleted: string[]
} {
  const added: string[] = []
  const modified: string[] = []
  const deleted: string[] = []

  // Check for added and modified
  for (const [path, newHash] of Object.entries(newHashes)) {
    if (!(path in oldHashes)) {
      added.push(path)
    } else if (oldHashes[path] !== newHash) {
      modified.push(path)
    }
  }

  // Check for deleted
  for (const path of Object.keys(oldHashes)) {
    if (!(path in newHashes)) {
      deleted.push(path)
    }
  }

  return { added, modified, deleted }
}

/**
 * Calculate hash change ratio
 * Returns percentage of files that changed (0-1)
 */
export function calculateChangeRatio(
  oldHashes: Record<string, string>,
  newHashes: Record<string, string>
): number {
  const { added, modified, deleted } = compareHashes(oldHashes, newHashes)
  const totalChanges = added.length + modified.length + deleted.length
  const totalFiles = Math.max(
    Object.keys(oldHashes).length,
    Object.keys(newHashes).length
  )

  if (totalFiles === 0) return 0
  return totalChanges / totalFiles
}
