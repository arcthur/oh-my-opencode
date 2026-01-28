/**
 * RAPTOR-style Hierarchical Memory Aggregation
 *
 * Implements recursive summarization across time scales:
 * L0 (raw) -> L1 (weekly) -> L2 (monthly) -> L3 (long-term knowledge)
 */

import type {
  WorkHistoryEntry,
  WeeklySummary,
  MonthlySummary,
  LongTermKnowledge,
  UserMemory,
  HierarchicalMemoryConfig,
  SemanticClusteringConfig,
  ConsolidationConfig,
  EmbeddingConfig,
  EmbeddingProvider,
  EmbeddingCache,
} from "./types"
import { DEFAULT_HIERARCHICAL_CONFIG, DEFAULT_SEMANTIC_CLUSTERING_CONFIG, DEFAULT_CONSOLIDATION_CONFIG, DEFAULT_EMBEDDING_CONFIG } from "./types"
import { buildWeeklySummaryPrompt, buildMonthlySummaryPrompt, buildMergeDecisionPrompt, parseMergeDecisionResponse } from "./prompts"
import { log } from "../../shared/logger"
import { calculateSimilarity, DEFAULT_SIMILARITY_CONFIG, calculateSimilarityWithEmbeddings, type HybridSimilarityContext } from "./similarity"
import { generateKnowledgeId, inferStalenessCategory, calculateValidityRange } from "./temporal-validity"

// ============================================================================
// Time Boundary Utilities
// ============================================================================

/**
 * Get the start of the ISO week (Monday 00:00:00) for a given timestamp
 */
export function getWeekStart(timestamp: number): number {
  const date = new Date(timestamp)
  const day = date.getDay()
  // Adjust for Monday start (ISO week)
  const diff = date.getDate() - day + (day === 0 ? -6 : 1)
  // Create new Date to avoid mutating the original
  const weekStart = new Date(date.getFullYear(), date.getMonth(), diff, 0, 0, 0, 0)
  return weekStart.getTime()
}

/**
 * Get the end of the ISO week (Sunday 23:59:59) for a given timestamp
 */
export function getWeekEnd(timestamp: number): number {
  const weekStart = getWeekStart(timestamp)
  // Add 7 days - 1 millisecond
  return weekStart + 7 * 24 * 60 * 60 * 1000 - 1
}

/**
 * Get the start of the month for a given timestamp
 */
export function getMonthStart(timestamp: number): number {
  const date = new Date(timestamp)
  return new Date(date.getFullYear(), date.getMonth(), 1).getTime()
}

/**
 * Get the month identifier in "YYYY-MM" format
 */
export function formatMonth(timestamp: number): string {
  const date = new Date(timestamp)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  return `${year}-${month}`
}

/**
 * Check if we've crossed a week boundary since last aggregation
 */
export function crossedWeekBoundary(
  lastAggregation: number | undefined,
  now: number
): boolean {
  if (!lastAggregation) return false // Don't aggregate if never aggregated before
  const lastWeekStart = getWeekStart(lastAggregation)
  const currentWeekStart = getWeekStart(now)
  return currentWeekStart > lastWeekStart
}

/**
 * Check if we've crossed a month boundary since last aggregation
 */
export function crossedMonthBoundary(
  lastAggregation: number | undefined,
  now: number
): boolean {
  if (!lastAggregation) return false
  const lastMonth = formatMonth(lastAggregation)
  const currentMonth = formatMonth(now)
  return currentMonth !== lastMonth
}

/**
 * Check if we've crossed a year boundary (or quarter for more frequent extraction)
 */
export function crossedKnowledgeExtractionBoundary(
  lastExtraction: number | undefined,
  now: number,
  intervalMonths: number = 3 // Default: quarterly
): boolean {
  if (!lastExtraction) return false
  const monthsSinceExtraction =
    (now - lastExtraction) / (30 * 24 * 60 * 60 * 1000)
  return monthsSinceExtraction >= intervalMonths
}

// ============================================================================
// Metadata Extraction Utilities
// ============================================================================

/**
 * Extract unique projects from work history entries
 */
export function extractProjects(entries: WorkHistoryEntry[]): string[] {
  const projects = new Set<string>()
  for (const entry of entries) {
    if (entry.project) {
      projects.add(entry.project)
    }
  }
  return Array.from(projects)
}

/**
 * Extract technology stack hints from file paths and summaries
 */
export function extractTechStack(entries: WorkHistoryEntry[]): string[] {
  const techHints = new Set<string>()

  for (const entry of entries) {
    // Extract from file extensions
    if (entry.filesModified) {
      for (const file of entry.filesModified) {
        const ext = file.split(".").pop()?.toLowerCase()
        if (ext) {
          switch (ext) {
            case "ts":
            case "tsx":
              techHints.add("TypeScript")
              break
            case "js":
            case "jsx":
              techHints.add("JavaScript")
              break
            case "py":
              techHints.add("Python")
              break
            case "rs":
              techHints.add("Rust")
              break
            case "go":
              techHints.add("Go")
              break
            case "java":
              techHints.add("Java")
              break
            case "rb":
              techHints.add("Ruby")
              break
            case "css":
            case "scss":
            case "less":
              techHints.add("CSS")
              break
            case "html":
              techHints.add("HTML")
              break
            case "sql":
              techHints.add("SQL")
              break
            case "md":
              techHints.add("Markdown")
              break
          }
        }

        // Extract from path patterns
        if (file.includes("test") || file.includes("spec")) {
          techHints.add("Testing")
        }
        if (file.includes("docker") || file.includes("Dockerfile")) {
          techHints.add("Docker")
        }
        if (file.includes("k8s") || file.includes("kubernetes")) {
          techHints.add("Kubernetes")
        }
      }
    }

    // Extract from summary keywords
    const summary = entry.summary.toLowerCase()
    if (summary.includes("react")) techHints.add("React")
    if (summary.includes("vue")) techHints.add("Vue")
    if (summary.includes("angular")) techHints.add("Angular")
    if (summary.includes("next")) techHints.add("Next.js")
    if (summary.includes("node")) techHints.add("Node.js")
    if (summary.includes("express")) techHints.add("Express")
    if (summary.includes("fastapi")) techHints.add("FastAPI")
    if (summary.includes("django")) techHints.add("Django")
    if (summary.includes("flask")) techHints.add("Flask")
    if (summary.includes("graphql")) techHints.add("GraphQL")
    if (summary.includes("rest") || summary.includes("api"))
      techHints.add("REST API")
    if (summary.includes("postgres") || summary.includes("postgresql"))
      techHints.add("PostgreSQL")
    if (summary.includes("mongodb") || summary.includes("mongo"))
      techHints.add("MongoDB")
    if (summary.includes("redis")) techHints.add("Redis")
  }

  return Array.from(techHints)
}

// ============================================================================
// LLM Summarization Interface
// ============================================================================

/**
 * Response structure from LLM summarization
 */
export interface SummarizationResponse {
  summary: string
  achievements: string[]
  lessons: string[]
  techEvolution?: string
}

/**
 * Summarize function type - to be injected by the hook
 * This allows the aggregation module to be testable without LLM dependency
 */
export type SummarizeFunction = (prompt: string) => Promise<SummarizationResponse>

// ============================================================================
// L0 -> L1: Weekly Aggregation
// ============================================================================

/**
 * Aggregate work history entries into a weekly summary
 */
export async function aggregateToWeekly(
  entries: WorkHistoryEntry[],
  weekStart: number,
  weekEnd: number,
  summarize: SummarizeFunction
): Promise<WeeklySummary> {
  // Filter entries for this week (inclusive of weekEnd)
  const weekEntries = entries.filter(
    (e) => e.timestamp >= weekStart && e.timestamp <= weekEnd
  )

  if (weekEntries.length === 0) {
    return {
      weekStart,
      weekEnd,
      summary: "No recorded work sessions this week.",
      projects: [],
      keyAchievements: [],
      lessonsLearned: [],
      techStack: [],
      entryCount: 0,
    }
  }

  // Extract metadata
  const projects = extractProjects(weekEntries)
  const techStack = extractTechStack(weekEntries)
  const factsValidRange = calculateValidityRange(weekEntries)

  // Build prompt for LLM
  const prompt = buildWeeklySummaryPrompt(weekEntries)

  // Helper to create fallback summary
  const createFallbackSummary = (): WeeklySummary => ({
    weekStart,
    weekEnd,
    summary: `Completed ${weekEntries.length} work sessions across ${projects.length} project${projects.length !== 1 ? "s" : ""}.`,
    projects,
    keyAchievements: weekEntries
      .filter((e) => e.outcome === "success")
      .slice(0, 3)
      .map((e) => e.summary),
    lessonsLearned: [],
    techStack,
    entryCount: weekEntries.length,
    facts_valid_range: factsValidRange,
  })

  try {
    const response = await summarize(prompt)

    // Check if LLM returned empty/useless response - use fallback
    if (!response.summary || response.summary.trim().length === 0) {
      log("[aggregation] LLM returned empty summary, using fallback")
      return createFallbackSummary()
    }

    return {
      weekStart,
      weekEnd,
      summary: response.summary,
      projects,
      keyAchievements: response.achievements.length > 0
        ? response.achievements
        : weekEntries.filter((e) => e.outcome === "success").slice(0, 3).map((e) => e.summary),
      lessonsLearned: response.lessons,
      techStack,
      entryCount: weekEntries.length,
      facts_valid_range: factsValidRange,
    }
  } catch (error) {
    log("[aggregation] failed to summarize weekly", { error: String(error) })
    return createFallbackSummary()
  }
}

// ============================================================================
// L1 -> L2: Monthly Aggregation
// ============================================================================

/**
 * Aggregate weekly summaries into a monthly summary
 */
export async function aggregateToMonthly(
  weeklySummaries: WeeklySummary[],
  month: string,
  summarize: SummarizeFunction
): Promise<MonthlySummary> {
  // Filter summaries for this month
  const monthWeeks = weeklySummaries.filter(
    (w) => formatMonth(w.weekStart) === month
  )

  if (monthWeeks.length === 0) {
    return {
      month,
      summary: "No recorded work sessions this month.",
      projects: [],
      keyAchievements: [],
      lessonsLearned: [],
      techStackEvolution: "",
      weekCount: 0,
    }
  }

  // Aggregate metadata
  const projects = [...new Set(monthWeeks.flatMap((w) => w.projects))]
  const allAchievements = monthWeeks.flatMap((w) => w.keyAchievements)
  const allLessons = monthWeeks.flatMap((w) => w.lessonsLearned)
  const allTechStack = [...new Set(monthWeeks.flatMap((w) => w.techStack))]

  // Combine validity ranges from weekly summaries
  const weeksWithValidity = monthWeeks
    .filter((w) => w.facts_valid_range)
    .map((w) => ({
      timestamp: w.weekStart,
      valid_from: w.facts_valid_range!.earliest_valid_from,
      valid_until: w.facts_valid_range!.latest_valid_until,
    }))
  const factsValidRange = calculateValidityRange(weeksWithValidity)

  // Build prompt for LLM
  const prompt = buildMonthlySummaryPrompt(monthWeeks)

  // Helper to create fallback summary
  const createFallbackSummary = (): MonthlySummary => ({
    month,
    summary: `Completed work across ${monthWeeks.length} week${monthWeeks.length !== 1 ? "s" : ""} and ${projects.length} project${projects.length !== 1 ? "s" : ""}.`,
    projects,
    keyAchievements: allAchievements.slice(0, 5),
    lessonsLearned: allLessons.slice(0, 3),
    techStackEvolution: allTechStack.join(", "),
    weekCount: monthWeeks.length,
    facts_valid_range: factsValidRange,
  })

  try {
    const response = await summarize(prompt)

    // Check if LLM returned empty/useless response - use fallback
    if (!response.summary || response.summary.trim().length === 0) {
      log("[aggregation] LLM returned empty monthly summary, using fallback")
      return createFallbackSummary()
    }

    return {
      month,
      summary: response.summary,
      projects,
      keyAchievements: response.achievements.length > 0
        ? response.achievements
        : allAchievements.slice(0, 5),
      lessonsLearned: response.lessons.length > 0
        ? response.lessons
        : allLessons.slice(0, 3),
      techStackEvolution: response.techEvolution || allTechStack.join(", "),
      weekCount: monthWeeks.length,
      facts_valid_range: factsValidRange,
    }
  } catch (error) {
    log("[aggregation] failed to summarize monthly", { error: String(error) })
    return createFallbackSummary()
  }
}

// ============================================================================
// L2 -> L3: Knowledge Extraction
// ============================================================================

/**
 * Lesson cluster for grouping similar insights
 */
interface LessonCluster {
  content: string
  representativeContent: string
  occurrences: number
  firstMonth: string
  lastMonth: string
  months: string[]
}

/**
 * Extract long-term knowledge from monthly summaries
 *
 * @param monthlySummaries - Monthly summaries to extract from
 * @param existingKnowledge - Existing knowledge to merge with
 * @param summarize - LLM summarize function
 * @param config - Semantic clustering configuration
 * @param knowledgeLimit - Maximum knowledge entries to keep
 * @param hybridContext - Optional hybrid similarity context for vector search
 */
export async function extractLongTermKnowledge(
  monthlySummaries: MonthlySummary[],
  existingKnowledge: LongTermKnowledge[],
  summarize: SummarizeFunction,
  config: SemanticClusteringConfig = DEFAULT_SEMANTIC_CLUSTERING_CONFIG,
  knowledgeLimit: number = DEFAULT_HIERARCHICAL_CONFIG.long_term_knowledge_limit,
  hybridContext?: HybridSimilarityContext
): Promise<LongTermKnowledge[]> {
  // Apply limit even when no new knowledge is extracted
  const applyLimit = (arr: LongTermKnowledge[]) =>
    arr.length <= knowledgeLimit ? arr : arr.slice(0, knowledgeLimit)

  if (monthlySummaries.length === 0) {
    return applyLimit(existingKnowledge)
  }

  // Collect all lessons with their source months
  const allLessons = monthlySummaries.flatMap((m) =>
    m.lessonsLearned.map((l) => ({ content: l, month: m.month }))
  )

  if (allLessons.length === 0) {
    return applyLimit(existingKnowledge)
  }

  // Cluster similar lessons using enhanced semantic similarity (hybrid when available)
  const clusters = await clusterSimilarLessons(allLessons, summarize, config, hybridContext)

  // Filter to clusters that appeared in at least 2 DIFFERENT months
  // This ensures we capture stable cross-month patterns, not single-month noise
  const stablePatterns = clusters.filter((c) => c.months.length >= 2)

  // Convert clusters to knowledge entries
  // Confidence is based on number of unique months, not total occurrences
  const newKnowledge: LongTermKnowledge[] = stablePatterns.map((c) => {
    const category = categorizeKnowledge(c.content)
    const entry: LongTermKnowledge = {
      id: generateKnowledgeId(c.representativeContent),
      category,
      content: c.representativeContent,
      confidence: Math.min(c.months.length / 5, 1.0),  // Based on unique months
      firstSeen: new Date(c.firstMonth + "-01").getTime(),
      lastReinforced: new Date(c.lastMonth + "-01").getTime(),
      sourceMonths: c.months,
      staleness_category: inferStalenessCategory({ category, content: c.representativeContent }),
    }
    return entry
  })

  // Merge with existing knowledge
  return mergeKnowledge(existingKnowledge, newKnowledge, knowledgeLimit)
}

/**
 * Enhanced semantic clustering for lessons
 *
 * Uses hybrid approach:
 * 1. Enhanced word overlap with stemming and synonyms for candidate selection
 * 2. Vector similarity when embeddings are enabled (three-way hybrid)
 * 3. LLM-assisted merge decisions for borderline cases (when available)
 *
 * @param lessons - Lessons to cluster
 * @param summarize - Optional LLM summarize function for borderline decisions
 * @param config - Semantic clustering configuration
 * @param hybridContext - Optional hybrid similarity context for vector search
 */
async function clusterSimilarLessons(
  lessons: Array<{ content: string; month: string }>,
  summarize?: SummarizeFunction,
  config: SemanticClusteringConfig = DEFAULT_SEMANTIC_CLUSTERING_CONFIG,
  hybridContext?: HybridSimilarityContext
): Promise<LessonCluster[]> {
  const clusters: LessonCluster[] = []
  let llmCallsUsed = 0

  for (const lesson of lessons) {
    let matched = false
    let bestMatch: { cluster: LessonCluster; similarity: { score: number; confidence: "high" | "medium" | "low" } } | null = null

    // Find matching cluster using enhanced similarity (hybrid when available)
    for (const cluster of clusters) {
      // Use hybrid similarity when embedding context is available
      const similarityResult = hybridContext
        ? await calculateSimilarityWithEmbeddings(
            lesson.content,
            cluster.content,
            hybridContext,
            `lesson-${lessons.indexOf(lesson)}`,
            `cluster-${clusters.indexOf(cluster)}`
          )
        : calculateSimilarity(lesson.content, cluster.content, {
            ...DEFAULT_SIMILARITY_CONFIG,
            highConfidenceThreshold: config.high_confidence_threshold,
            candidateThreshold: config.candidate_threshold,
            useSynonyms: config.use_synonyms,
            useStemming: config.use_stemming,
          })

      // Normalize to common interface for comparison
      const similarity = {
        score: similarityResult.score,
        confidence: similarityResult.confidence,
      }

      // Track best match for potential LLM decision
      if (!bestMatch || similarity.score > bestMatch.similarity.score) {
        bestMatch = { cluster, similarity }
      }

      // High confidence: auto-merge
      if (similarity.confidence === "high") {
        mergeIntoCluster(cluster, lesson)
        matched = true
        break
      }
    }

    // Medium confidence: use LLM if available and within budget
    if (
      !matched &&
      bestMatch &&
      bestMatch.similarity.confidence === "medium" &&
      summarize &&
      config.enabled &&
      llmCallsUsed < config.max_llm_calls
    ) {
      try {
        const prompt = buildMergeDecisionPrompt(
          bestMatch.cluster.representativeContent,
          lesson.content
        )
        const response = await summarize(prompt)
        llmCallsUsed++

        // Parse as merge decision
        const decision = parseMergeDecisionResponse(
          typeof response === "string" ? response : response.summary || ""
        )

        if (decision.same_insight) {
          mergeIntoCluster(bestMatch.cluster, lesson, decision.merged_content)
          matched = true
          log("[aggregation] LLM merged lessons", {
            reason: decision.reason,
            similarity: bestMatch.similarity.score,
          })
        }
      } catch (error) {
        log("[aggregation] LLM merge decision failed", { error: String(error) })
        // Fall through to create new cluster
      }
    }

    // No match: create new cluster
    if (!matched) {
      clusters.push({
        content: lesson.content,
        representativeContent: lesson.content,
        occurrences: 1,
        firstMonth: lesson.month,
        lastMonth: lesson.month,
        months: [lesson.month],
      })
    }
  }

  return clusters
}

/**
 * Helper to merge a lesson into an existing cluster
 */
function mergeIntoCluster(
  cluster: LessonCluster,
  lesson: { content: string; month: string },
  mergedContent?: string
): void {
  cluster.occurrences++
  cluster.lastMonth = lesson.month
  if (!cluster.months.includes(lesson.month)) {
    cluster.months.push(lesson.month)
  }
  // Use LLM-merged content or keep the longer content as representative
  if (mergedContent) {
    cluster.representativeContent = mergedContent
  } else if (lesson.content.length > cluster.representativeContent.length) {
    cluster.representativeContent = lesson.content
  }
}

/**
 * Categorize knowledge based on content keywords
 */
function categorizeKnowledge(
  content: string
): "lesson" | "pattern" | "preference" | "skill" {
  const lower = content.toLowerCase()

  if (
    lower.includes("prefer") ||
    lower.includes("like") ||
    lower.includes("style") ||
    lower.includes("convention")
  ) {
    return "preference"
  }

  if (
    lower.includes("pattern") ||
    lower.includes("approach") ||
    lower.includes("method") ||
    lower.includes("technique")
  ) {
    return "pattern"
  }

  if (
    lower.includes("learned") ||
    lower.includes("skill") ||
    lower.includes("improved") ||
    lower.includes("mastered")
  ) {
    return "skill"
  }

  return "lesson"
}

/**
 * Merge new knowledge with existing, updating confidence for reinforced items
 */
export function mergeKnowledge(
  existing: LongTermKnowledge[],
  newKnowledge: LongTermKnowledge[],
  limit: number
): LongTermKnowledge[] {
  const maxEntries = Math.max(0, Math.floor(limit))
  const now = Date.now()
  const merged = [...existing]

  for (const newItem of newKnowledge) {
    let foundMatch = false
    let supersededItem: LongTermKnowledge | null = null

    for (const existingItem of merged) {
      // Skip already superseded items
      if (
        existingItem.valid_until !== null &&
        existingItem.valid_until !== undefined &&
        existingItem.valid_until < now
      ) {
        continue
      }

      const similarity = calculateSimilarity(newItem.content, existingItem.content)

      if (similarity.confidence === "high") {
        // Check for supersession (preference/version updates)
        const { supersedes } = checkSupersessionPattern(existingItem.content, newItem.content)

        if (supersedes) {
          // Mark old as superseded, add new
          supersededItem = existingItem
          foundMatch = false // Will add as new
          break
        } else {
          // Reinforce existing knowledge - merge source months
          existingItem.sourceMonths = [
            ...new Set([...existingItem.sourceMonths, ...newItem.sourceMonths]),
          ]
          existingItem.confidence = Math.min(existingItem.sourceMonths.length / 5, 1.0)
          existingItem.lastReinforced = newItem.lastReinforced
          foundMatch = true
          break
        }
      }
    }

    // Handle supersession
    if (supersededItem) {
      supersededItem.valid_until = newItem.valid_from ?? newItem.firstSeen
      if (newItem.id) {
        supersededItem.superseded_by = newItem.id
      }
      merged.push(newItem)
    } else if (!foundMatch) {
      merged.push(newItem)
    }
  }

  // Keep expired items for history, but always prioritize active items.
  const active = merged.filter(
    (k) => k.valid_until === null || k.valid_until === undefined || k.valid_until > now
  )
  const expired = merged.filter(
    (k) => k.valid_until !== null && k.valid_until !== undefined && k.valid_until <= now
  )

  active.sort((a, b) => {
    if (b.confidence !== a.confidence) return b.confidence - a.confidence
    return b.lastReinforced - a.lastReinforced
  })
  expired.sort((a, b) => {
    const aUntil = a.valid_until ?? 0
    const bUntil = b.valid_until ?? 0
    if (bUntil !== aUntil) return bUntil - aUntil
    return b.confidence - a.confidence
  })

  return [...active, ...expired].slice(0, maxEntries)
}

/**
 * Check for supersession patterns without LLM
 * Detects version updates and preference changes
 */
function checkSupersessionPattern(
  oldContent: string,
  newContent: string
): { supersedes: boolean; reason?: string } {
  const oldLower = oldContent.toLowerCase()
  const newLower = newContent.toLowerCase()

  // Check for version changes
  const versionPattern = /(?:v|version\s*)?\d+(?:\.\d+)*/gi
  const oldVersions: string[] = oldContent.match(versionPattern) ?? []
  const newVersions: string[] = newContent.match(versionPattern) ?? []

  if (oldVersions.length > 0 && newVersions.length > 0) {
    // If versions differ in similar content, likely supersession
    const hasVersionChange = oldVersions.some((v) => !newVersions.includes(v))
    if (hasVersionChange) {
      return { supersedes: true, reason: "Version update" }
    }
  }

  // Check for preference pattern changes
  const preferPatterns = [
    /\b(?:i\s+)?prefer\s+(\w+)/i,
    /\b(?:i\s+)?use\s+(\w+)/i,
    /\b(?:switched?\s+to)\s+(\w+)/i,
    /\b(?:migrated?\s+to)\s+(\w+)/i,
  ]

  for (const pattern of preferPatterns) {
    const oldMatch = oldLower.match(pattern)
    const newMatch = newLower.match(pattern)

    if (oldMatch && newMatch && oldMatch[1] !== newMatch[1]) {
      return { supersedes: true, reason: "Preference changed" }
    }
  }

  return { supersedes: false }
}

// ============================================================================
// Consolidation Triggers
// ============================================================================

/**
 * Check if size-based consolidation is needed.
 * Returns which levels need consolidation based on thresholds.
 */
export function checkConsolidationTriggers(
  memory: UserMemory,
  config: ConsolidationConfig = DEFAULT_CONSOLIDATION_CONFIG
): { needsL0toL1: boolean; needsL1toL2: boolean; needsL2toL3: boolean } {
  if (!config.enabled) {
    return { needsL0toL1: false, needsL1toL2: false, needsL2toL3: false }
  }

  const workHistorySize = memory.workHistory?.length ?? 0
  const weeklySummariesSize = memory.weeklySummaries?.length ?? 0
  const monthlySummariesSize = memory.monthlySummaries?.length ?? 0

  return {
    needsL0toL1: workHistorySize > config.work_history_threshold,
    needsL1toL2: weeklySummariesSize > config.weekly_summaries_threshold,
    needsL2toL3: monthlySummariesSize > config.monthly_summaries_threshold,
  }
}

// ============================================================================
// Main Aggregation Orchestrator
// ============================================================================

/**
 * Check and perform all necessary aggregations for the user memory
 *
 * Handles gaps correctly: if user skips multiple weeks/months, all intermediate
 * periods are aggregated to prevent data loss.
 *
 * Now also supports size-based consolidation triggers (not just time boundaries).
 *
 * @param memory - User memory to aggregate
 * @param now - Current timestamp
 * @param summarize - LLM summarize function
 * @param config - Hierarchical memory configuration
 * @param consolidationConfig - Consolidation configuration
 * @param semanticClusteringConfig - Semantic clustering configuration
 * @param hybridContext - Optional hybrid similarity context for vector search
 */
export async function performAggregations(
  memory: UserMemory,
  now: number,
  summarize: SummarizeFunction,
  config: HierarchicalMemoryConfig = DEFAULT_HIERARCHICAL_CONFIG,
  consolidationConfig: ConsolidationConfig = DEFAULT_CONSOLIDATION_CONFIG,
  semanticClusteringConfig: SemanticClusteringConfig = DEFAULT_SEMANTIC_CLUSTERING_CONFIG,
  hybridContext?: HybridSimilarityContext
): Promise<UserMemory> {
  if (!config.enabled) {
    return memory
  }

  const updated = { ...memory }

  // Initialize arrays if undefined
  updated.weeklySummaries = updated.weeklySummaries ?? []
  updated.monthlySummaries = updated.monthlySummaries ?? []
  updated.longTermKnowledge = updated.longTermKnowledge ?? []

  // Check size-based consolidation triggers
  const consolidation = checkConsolidationTriggers(updated, consolidationConfig)

  // L0 -> L1: Aggregate on week boundary OR size threshold
  // Skip if no lastWeeklyAggregation (first-time user should be initialized first)
  const needsWeeklyAggregation =
    updated.lastWeeklyAggregation !== undefined &&
    (crossedWeekBoundary(updated.lastWeeklyAggregation, now) || consolidation.needsL0toL1)

  if (needsWeeklyAggregation) {
    const currentWeekStart = getWeekStart(now)
    // Safe: needsWeeklyAggregation is only true when lastWeeklyAggregation !== undefined
    let iterWeekStart = getWeekStart(updated.lastWeeklyAggregation!)

    // Loop through all weeks between lastAggregation and now
    while (iterWeekStart < currentWeekStart) {
      const iterWeekEnd = getWeekEnd(iterWeekStart)

      log("[aggregation] performing weekly aggregation", {
        weekStart: new Date(iterWeekStart).toISOString(),
      })

      const weeklySummary = await aggregateToWeekly(
        updated.workHistory,
        iterWeekStart,
        iterWeekEnd,
        summarize
      )

      // Only add non-empty summaries
      if (weeklySummary.entryCount > 0) {
        updated.weeklySummaries.unshift(weeklySummary)
      }

      // Move to next week - use getWeekStart to handle DST transitions correctly
      // Adding 7 days in milliseconds can land on wrong time due to DST shifts
      const nextWeekApprox = iterWeekStart + 7 * 24 * 60 * 60 * 1000
      iterWeekStart = getWeekStart(nextWeekApprox)
    }

    // Trim to limit
    updated.weeklySummaries = updated.weeklySummaries.slice(
      0,
      config.weekly_summaries_limit
    )

    // Clean up aggregated entries (keep only current week)
    updated.workHistory = updated.workHistory.filter(
      (e) => e.timestamp >= currentWeekStart
    )

    updated.lastWeeklyAggregation = now
  }

  // L1 -> L2: Aggregate on month boundary OR size threshold
  // Skip if no lastMonthlyAggregation (first-time user should be initialized first)
  const needsMonthlyAggregation =
    updated.lastMonthlyAggregation !== undefined &&
    (crossedMonthBoundary(updated.lastMonthlyAggregation, now) || consolidation.needsL1toL2)

  if (needsMonthlyAggregation) {
    const currentMonth = formatMonth(now)
    // Safe: needsMonthlyAggregation is only true when lastMonthlyAggregation !== undefined
    let iterMonth = formatMonth(updated.lastMonthlyAggregation!)

    // Loop through all months between lastAggregation and now
    while (iterMonth !== currentMonth) {
      log("[aggregation] performing monthly aggregation", { month: iterMonth })

      const monthlySummary = await aggregateToMonthly(
        updated.weeklySummaries,
        iterMonth,
        summarize
      )

      // Only add non-empty summaries
      if (monthlySummary.weekCount > 0) {
        updated.monthlySummaries.unshift(monthlySummary)
      }

      // Move to next month
      const [year, month] = iterMonth.split("-").map(Number)
      const nextDate = new Date(year, month, 1) // month is already 1-based, so this gives next month
      iterMonth = formatMonth(nextDate.getTime())
    }

    // Trim to limit
    updated.monthlySummaries = updated.monthlySummaries.slice(
      0,
      config.monthly_summaries_limit
    )

    updated.lastMonthlyAggregation = now
  }

  // L2 -> L3: Extract knowledge on interval boundary OR size threshold
  const needsKnowledgeExtraction =
    crossedKnowledgeExtractionBoundary(updated.lastKnowledgeExtraction, now) ||
    consolidation.needsL2toL3

  if (needsKnowledgeExtraction) {
    log("[aggregation] extracting long-term knowledge", {
      useHybridSimilarity: !!hybridContext,
    })

    updated.longTermKnowledge = await extractLongTermKnowledge(
      updated.monthlySummaries,
      updated.longTermKnowledge,
      summarize,
      semanticClusteringConfig,
      config.long_term_knowledge_limit,
      hybridContext
    )

    updated.lastKnowledgeExtraction = now
  }

  return updated
}

/**
 * Initialize aggregation timestamps for new users
 * Should be called when first work history entry is added
 */
export function initializeAggregationTimestamps(
  memory: UserMemory,
  now: number
): UserMemory {
  return {
    ...memory,
    lastWeeklyAggregation: memory.lastWeeklyAggregation ?? now,
    lastMonthlyAggregation: memory.lastMonthlyAggregation ?? now,
    lastKnowledgeExtraction: memory.lastKnowledgeExtraction ?? now,
    weeklySummaries: memory.weeklySummaries ?? [],
    monthlySummaries: memory.monthlySummaries ?? [],
    longTermKnowledge: memory.longTermKnowledge ?? [],
  }
}
