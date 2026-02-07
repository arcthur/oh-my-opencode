/**
 * Pattern Matcher for Cartography
 *
 * Provides glob pattern matching for file filtering.
 */

import picomatch from "picomatch"
import { extname, relative, sep } from "node:path"
import { CODE_EXTENSIONS } from "./constants"

/**
 * Options for pattern matching
 */
export interface MatchOptions {
  /** Patterns to include (if any match, file is included) */
  includePatterns?: string[]

  /** Patterns to exclude (if any match, file is excluded) */
  excludePatterns?: string[]

  /** Only match code files */
  codeFilesOnly?: boolean
}

/**
 * Check if a file path matches the given patterns
 */
export function matchesPatterns(
  filePath: string,
  projectRoot: string,
  options: MatchOptions = {}
): boolean {
  const { includePatterns = [], excludePatterns = [], codeFilesOnly = true } = options

  // Normalize path to use forward slashes for matching
  const relativePath = normalizePathForMatching(relative(projectRoot, filePath))

  // Check exclusions first
  for (const pattern of excludePatterns) {
    if (matchGlob(relativePath, pattern)) {
      return false
    }
  }

  // If code files only, check extension
  if (codeFilesOnly) {
    const ext = extname(filePath)
    if (!CODE_EXTENSIONS.has(ext)) {
      return false
    }
  }

  // If no include patterns, accept all (that passed exclusions)
  if (includePatterns.length === 0) {
    return true
  }

  // Check if any include pattern matches
  for (const pattern of includePatterns) {
    if (matchGlob(relativePath, pattern)) {
      return true
    }
  }

  return false
}

/**
 * Normalize path separators for glob matching
 */
function normalizePathForMatching(path: string): string {
  return path.split(sep).join("/")
}

const globMatcherCache = new Map<string, (path: string) => boolean>()

export function getGlobMatcher(pattern: string): (path: string) => boolean {
  const normalizedPattern = normalizePathForMatching(pattern)
  const cached = globMatcherCache.get(normalizedPattern)
  if (cached) return cached

  const matcher = picomatch(normalizedPattern, {
    dot: true,
    matchBase: !normalizedPattern.includes("/"),
  })
  globMatcherCache.set(normalizedPattern, matcher)
  return matcher
}

/**
 * Match a path against a glob pattern
 */
function matchGlob(path: string, pattern: string): boolean {
  return getGlobMatcher(pattern)(path)
}

/**
 * Filter an array of file paths based on patterns
 */
export function filterPaths(
  paths: string[],
  projectRoot: string,
  options: MatchOptions = {}
): string[] {
  return paths.filter((p) => matchesPatterns(p, projectRoot, options))
}

/**
 * Check if a directory should be traversed based on patterns
 * Returns false if the directory matches an exclusion pattern
 */
export function shouldTraverseDirectory(
  dirPath: string,
  projectRoot: string,
  excludePatterns: string[] = []
): boolean {
  const relativePath = normalizePathForMatching(relative(projectRoot, dirPath))

  // Add trailing slash for directory matching
  const dirPathWithSlash = relativePath.endsWith("/")
    ? relativePath
    : `${relativePath}/`

  for (const pattern of excludePatterns) {
    // Check both with and without trailing slash
    if (matchGlob(relativePath, pattern) || matchGlob(dirPathWithSlash, pattern)) {
      return false
    }

    // Also check if the pattern targets this directory specifically
    // e.g., pattern "node_modules/**" should match "node_modules" directory
    if (pattern.endsWith("/**")) {
      const dirPattern = pattern.slice(0, -3)
      if (relativePath === dirPattern || relativePath.startsWith(`${dirPattern}/`)) {
        return false
      }
    }
  }

  return true
}

/**
 * Get the depth of a path relative to a root
 */
export function getPathDepth(filePath: string, projectRoot: string): number {
  const relativePath = relative(projectRoot, filePath)
  if (!relativePath) return 0
  return relativePath.split(sep).length
}

/**
 * Check if a path is within a given depth from root
 */
export function isWithinDepth(
  filePath: string,
  projectRoot: string,
  maxDepth: number
): boolean {
  return getPathDepth(filePath, projectRoot) <= maxDepth
}

/**
 * Parse a glob pattern and extract its components
 */
export function parseGlobPattern(pattern: string): {
  isNegated: boolean
  hasGlobstar: boolean
  extension: string | null
  directory: string | null
} {
  const isNegated = pattern.startsWith("!")
  const normalizedPattern = isNegated ? pattern.slice(1) : pattern
  const hasGlobstar = normalizedPattern.includes("**")

  // Extract extension if pattern ends with *.ext
  let extension: string | null = null
  const extMatch = normalizedPattern.match(/\*(\.[a-z]+)$/i)
  if (extMatch) {
    extension = extMatch[1]
  }

  // Extract directory if pattern starts with specific path
  let directory: string | null = null
  const firstSlash = normalizedPattern.indexOf("/")
  if (firstSlash > 0 && !normalizedPattern.startsWith("*")) {
    directory = normalizedPattern.slice(0, firstSlash)
  }

  return { isNegated, hasGlobstar, extension, directory }
}

/**
 * Merge multiple pattern sets, handling negations
 */
export function mergePatterns(
  ...patternSets: (string[] | undefined)[]
): {
  include: string[]
  exclude: string[]
} {
  const include: string[] = []
  const exclude: string[] = []

  for (const patterns of patternSets) {
    if (!patterns) continue

    for (const pattern of patterns) {
      if (pattern.startsWith("!")) {
        exclude.push(pattern.slice(1))
      } else {
        include.push(pattern)
      }
    }
  }

  // Deduplicate
  return {
    include: [...new Set(include)],
    exclude: [...new Set(exclude)],
  }
}

/**
 * Create a pattern matcher function from options
 */
export function createMatcher(
  projectRoot: string,
  options: MatchOptions = {}
): (filePath: string) => boolean {
  return (filePath: string) => matchesPatterns(filePath, projectRoot, options)
}
