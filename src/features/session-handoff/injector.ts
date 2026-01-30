/**
 * Session Handoff Injector
 *
 * Injects relevant handoff context into new sessions.
 * Handles handoff selection and content formatting for injection.
 */

import type {
  HandoffPackage,
  SessionHandoffConfig,
  Decision,
  AntiPattern,
} from "./types"
import { findHandoffsForProject, loadHandoff } from "./storage"
import { log } from "../../shared/logger"
import { checkHandoffStaleness, formatStalenessWarning } from "./staleness"

// Re-export reference resolver for backward compatibility
export { resolveSessionReference, type ResolveSessionReferenceOptions } from "./reference-resolver"

// ============================================================================
// Injection Formatting
// ============================================================================

/**
 * Get human-readable age string
 */
function getAgeString(timestamp: number): string {
  const ageMs = Date.now() - timestamp
  const ageHours = ageMs / (1000 * 60 * 60)

  if (ageHours < 1) return "just now"
  if (ageHours < 24) return `${Math.round(ageHours)} hours ago`
  const ageDays = Math.round(ageHours / 24)
  if (ageDays === 1) return "yesterday"
  return `${ageDays} days ago`
}

/**
 * Format a decision for display
 * @param decision The decision to format
 * @param index Optional 1-based index for numbered lists (omit for bullet format)
 */
function formatDecision(decision: Decision, index?: number): string {
  const lines: string[] = []
  const prefix = index !== undefined ? `${index}.` : "-"

  lines.push(`${prefix} **${decision.what}**: ${decision.chosen}`)
  lines.push(`   - Why: ${decision.why}`)

  if (decision.rejected && decision.rejected.length > 0) {
    const rejectedList = decision.rejected
      .slice(0, 2)
      .map((r) => `${r.approach} (${r.reason})`)
      .join(", ")
    lines.push(`   - Rejected: ${rejectedList}`)
  }

  if (decision.relatedFiles && decision.relatedFiles.length > 0) {
    lines.push(`   - Related: ${decision.relatedFiles.join(", ")}`)
  }

  return lines.join("\n")
}

/**
 * Format an anti-pattern for display
 */
function formatAntiPattern(ap: AntiPattern): string {
  let line = `- ${ap.approach}: ${ap.reason}`
  if (ap.context) {
    line += ` (in ${ap.context})`
  }
  return line
}

/**
 * Format a single handoff for injection
 */
function formatHandoffForInjection(pkg: HandoffPackage, projectPath?: string): string {
  const lines: string[] = []

  const age = getAgeString(pkg.createdAt)
  lines.push(`### Session: ${pkg.id} (${age})`)
  lines.push(`**Goal**: ${pkg.metadata.originalGoal}`)
  lines.push("")

  // Add staleness warning if project path provided
  if (projectPath) {
    const staleness = checkHandoffStaleness(pkg, projectPath)
    const warning = formatStalenessWarning(staleness)
    if (warning) {
      lines.push(warning)
    }
  }

  // Decisions
  if (pkg.payload.decisions.length > 0) {
    lines.push("**Key Decisions:**")
    pkg.payload.decisions.slice(0, 5).forEach((decision, idx) => {
      lines.push(`${formatDecision(decision, idx + 1)}`)
    })
    lines.push("")
  }

  // Anti-patterns
  if (pkg.payload.antiPatterns.length > 0) {
    lines.push("**Avoid These Approaches:**")
    for (const ap of pkg.payload.antiPatterns.slice(0, 5)) {
      lines.push(formatAntiPattern(ap))
    }
    lines.push("")
  }

  // Domain knowledge
  if (pkg.payload.domainContext.length > 0) {
    lines.push("**Domain Knowledge:**")
    for (const ctx of pkg.payload.domainContext.slice(0, 5)) {
      lines.push(`- ${ctx}`)
    }
    lines.push("")
  }

  // Remaining tasks
  if (pkg.payload.remainingTasks && pkg.payload.remainingTasks.length > 0) {
    lines.push("**Remaining Tasks:**")
    for (const task of pkg.payload.remainingTasks) {
      lines.push(`- [ ] ${task}`)
    }
    lines.push("")
  }

  return lines.join("\n")
}

// ============================================================================
// Handoff Selection
// ============================================================================

/**
 * Select handoffs to inject based on project and optional prompt
 */
export function selectHandoffsForInjection(
  projectPath: string,
  config: SessionHandoffConfig,
  initialPrompt?: string
): HandoffPackage[] {
  const indexEntries = findHandoffsForProject(projectPath)

  if (indexEntries.length === 0) {
    return []
  }

  // Load full packages for top candidates
  const maxCandidates = Math.min(indexEntries.length, config.max_inject_count * 2)
  const candidates: HandoffPackage[] = []

  for (const entry of indexEntries.slice(0, maxCandidates)) {
    const pkg = loadHandoff(entry.id)
    if (pkg) {
      candidates.push(pkg)
    }
  }

  // If we have an initial prompt, try to rank by relevance
  if (initialPrompt && candidates.length > config.max_inject_count) {
    return rankByRelevance(candidates, initialPrompt, config.max_inject_count)
  }

  // Otherwise, return most recent
  return candidates.slice(0, config.max_inject_count)
}

/**
 * Simple relevance ranking based on keyword overlap
 */
function rankByRelevance(
  packages: HandoffPackage[],
  prompt: string,
  limit: number
): HandoffPackage[] {
  const promptTokens = new Set(
    prompt.toLowerCase().split(/\s+/).filter((t) => t.length > 3)
  )

  const scored = packages.map((pkg) => {
    let score = 0

    // Score based on goal match
    const goalTokens = pkg.metadata.originalGoal.toLowerCase().split(/\s+/)
    for (const token of goalTokens) {
      if (promptTokens.has(token)) score += 3
    }

    // Score based on decision content
    for (const decision of pkg.payload.decisions) {
      const decisionText = `${decision.what} ${decision.chosen}`.toLowerCase()
      for (const token of promptTokens) {
        if (decisionText.includes(token)) score += 2
      }
    }

    // Score based on file overlap
    for (const file of pkg.metadata.keyFiles) {
      const fileName = file.split("/").pop()?.toLowerCase() || ""
      for (const token of promptTokens) {
        if (fileName.includes(token)) score += 5
      }
    }

    // Recency bonus (newer is slightly better)
    const ageHours = (Date.now() - pkg.createdAt) / (1000 * 60 * 60)
    score += Math.max(0, 10 - ageHours / 24)

    return { pkg, score }
  })

  // Sort by score descending
  scored.sort((a, b) => b.score - a.score)

  return scored.slice(0, limit).map((s) => s.pkg)
}

// ============================================================================
// Main Injection
// ============================================================================

/**
 * Generate injection content for a session
 */
export function generateInjectionContent(
  projectPath: string,
  config: SessionHandoffConfig,
  initialPrompt?: string
): string | null {
  if (!config.enabled || !config.auto_inject) {
    return null
  }

  const packages = selectHandoffsForInjection(projectPath, config, initialPrompt)

  if (packages.length === 0) {
    return null
  }

  const sections = packages.map((pkg) => formatHandoffForInjection(pkg, projectPath))

  const content = `## Previous Session Context

The following context was extracted from recent sessions on this project.

${sections.join("\n---\n\n")}`

  log("[session-handoff] Generated injection content", {
    handoffCount: packages.length,
    contentLength: content.length,
  })

  return content
}
