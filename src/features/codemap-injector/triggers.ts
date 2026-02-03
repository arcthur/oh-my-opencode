/**
 * Smart Trigger Detection for Codemap Injection
 *
 * Detects query types to determine appropriate codemap injection strategy.
 */

import type { QueryType, InjectionTrigger } from "./types"
import {
  ARCHITECTURE_KEYWORDS,
  NAVIGATION_KEYWORDS,
  REFACTORING_KEYWORDS,
} from "../cartography/constants"

/**
 * Detect query type from user message
 */
export function detectQueryType(message: string): InjectionTrigger {
  const lowerMessage = message.toLowerCase()
  const triggerKeywords: string[] = []
  let queryType: QueryType = "unknown"
  let injectRootAtlas = false

  // Check architecture keywords
  for (const keyword of ARCHITECTURE_KEYWORDS) {
    if (lowerMessage.includes(keyword.toLowerCase())) {
      triggerKeywords.push(keyword)
      queryType = "architecture"
      injectRootAtlas = true
    }
  }

  // Check navigation keywords
  if (queryType === "unknown") {
    for (const keyword of NAVIGATION_KEYWORDS) {
      if (lowerMessage.includes(keyword.toLowerCase())) {
        triggerKeywords.push(keyword)
        queryType = "navigation"
      }
    }
  }

  // Check refactoring keywords
  if (queryType === "unknown") {
    for (const keyword of REFACTORING_KEYWORDS) {
      if (lowerMessage.includes(keyword.toLowerCase())) {
        triggerKeywords.push(keyword)
        queryType = "refactoring"
        injectRootAtlas = true
      }
    }
  }

  // Default to implementation if no specific type detected
  if (queryType === "unknown") {
    queryType = "implementation"
  }

  return {
    queryType,
    triggerKeywords,
    relevantDirs: [],
    injectRootAtlas,
  }
}

/**
 * Check if message is an architecture question
 */
export function isArchitectureQuery(message: string): boolean {
  const trigger = detectQueryType(message)
  return trigger.queryType === "architecture"
}

/**
 * Check if message is a navigation question
 */
export function isNavigationQuery(message: string): boolean {
  const trigger = detectQueryType(message)
  return trigger.queryType === "navigation"
}

/**
 * Check if message is a refactoring request
 */
export function isRefactoringQuery(message: string): boolean {
  const trigger = detectQueryType(message)
  return trigger.queryType === "refactoring"
}

/**
 * Extract directory hints from message
 */
export function extractDirectoryHints(message: string): string[] {
  const hints: string[] = []

  // Look for path-like patterns
  const pathMatches = message.match(/(?:\/|\.\/|src\/|lib\/)[a-zA-Z0-9_\-\/]+/g)
  if (pathMatches) {
    hints.push(...pathMatches)
  }

  // Look for file extensions indicating directory context
  const fileMatches = message.match(/\b[\w\-]+\.(ts|tsx|js|jsx|py|go|rs)\b/g)
  if (fileMatches) {
    // Extract directory from file paths if present
    for (const match of fileMatches) {
      const dirMatch = message.match(new RegExp(`([\\w\\-\\/]+)\\/${match}`))
      if (dirMatch) {
        hints.push(dirMatch[1])
      }
    }
  }

  return [...new Set(hints)]
}

/**
 * Determine injection strategy based on trigger
 */
export function getInjectionStrategy(trigger: InjectionTrigger): {
  injectWorkingDir: boolean
  injectRootAtlas: boolean
  injectRelatedDirs: boolean
  maxCodemaps: number
} {
  switch (trigger.queryType) {
    case "architecture":
      return {
        injectWorkingDir: false,
        injectRootAtlas: true,
        injectRelatedDirs: true,
        maxCodemaps: 3,
      }

    case "navigation":
      return {
        injectWorkingDir: true,
        injectRootAtlas: false,
        injectRelatedDirs: false,
        maxCodemaps: 1,
      }

    case "refactoring":
      return {
        injectWorkingDir: true,
        injectRootAtlas: true,
        injectRelatedDirs: true,
        maxCodemaps: 5,
      }

    case "implementation":
    default:
      return {
        injectWorkingDir: true,
        injectRootAtlas: false,
        injectRelatedDirs: false,
        maxCodemaps: 1,
      }
  }
}

/**
 * Check if cartography suggestion should be shown
 */
export function shouldSuggestCartography(
  hasDirectoryCodemap: boolean,
  directoryAccessCount: number,
  suggestCartography: boolean
): boolean {
  // Only suggest if enabled and this directory lacks a codemap
  if (!suggestCartography || hasDirectoryCodemap) {
    return false
  }

  // Suggest after 3+ file accesses in unmapped directory
  return directoryAccessCount >= 3
}

/**
 * Generate cartography suggestion message
 */
export function getCartographySuggestion(directory: string): string {
  return `[Tip] This directory (${directory}) has no codemap. Run \`/cartography init\` to generate architecture documentation for better context.`
}
