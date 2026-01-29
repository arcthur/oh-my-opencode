/**
 * Session Handoff Injector
 *
 * Injects relevant handoff context into new sessions.
 */

import { execFileSync } from "node:child_process"
import { statSync } from "node:fs"
import { join } from "node:path"
import type {
  HandoffPackage,
  HandoffIndexEntry,
  SessionHandoffConfig,
  Decision,
  AntiPattern,
  EmbeddingIndexEntry,
} from "./types"
import { findHandoffsForProject, loadHandoff, getRecentSessionHandoffs, loadEmbeddings, saveEmbeddings, saveHandoff } from "./storage"
import { log } from "../../shared/logger"
import { buildEmbeddingIndexEntries, cosineSimilarity, generateEmbeddingVectors } from "./embeddings"

// ============================================================================
// Safety
// ============================================================================

function isSafeHandoffId(id: string): boolean {
  if (!id || typeof id !== "string") return false
  if (!id.startsWith("ho_")) return false
  if (id.includes("\0")) return false
  if (id.includes("/") || id.includes("\\")) return false
  if (id.includes("..")) return false
  return true
}

function isSafeProjectRelativePath(filePath: string): boolean {
  if (!filePath || typeof filePath !== "string") return false
  if (filePath.includes("\0")) return false

  // Disallow absolute paths (POSIX + Windows) and drive-letter paths
  if (filePath.startsWith("/") || filePath.startsWith("\\") || /^[A-Za-z]:[\\/]/.test(filePath)) {
    return false
  }

  const parts = filePath.split(/[\\/]+/)
  if (parts.some((p) => p === "..")) return false

  return true
}

// ============================================================================
// Staleness Detection
// ============================================================================

interface StalenessInfo {
  /** Total files checked */
  totalFiles: number
  /** Files modified after handoff creation */
  modifiedFiles: string[]
  /** Staleness percentage (0-100) */
  stalenessPercent: number
  /** Whether the handoff should be considered stale */
  isStale: boolean
}

/**
 * Check handoff staleness by comparing file modification times
 */
function checkHandoffStaleness(pkg: HandoffPackage, projectPath: string): StalenessInfo {
  const handoffTime = pkg.createdAt
  const keyFiles = pkg.metadata.keyFiles
  const artifactFiles = pkg.payload.artifacts.map((a) => a.path)

  // Combine and dedupe files to check
  const filesToCheck = [...new Set([...keyFiles, ...artifactFiles])]

  if (filesToCheck.length === 0) {
    return { totalFiles: 0, modifiedFiles: [], stalenessPercent: 0, isStale: false }
  }

  const modifiedFiles: string[] = []

  for (const file of filesToCheck) {
    if (!isSafeProjectRelativePath(file)) {
      modifiedFiles.push(file)
      continue
    }

    try {
      const fullPath = join(projectPath, file)

      // First, try git to get the last modification time (more accurate for version control)
      const gitTime = getGitFileModTime(projectPath, file)
      if (gitTime && gitTime > handoffTime) {
        modifiedFiles.push(file)
        continue
      }

      // Fallback to filesystem mtime
      const stats = statSync(fullPath)
      if (stats.mtimeMs > handoffTime) {
        modifiedFiles.push(file)
      }
    } catch {
      // File doesn't exist or can't be accessed - consider it modified
      modifiedFiles.push(file)
    }
  }

  const stalenessPercent = (modifiedFiles.length / filesToCheck.length) * 100
  // Consider stale if >50% of files modified or handoff is old (>3 days) with any modifications
  const ageMs = Date.now() - handoffTime
  const ageDays = ageMs / (1000 * 60 * 60 * 24)
  const isStale = stalenessPercent > 50 || (ageDays > 3 && modifiedFiles.length > 0)

  return {
    totalFiles: filesToCheck.length,
    modifiedFiles,
    stalenessPercent: Math.round(stalenessPercent),
    isStale,
  }
}

/**
 * Get file modification time from git (last commit time)
 */
function getGitFileModTime(projectPath: string, file: string): number | null {
  try {
    const result = execFileSync(
      "git",
      ["log", "-1", "--format=%ct", "--", file],
      { cwd: projectPath, encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] }
    ).trim()

    if (result) {
      // Git returns Unix timestamp in seconds
      return parseInt(result, 10) * 1000
    }
  } catch {
    // Not a git repo or file not tracked
  }
  return null
}

/**
 * Format staleness warning
 */
function formatStalenessWarning(staleness: StalenessInfo): string {
  if (!staleness.isStale) return ""

  const lines = [
    `⚠️ **Staleness Warning**: ${staleness.stalenessPercent}% of related files have been modified since this session.`,
  ]

  if (staleness.modifiedFiles.length <= 5) {
    lines.push(`Modified: ${staleness.modifiedFiles.join(", ")}`)
  } else {
    lines.push(`Modified: ${staleness.modifiedFiles.slice(0, 5).join(", ")} and ${staleness.modifiedFiles.length - 5} more`)
  }

  lines.push("*Some decisions or context may be outdated. Verify before applying.*\n")

  return lines.join("\n")
}

// ============================================================================
// Injection Formatting
// ============================================================================

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
    for (const decision of pkg.payload.decisions.slice(0, 5)) {
      lines.push(`${formatDecision(decision)}`)
    }
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

/**
 * Format a decision for display
 */
function formatDecision(decision: Decision): string {
  const lines: string[] = []

  lines.push(`1. **${decision.what}**: ${decision.chosen}`)
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

// ============================================================================
// Reference Resolution (for @session:id syntax)
// ============================================================================

/**
 * Resolve a session reference to handoff content
 */
export interface ResolveSessionReferenceOptions {
  embeddings?: {
    embed: (texts: string[]) => Promise<number[][]>
    maxResults?: number
    minRelevance?: number
    /** Generate and persist embeddings when missing (default: true) */
    generateIfMissing?: boolean
  }
}

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
  return formatHandoffForInjection(pkg, projectPath)
}

/**
 * Format a specific section of the handoff
 */
function formatSection(pkg: HandoffPackage, section: string): string {
  switch (section) {
    case "decisions":
      if (pkg.payload.decisions.length === 0) return "No decisions recorded."
      return pkg.payload.decisions.map(formatDecision).join("\n\n")

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
