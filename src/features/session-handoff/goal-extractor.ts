/**
 * Goal-Oriented Payload Extractor
 *
 * Filters handoff payload based on goal relevance.
 * Used by active handoff to transfer only goal-relevant context.
 */

import type { HandoffPayload, Decision, Artifact, AntiPattern } from "./types"

// ============================================================================
// Types
// ============================================================================

export interface GoalFilterOptions {
  /** The goal to filter by */
  goal: string

  /** Minimum relevance score (0-1) to include an item */
  minRelevance?: number

  /** Maximum decisions to include */
  maxDecisions?: number

  /** Maximum artifacts to include */
  maxArtifacts?: number

  /** Maximum domain context items to include */
  maxDomainContext?: number
}

export interface FilteredPayload {
  payload: HandoffPayload
  stats: {
    decisionsKept: number
    decisionsFiltered: number
    artifactsKept: number
    artifactsFiltered: number
    antiPatternsKept: number
    domainContextKept: number
    domainContextFiltered: number
  }
}

// ============================================================================
// Keyword Extraction
// ============================================================================

/**
 * Extract meaningful keywords from goal text
 */
function extractKeywords(text: string): Set<string> {
  // Common stop words to filter out
  const stopWords = new Set([
    "the", "a", "an", "and", "or", "but", "in", "on", "at", "to", "for",
    "of", "with", "by", "from", "as", "is", "was", "are", "were", "been",
    "be", "have", "has", "had", "do", "does", "did", "will", "would", "could",
    "should", "may", "might", "must", "shall", "can", "this", "that", "these",
    "those", "i", "you", "he", "she", "it", "we", "they", "what", "which",
    "who", "when", "where", "why", "how", "all", "each", "every", "both",
    "few", "more", "most", "other", "some", "such", "no", "not", "only",
    "same", "so", "than", "too", "very", "just", "also", "now", "here",
    "there", "then", "if", "else", "check", "execute", "implement", "build",
    "create", "add", "make", "fix", "update", "change", "modify", "get",
    "set", "run", "use", "find", "look", "see", "try", "want", "need",
  ])

  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s-_]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !stopWords.has(w))

  return new Set(words)
}

/**
 * Extract file-related keywords (extensions, directories, etc.)
 */
function extractFileKeywords(text: string): Set<string> {
  const patterns = [
    // File extensions
    /\.(ts|tsx|js|jsx|py|go|rs|java|cpp|c|h|css|scss|html|json|yaml|yml|md|sql)/gi,
    // Common directory names
    /\b(src|lib|test|tests|spec|specs|components|pages|api|utils|hooks|services|models|types)\b/gi,
    // File name patterns
    /\b([a-z][a-z0-9]*[-_][a-z][a-z0-9]*)\b/gi,
  ]

  const keywords = new Set<string>()
  for (const pattern of patterns) {
    const matches = text.match(pattern)
    if (matches) {
      for (const match of matches) {
        keywords.add(match.toLowerCase().replace(/^\./, ""))
      }
    }
  }

  return keywords
}

// ============================================================================
// Scoring
// ============================================================================

/**
 * Score a decision's relevance to the goal
 */
function scoreDecision(decision: Decision, goalKeywords: Set<string>, fileKeywords: Set<string>): number {
  let score = 0
  const decisionText = `${decision.what} ${decision.chosen} ${decision.why}`.toLowerCase()
  const decisionKeywords = extractKeywords(decisionText)

  // Keyword overlap
  for (const keyword of goalKeywords) {
    if (decisionText.includes(keyword)) {
      score += 2
    }
    if (decisionKeywords.has(keyword)) {
      score += 1
    }
  }

  // File keyword overlap
  for (const keyword of fileKeywords) {
    if (decisionText.includes(keyword)) {
      score += 3
    }
  }

  // Related files overlap
  if (decision.relatedFiles) {
    for (const file of decision.relatedFiles) {
      const fileLower = file.toLowerCase()
      for (const keyword of fileKeywords) {
        if (fileLower.includes(keyword)) {
          score += 2
        }
      }
      for (const keyword of goalKeywords) {
        if (fileLower.includes(keyword)) {
          score += 1
        }
      }
    }
  }

  // Architecture decisions get a bonus (more likely to be broadly relevant)
  if (decision.category === "architecture") {
    score += 2
  }

  return score
}

/**
 * Score an artifact's relevance to the goal
 */
function scoreArtifact(artifact: Artifact, goalKeywords: Set<string>, fileKeywords: Set<string>): number {
  let score = 0
  const pathLower = artifact.path.toLowerCase()
  const summaryLower = artifact.summary.toLowerCase()

  // File path matches
  for (const keyword of fileKeywords) {
    if (pathLower.includes(keyword)) {
      score += 3
    }
  }

  for (const keyword of goalKeywords) {
    if (pathLower.includes(keyword)) {
      score += 2
    }
    if (summaryLower.includes(keyword)) {
      score += 1
    }
  }

  // Created files are more likely to be relevant to recent goals
  if (artifact.changeType === "created") {
    score += 1
  }

  return score
}

/**
 * Score domain context relevance to the goal
 */
function scoreDomainContext(context: string, goalKeywords: Set<string>, fileKeywords: Set<string>): number {
  let score = 0
  const contextLower = context.toLowerCase()

  for (const keyword of goalKeywords) {
    if (contextLower.includes(keyword)) {
      score += 2
    }
  }

  for (const keyword of fileKeywords) {
    if (contextLower.includes(keyword)) {
      score += 1
    }
  }

  return score
}

// ============================================================================
// Main Filter Function
// ============================================================================

/**
 * Filter handoff payload based on goal relevance.
 *
 * IMPORTANT: Anti-patterns are ALWAYS preserved in full.
 * Failed approaches are universally valuable regardless of goal.
 */
export function filterPayloadByGoal(
  payload: HandoffPayload,
  options: GoalFilterOptions
): FilteredPayload {
  const {
    goal,
    minRelevance = 0.1,
    maxDecisions = 10,
    maxArtifacts = 15,
    maxDomainContext = 8,
  } = options

  const goalKeywords = extractKeywords(goal)
  const fileKeywords = extractFileKeywords(goal)

  // Score and filter decisions
  const scoredDecisions = payload.decisions.map((d) => ({
    item: d,
    score: scoreDecision(d, goalKeywords, fileKeywords),
  }))

  // Normalize scores
  const maxDecisionScore = Math.max(...scoredDecisions.map((s) => s.score), 1)
  const normalizedDecisions = scoredDecisions.map((s) => ({
    ...s,
    normalizedScore: s.score / maxDecisionScore,
  }))

  const filteredDecisions = normalizedDecisions
    .filter((s) => s.normalizedScore >= minRelevance)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxDecisions)
    .map((s) => s.item)

  // Score and filter artifacts
  const scoredArtifacts = payload.artifacts.map((a) => ({
    item: a,
    score: scoreArtifact(a, goalKeywords, fileKeywords),
  }))

  const maxArtifactScore = Math.max(...scoredArtifacts.map((s) => s.score), 1)
  const normalizedArtifacts = scoredArtifacts.map((s) => ({
    ...s,
    normalizedScore: s.score / maxArtifactScore,
  }))

  const filteredArtifacts = normalizedArtifacts
    .filter((s) => s.normalizedScore >= minRelevance)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxArtifacts)
    .map((s) => s.item)

  // Score and filter domain context
  const scoredContext = payload.domainContext.map((c) => ({
    item: c,
    score: scoreDomainContext(c, goalKeywords, fileKeywords),
  }))

  const maxContextScore = Math.max(...scoredContext.map((s) => s.score), 1)
  const normalizedContext = scoredContext.map((s) => ({
    ...s,
    normalizedScore: s.score / maxContextScore,
  }))

  const filteredContext = normalizedContext
    .filter((s) => s.normalizedScore >= minRelevance)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxDomainContext)
    .map((s) => s.item)

  // Anti-patterns: ALWAYS keep all (failure experience is universally valuable)
  const allAntiPatterns = payload.antiPatterns

  return {
    payload: {
      decisions: filteredDecisions,
      artifacts: filteredArtifacts,
      antiPatterns: allAntiPatterns,
      domainContext: filteredContext,
      remainingTasks: payload.remainingTasks,
    },
    stats: {
      decisionsKept: filteredDecisions.length,
      decisionsFiltered: payload.decisions.length - filteredDecisions.length,
      artifactsKept: filteredArtifacts.length,
      artifactsFiltered: payload.artifacts.length - filteredArtifacts.length,
      antiPatternsKept: allAntiPatterns.length,
      domainContextKept: filteredContext.length,
      domainContextFiltered: payload.domainContext.length - filteredContext.length,
    },
  }
}
