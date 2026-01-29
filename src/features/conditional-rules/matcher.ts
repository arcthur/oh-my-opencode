/**
 * Rule Matcher Engine
 *
 * Matches conditional rules against the current working context.
 * All conditions in a rule must match for the rule to be selected (AND logic).
 */

import { readFileSync } from "node:fs"
import { join, dirname } from "node:path"
import picomatch from "picomatch"
import type {
  ConditionalRule,
  RuleCondition,
  RuleMatchContext,
  MatchedRule,
  ConditionMatchResult,
  GlobCondition,
  DirectoryCondition,
  ContentCondition,
  ContextCondition,
} from "./types"

// ============================================================================
// Rule Matcher
// ============================================================================

/**
 * Rule matching engine
 */
export class RuleMatcher {
  private rules: ConditionalRule[]
  private globMatcherCache = new Map<string, (path: string) => boolean>()
  private regexCache = new Map<string, RegExp>()

  constructor(rules: ConditionalRule[]) {
    // Sort by priority (descending - higher priority first)
    this.rules = [...rules].sort((a, b) => b.priority - a.priority)
  }

  /**
   * Find all rules matching the current context
   */
  match(context: RuleMatchContext): MatchedRule[] {
    const results: MatchedRule[] = []

    for (const rule of this.rules) {
      if (!rule.enabled) continue

      const matchResult = this.matchRule(rule, context)
      if (matchResult) {
        results.push(matchResult)
      }
    }

    return results
  }

  /**
   * Match a single rule against context
   */
  private matchRule(rule: ConditionalRule, context: RuleMatchContext): MatchedRule | null {
    // ALL conditions must match (AND logic)
    const matchedConditions: RuleCondition[] = []
    const matchedFiles = new Set<string>()

    for (const condition of rule.conditions) {
      const result = this.matchCondition(condition, context)

      if (!result.matched) {
        return null // Early exit on first non-match
      }

      matchedConditions.push(condition)
      result.files?.forEach((f) => matchedFiles.add(f))
    }

    return {
      rule,
      matchedConditions,
      matchedFiles: Array.from(matchedFiles),
    }
  }

  /**
   * Match a single condition against context
   */
  private matchCondition(condition: RuleCondition, context: RuleMatchContext): ConditionMatchResult {
    switch (condition.type) {
      case "glob":
        return this.matchGlob(condition, context)
      case "directory":
        return this.matchDirectory(condition, context)
      case "content":
        return this.matchContent(condition, context)
      case "context":
        return this.matchContext(condition, context)
      default:
        return { matched: false }
    }
  }

  /**
   * Match glob pattern condition
   */
  private matchGlob(condition: GlobCondition, context: RuleMatchContext): ConditionMatchResult {
    if (context.files.length === 0) {
      return { matched: false }
    }

    const matcher = this.getGlobMatcher(condition.pattern)
    const matchedFiles = context.files.filter((f) => matcher(normalizeSlashes(f)))

    // matchAny (default: true) - any file matches
    // matchAny: false - all files must match
    const matchAny = condition.matchAny !== false
    const matched = matchAny ? matchedFiles.length > 0 : matchedFiles.length === context.files.length

    return { matched, files: matchedFiles }
  }

  /**
   * Match directory condition
   */
  private matchDirectory(condition: DirectoryCondition, context: RuleMatchContext): ConditionMatchResult {
    if (context.files.length === 0) {
      return { matched: false }
    }

    const dirPath = normalizeSlashes(condition.path).replace(/\/$/, "")
    const recursive = condition.recursive !== false

    const matchedFiles = context.files.filter((f) => {
      const normalizedFile = normalizeSlashes(f)
      const fileDir = dirname(normalizedFile)

      if (recursive) {
        // File is in directory or any subdirectory
        return normalizedFile.startsWith(dirPath + "/") || fileDir === dirPath || normalizedFile === dirPath
      }
      // File is directly in directory (not in subdirectory)
      return fileDir === dirPath
    })

    return { matched: matchedFiles.length > 0, files: matchedFiles }
  }

  /**
   * Match content pattern condition
   */
  private matchContent(condition: ContentCondition, context: RuleMatchContext): ConditionMatchResult {
    // Content matching only works on files in the current context
    // (relevantFilesOnly is always effectively true since we don't have a broader file list)
    if (context.files.length === 0) {
      return { matched: false }
    }

    const regex = this.getRegex(condition.pattern)
    const matchedFiles: string[] = []

    for (const file of context.files) {
      try {
        const fullPath = join(context.cwd, file)
        const content = readFileSync(fullPath, "utf-8")
        if (regex.test(content)) {
          matchedFiles.push(file)
        }
      } catch {
        // File doesn't exist or can't be read - skip
      }
    }

    return { matched: matchedFiles.length > 0, files: matchedFiles }
  }

  /**
   * Match context condition
   */
  private matchContext(condition: ContextCondition, context: RuleMatchContext): ConditionMatchResult {
    const { match } = condition

    if ("agent" in match) {
      return { matched: context.agent === match.agent }
    }

    if ("category" in match) {
      return { matched: context.category === match.category }
    }

    if ("task" in match) {
      return { matched: context.taskPhase === match.task }
    }

    if ("skill" in match) {
      return { matched: context.skill === match.skill }
    }

    return { matched: false }
  }

  /**
   * Get cached glob matcher
   */
  private getGlobMatcher(pattern: string): (path: string) => boolean {
    if (!this.globMatcherCache.has(pattern)) {
      // Create matcher with common options
      const matcher = picomatch(pattern, {
        dot: true,
        nocase: process.platform === "win32",
      })
      this.globMatcherCache.set(pattern, matcher)
    }
    return this.globMatcherCache.get(pattern)!
  }

  /**
   * Get cached regex
   */
  private getRegex(pattern: string): RegExp {
    if (!this.regexCache.has(pattern)) {
      try {
        this.regexCache.set(pattern, new RegExp(pattern))
      } catch {
        // Invalid regex, create one that never matches
        this.regexCache.set(pattern, /(?!.)/)
      }
    }
    return this.regexCache.get(pattern)!
  }

  /**
   * Get all loaded rules
   */
  getRules(): ConditionalRule[] {
    return this.rules
  }

  /**
   * Get count of enabled rules
   */
  getEnabledCount(): number {
    return this.rules.filter((r) => r.enabled).length
  }
}

// ============================================================================
// Utilities
// ============================================================================

/**
 * Normalize path slashes to forward slashes
 */
function normalizeSlashes(path: string): string {
  return path.replace(/\\/g, "/")
}

/**
 * Format matched rules for injection
 */
export function formatRulesForInjection(matched: MatchedRule[]): string {
  if (matched.length === 0) return ""

  // Build conflict resolution hints when multiple rules match
  const conflictHints = matched.length > 1 ? buildConflictHints(matched) : ""

  const sections = matched.map((m, i) => {
    const filesInfo = m.matchedFiles.length > 0 ? `*Applies to: ${m.matchedFiles.join(", ")}*` : ""

    const sourceName = getRuleSourceName(m.rule)
    const priorityInfo = matched.length > 1 ? ` [priority: ${m.rule.priority}]` : ""

    return `### ${m.rule.name}${sourceName ? ` (${sourceName})` : ""}${priorityInfo}
${filesInfo}

${m.rule.content}`
  })

  return `## Applicable Rules

The following rules apply to your current context:
${conflictHints}
${sections.join("\n\n---\n\n")}

---`
}

/**
 * Build conflict resolution hints when multiple rules match
 */
function buildConflictHints(matched: MatchedRule[]): string {
  const hints: string[] = []

  // Check for priority differences
  const priorities = new Set(matched.map((m) => m.rule.priority))
  if (priorities.size > 1) {
    const highest = matched[0] // Already sorted by priority (descending)
    hints.push(
      `*Priority hint: "${highest.rule.name}" has highest priority (${highest.rule.priority}). When rules conflict, prefer higher-priority rules. Deeper directories have higher priority for specificity.*`
    )
  }

  // General conflict guidance
  if (hints.length > 0) {
    hints.unshift("*Multiple rules matched. Conflict resolution guidance:*")
  }

  return hints.length > 0 ? `\n${hints.join("\n")}\n` : ""
}

/**
 * Format matched rules for delegation
 */
export function formatRulesForDelegation(matched: MatchedRule[]): string {
  if (matched.length === 0) return ""

  const rules = matched.map((m) => `**${m.rule.name}:**\n${m.rule.content}`).join("\n\n")

  return rules
}

/**
 * Get human-readable source name for a rule
 */
function getRuleSourceName(rule: ConditionalRule): string {
  if (rule.source.type === "agents-md") {
    return `from ${getRelativePath(rule.source.path)}`
  }
  if (rule.source.type === "config") {
    return "from config"
  }
  return ""
}

/**
 * Get relative path for display
 */
function getRelativePath(fullPath: string): string {
  const parts = fullPath.split(/[/\\]/)
  // Return last 2-3 parts for readability
  const relevant = parts.slice(-3)
  return relevant.join("/")
}
