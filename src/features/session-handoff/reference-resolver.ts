/**
 * Session Reference Resolver
 *
 * Resolves @session:id references to handoff content.
 * Supports section-based and semantic (embedding-based) queries.
 */

import type {
  HandoffPackage,
  Decision,
  AntiPattern,
  EmbeddingIndexEntry,
} from "./types"
import {
  loadHandoff,
  getRecentSessionHandoffs,
  findHandoffsForProject,
  loadEmbeddings,
  saveEmbeddings,
  saveHandoff,
} from "./storage"
import { buildEmbeddingIndexEntries, cosineSimilarity, generateEmbeddingVectors } from "./embeddings"
import { checkHandoffStaleness, formatStalenessWarning } from "./staleness"
import { log } from "../../shared/logger"

// ============================================================================
// Types
// ============================================================================

export interface ResolveSessionReferenceOptions {
  embeddings?: {
    embed: (texts: string[]) => Promise<number[][]>
    maxResults?: number
    minRelevance?: number
    /** Generate and persist embeddings when missing (default: true) */
    generateIfMissing?: boolean
  }
}

// ============================================================================
// Safety Validation
// ============================================================================

function isSafeHandoffId(id: string): boolean {
  if (!id || typeof id !== "string") return false
  if (!id.startsWith("ho_")) return false
  if (id.includes("\0")) return false
  if (id.includes("/") || id.includes("\\")) return false
  if (id.includes("..")) return false
  return true
}

// ============================================================================
// Formatting Utilities
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
 * Format a handoff for display (used when returning full handoff)
 */
function formatHandoffForReference(pkg: HandoffPackage, projectPath: string): string {
  const lines: string[] = []

  const age = getAgeString(pkg.createdAt)
  lines.push(`### Session: ${pkg.id} (${age})`)
  lines.push(`**Goal**: ${pkg.metadata.originalGoal}`)
  lines.push("")

  // Add staleness warning
  const staleness = checkHandoffStaleness(pkg, projectPath)
  const warning = formatStalenessWarning(staleness)
  if (warning) {
    lines.push(warning)
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
// Section Formatting
// ============================================================================

/**
 * Format a specific section of the handoff
 */
function formatSection(pkg: HandoffPackage, section: string): string {
  switch (section) {
    case "decisions":
      if (pkg.payload.decisions.length === 0) return "No decisions recorded."
      return pkg.payload.decisions.map((d, i) => formatDecision(d, i + 1)).join("\n\n")

    case "artifacts":
      if (pkg.payload.artifacts.length === 0) return "No artifacts recorded."
      return pkg.payload.artifacts
        .map((a) => `- ${a.path} (${a.changeType}): ${a.summary}`)
        .join("\n")

    case "antiPatterns":
      if (pkg.payload.antiPatterns.length === 0) return "No anti-patterns recorded."
      return pkg.payload.antiPatterns.map(formatAntiPattern).join("\n")

    case "context":
      if (pkg.payload.domainContext.length === 0) return "No domain context recorded."
      return pkg.payload.domainContext.map((c) => `- ${c}`).join("\n")

    default:
      return `Unknown section: ${section}`
  }
}

// ============================================================================
// Semantic Search
// ============================================================================

/**
 * Format content matching a semantic query
 */
async function formatSemanticMatch(
  pkg: HandoffPackage,
  query: string,
  options?: ResolveSessionReferenceOptions
): Promise<string> {
  const embedder = options?.embeddings

  if (embedder?.embed) {
    const maxResults = embedder.maxResults ?? 5
    const minRelevance = embedder.minRelevance ?? 0.3
    const generateIfMissing = embedder.generateIfMissing !== false

    const embeddingIndex = await getOrCreateEmbeddingIndex(pkg, embedder.embed, generateIfMissing)
    let vectors = embeddingIndex ? await getEmbeddingVectors(pkg, embeddingIndex) : null

    // If index exists but vectors are missing, optionally regenerate vectors from the stored index.
    if (embeddingIndex && !vectors && generateIfMissing) {
      try {
        const regenerated = await generateEmbeddingVectors(embeddingIndex, embedder.embed)
        saveEmbeddings(pkg.id, regenerated)
        vectors = regenerated

        // Persist normalized index (ids + vectorIndex) for future queries
        pkg.embeddingIndex = embeddingIndex
        saveHandoff(pkg)
      } catch (error) {
        log("[session-handoff] failed to regenerate embeddings from index", {
          id: pkg.id,
          error: String(error),
        })
      }
    }

    if (embeddingIndex && vectors && vectors.length === embeddingIndex.length) {
      const queryVector = await embedder.embed([query])
      const qv = queryVector[0]

      if (Array.isArray(qv) && qv.length > 0) {
        const scored = embeddingIndex.map((entry) => {
          const idx = entry.vectorIndex ?? embeddingIndex.indexOf(entry)
          const vector = vectors[idx]
          return {
            entry,
            score: vector ? cosineSimilarity(qv, vector) : 0,
          }
        })

        const relevant = scored
          .filter((s) => s.score >= minRelevance)
          .sort((a, b) => b.score - a.score)
          .slice(0, maxResults)

        if (relevant.length > 0) {
          return formatSemanticResults(query, relevant)
        }
      }
    }
  }

  // Fallback: simple substring search (no embeddings)
  return fallbackSubstringSearch(pkg, query)
}

/**
 * Fallback substring search when embeddings are not available
 */
function fallbackSubstringSearch(pkg: HandoffPackage, query: string): string {
  const queryLower = query.toLowerCase()
  const results: string[] = []

  for (const decision of pkg.payload.decisions) {
    const text = `${decision.what} ${decision.chosen} ${decision.why}`.toLowerCase()
    if (text.includes(queryLower)) {
      results.push(`**Decision**: ${formatDecision(decision)}`)
    }
  }

  for (const artifact of pkg.payload.artifacts) {
    const text = `${artifact.path} ${artifact.summary}`.toLowerCase()
    if (text.includes(queryLower)) {
      results.push(`**Artifact**: ${artifact.path} - ${artifact.summary}`)
    }
  }

  for (const ap of pkg.payload.antiPatterns) {
    const text = `${ap.approach} ${ap.reason}`.toLowerCase()
    if (text.includes(queryLower)) {
      results.push(`**Avoid**: ${formatAntiPattern(ap)}`)
    }
  }

  for (const ctx of pkg.payload.domainContext) {
    if (ctx.toLowerCase().includes(queryLower)) {
      results.push(`**Context**: ${ctx}`)
    }
  }

  if (results.length === 0) {
    return `No content matching "${query}" found in this session.`
  }

  return results.join("\n\n")
}

async function getOrCreateEmbeddingIndex(
  pkg: HandoffPackage,
  embed: (texts: string[]) => Promise<number[][]>,
  generateIfMissing: boolean
): Promise<EmbeddingIndexEntry[] | null> {
  const existingRaw =
    pkg.embeddingIndex?.filter((e) => e && typeof e.content === "string" && e.content.trim().length > 0) ?? []

  const existing = normalizeEmbeddingIndex(pkg.id, existingRaw)
  if (existing.length > 0) {
    return existing
  }

  if (!generateIfMissing) return null

  try {
    const entries = buildEmbeddingIndexEntries(pkg)
    const vectors = await generateEmbeddingVectors(entries, embed)
    saveEmbeddings(pkg.id, vectors)

    pkg.embeddingIndex = entries
    saveHandoff(pkg)

    return entries
  } catch (error) {
    log("[session-handoff] failed to generate embeddings on-demand", {
      id: pkg.id,
      error: String(error),
    })
    return null
  }
}

async function getEmbeddingVectors(
  pkg: HandoffPackage,
  index: EmbeddingIndexEntry[]
): Promise<Float32Array[] | null> {
  const inline = index.every((e) => Array.isArray(e.vector) && (e.vector?.length ?? 0) > 0)
  if (inline) {
    return index.map((e) => Float32Array.from(e.vector!))
  }

  const stored = loadEmbeddings(pkg.id)
  if (stored && stored.length > 0) {
    return stored
  }

  return null
}

function normalizeEmbeddingIndex(
  handoffId: string,
  raw: Array<Partial<EmbeddingIndexEntry>>
): EmbeddingIndexEntry[] {
  const result: EmbeddingIndexEntry[] = []

  for (let i = 0; i < raw.length; i++) {
    const entry = raw[i]
    const content = entry.content
    const category = entry.category
    const index = entry.index

    if (typeof content !== "string" || content.trim().length === 0) continue
    if (
      category !== "decision" &&
      category !== "artifact" &&
      category !== "antiPattern" &&
      category !== "domainContext"
    ) {
      continue
    }
    if (typeof index !== "number" || !Number.isFinite(index)) continue

    result.push({
      id: entry.id && typeof entry.id === "string" ? entry.id : `${handoffId}:legacy:${i}`,
      content,
      category,
      index,
      vector: Array.isArray(entry.vector) ? entry.vector : undefined,
      vectorIndex: typeof entry.vectorIndex === "number" && Number.isFinite(entry.vectorIndex) ? entry.vectorIndex : i,
    })
  }

  return result
}

function formatSemanticResults(
  query: string,
  results: Array<{ entry: EmbeddingIndexEntry; score: number }>
): string {
  const lines = results.map((r) => {
    const score = r.score.toFixed(2)
    return `- (${score}) [${r.entry.category} #${r.entry.index}] ${r.entry.content}`
  })

  return `## Semantic Matches for "${query}"

${lines.join("\n")}`
}

// ============================================================================
// Main Resolution Function
// ============================================================================

/**
 * Resolve a session reference to handoff content
 *
 * Supports various identifier formats:
 * - "latest" - most recent handoff
 * - "~1", "~2" - relative offset (1 = most recent)
 * - "ho_xxx" - direct handoff ID
 * - "handoff:latest", "handoff:~1" - explicit handoff reference
 * - "<session-id>" - find handoff by source session ID
 */
export async function resolveSessionReference(
  projectPath: string,
  identifier: string,
  query?: { type: "section"; section: string } | { type: "semantic"; query: string },
  options?: ResolveSessionReferenceOptions
): Promise<string | null> {
  let pkg: HandoffPackage | null = null

  // Handle different identifier types
  if (identifier.startsWith("handoff:")) {
    const handoffRef = identifier.slice("handoff:".length)

    if (handoffRef === "latest") {
      const recent = getRecentSessionHandoffs(projectPath, 1)
      if (recent.length > 0) {
        pkg = loadHandoff(recent[0].id)
      }
    } else if (handoffRef.startsWith("~")) {
      const offset = parseInt(handoffRef.slice(1), 10) || 1
      const recent = getRecentSessionHandoffs(projectPath, offset)
      if (recent.length >= offset) {
        pkg = loadHandoff(recent[offset - 1].id)
      }
    } else if (isSafeHandoffId(handoffRef)) {
      pkg = loadHandoff(handoffRef)
    } else {
      return null
    }
  } else if (identifier.startsWith("~")) {
    // Relative reference: ~1, ~2, etc.
    const offset = parseInt(identifier.slice(1), 10) || 1
    const recent = getRecentSessionHandoffs(projectPath, offset)
    if (recent.length >= offset) {
      pkg = loadHandoff(recent[offset - 1].id)
    }
  } else if (identifier === "latest") {
    const recent = getRecentSessionHandoffs(projectPath, 1)
    if (recent.length > 0) {
      pkg = loadHandoff(recent[0].id)
    }
  } else if (identifier.startsWith("ho_")) {
    // Direct handoff ID
    if (!isSafeHandoffId(identifier)) return null
    pkg = loadHandoff(identifier)
  } else {
    // Assume session ID, find associated handoff
    const indexEntries = findHandoffsForProject(projectPath)
    const entry = indexEntries.find((e) => e.sourceSessionId === identifier)
    if (entry) {
      pkg = loadHandoff(entry.id)
    }
  }

  if (!pkg) {
    return null
  }

  // Apply query filter if provided
  if (query) {
    if (query.type === "section") {
      return formatSection(pkg, query.section)
    }
    if (query.type === "semantic") {
      return await formatSemanticMatch(pkg, query.query, options)
    }
  }

  // Return full handoff (with staleness check)
  return formatHandoffForReference(pkg, projectPath)
}
