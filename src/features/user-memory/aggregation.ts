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
} from "./types"
import { DEFAULT_HIERARCHICAL_CONFIG } from "./types"
import { buildWeeklySummaryPrompt, buildMonthlySummaryPrompt } from "./prompts"
import { log } from "../../shared/logger"

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
  const weekStart = new Date(date.setDate(diff))
  weekStart.setHours(0, 0, 0, 0)
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
 */
export async function extractLongTermKnowledge(
  monthlySummaries: MonthlySummary[],
  existingKnowledge: LongTermKnowledge[],
  summarize: SummarizeFunction
): Promise<LongTermKnowledge[]> {
  if (monthlySummaries.length === 0) {
    return existingKnowledge
  }

  // Collect all lessons with their source months
  const allLessons = monthlySummaries.flatMap((m) =>
    m.lessonsLearned.map((l) => ({ content: l, month: m.month }))
  )

  if (allLessons.length === 0) {
    return existingKnowledge
  }

  // Cluster similar lessons
  const clusters = clusterSimilarLessons(allLessons)

  // Filter to clusters that appeared in at least 2 DIFFERENT months
  // This ensures we capture stable cross-month patterns, not single-month noise
  const stablePatterns = clusters.filter((c) => c.months.length >= 2)

  // Convert clusters to knowledge entries
  // Confidence is based on number of unique months, not total occurrences
  const newKnowledge: LongTermKnowledge[] = stablePatterns.map((c) => ({
    category: categorizeKnowledge(c.content),
    content: c.representativeContent,
    confidence: Math.min(c.months.length / 5, 1.0),  // Based on unique months
    firstSeen: new Date(c.firstMonth + "-01").getTime(),
    lastReinforced: new Date(c.lastMonth + "-01").getTime(),
    sourceMonths: c.months,
  }))

  // Merge with existing knowledge
  return mergeKnowledge(existingKnowledge, newKnowledge)
}

/**
 * Simple similarity-based clustering for lessons
 * Uses word overlap as a proxy for semantic similarity
 */
function clusterSimilarLessons(
  lessons: Array<{ content: string; month: string }>
): LessonCluster[] {
  const clusters: LessonCluster[] = []
  const threshold = 0.4 // Word overlap threshold

  for (const lesson of lessons) {
    const words = new Set(
      lesson.content.toLowerCase().split(/\s+/).filter((w) => w.length > 3)
    )

    // Find matching cluster
    let matched = false
    for (const cluster of clusters) {
      const clusterWords = new Set(
        cluster.content.toLowerCase().split(/\s+/).filter((w) => w.length > 3)
      )
      const overlap = [...words].filter((w) => clusterWords.has(w)).length
      const similarity = overlap / Math.max(words.size, clusterWords.size)

      if (similarity >= threshold) {
        cluster.occurrences++
        cluster.lastMonth = lesson.month
        if (!cluster.months.includes(lesson.month)) {
          cluster.months.push(lesson.month)
        }
        // Keep the longer content as representative
        if (lesson.content.length > cluster.representativeContent.length) {
          cluster.representativeContent = lesson.content
        }
        matched = true
        break
      }
    }

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
  newKnowledge: LongTermKnowledge[]
): LongTermKnowledge[] {
  const merged = [...existing]
  const threshold = 0.4

  for (const newItem of newKnowledge) {
    const newWords = new Set(
      newItem.content.toLowerCase().split(/\s+/).filter((w) => w.length > 3)
    )

    let foundMatch = false
    for (const existingItem of merged) {
      const existingWords = new Set(
        existingItem.content
          .toLowerCase()
          .split(/\s+/)
          .filter((w) => w.length > 3)
      )
      const overlap = [...newWords].filter((w) => existingWords.has(w)).length
      const similarity =
        overlap / Math.max(newWords.size, existingWords.size)

      if (similarity >= threshold) {
        // Reinforce existing knowledge - merge source months first
        existingItem.sourceMonths = [
          ...new Set([...existingItem.sourceMonths, ...newItem.sourceMonths]),
        ]
        // Recalculate confidence based on total unique months
        existingItem.confidence = Math.min(existingItem.sourceMonths.length / 5, 1.0)
        existingItem.lastReinforced = newItem.lastReinforced
        foundMatch = true
        break
      }
    }

    if (!foundMatch) {
      merged.push(newItem)
    }
  }

  // Sort by confidence and limit
  return merged
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 50)
}

// ============================================================================
// Main Aggregation Orchestrator
// ============================================================================

/**
 * Check and perform all necessary aggregations for the user memory
 *
 * Handles gaps correctly: if user skips multiple weeks/months, all intermediate
 * periods are aggregated to prevent data loss.
 */
export async function performAggregations(
  memory: UserMemory,
  now: number,
  summarize: SummarizeFunction,
  config: HierarchicalMemoryConfig = DEFAULT_HIERARCHICAL_CONFIG
): Promise<UserMemory> {
  if (!config.enabled) {
    return memory
  }

  const updated = { ...memory }

  // Initialize arrays if undefined
  updated.weeklySummaries = updated.weeklySummaries ?? []
  updated.monthlySummaries = updated.monthlySummaries ?? []
  updated.longTermKnowledge = updated.longTermKnowledge ?? []

  // L0 -> L1: Aggregate ALL missed weeks (not just the last one)
  if (crossedWeekBoundary(updated.lastWeeklyAggregation, now)) {
    const currentWeekStart = getWeekStart(now)
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

  // L1 -> L2: Aggregate ALL missed months (not just the last one)
  if (crossedMonthBoundary(updated.lastMonthlyAggregation, now)) {
    const currentMonth = formatMonth(now)
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

  // L2 -> L3: Check if we need to extract long-term knowledge
  if (crossedKnowledgeExtractionBoundary(updated.lastKnowledgeExtraction, now)) {
    log("[aggregation] extracting long-term knowledge")

    updated.longTermKnowledge = await extractLongTermKnowledge(
      updated.monthlySummaries,
      updated.longTermKnowledge,
      summarize
    )

    // Limit knowledge entries
    updated.longTermKnowledge = updated.longTermKnowledge.slice(
      0,
      config.long_term_knowledge_limit
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
