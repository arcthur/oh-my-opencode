/**
 * LLM Prompt Templates for Hierarchical Memory Aggregation
 *
 * These prompts are used to summarize work history at different time scales.
 * Response parsing is delegated to schemas.ts for type safety.
 */

import type { WorkHistoryEntry, WeeklySummary, MonthlySummary } from "./types"
import {
  PROMPT_TAGS,
  parseWeeklySummarization,
  parseMonthlySummarization,
  parseKnowledgeExtraction,
  parseMergeDecision,
  type WeeklySummarizationResponse,
  type MonthlySummarizationResponse,
  type KnowledgeExtractionResponse,
  type MergeDecisionResponse,
} from "./schemas"

// Re-export parsing functions from schemas
export {
  PROMPT_TAGS,
  parseWeeklySummarization as parseSummarizationResponse,
  parseKnowledgeExtraction as parseKnowledgeExtractionResponse,
  parseMergeDecision as parseMergeDecisionResponse,
  type WeeklySummarizationResponse as SummarizationResponse,
  type KnowledgeExtractionResponse,
  type MergeDecisionResponse,
}

// ============================================================================
// System Prompt
// ============================================================================

export const SUMMARIZATION_SYSTEM_PROMPT = `You are a helpful assistant that summarizes work history for developers.
Your goal is to create concise, actionable summaries that capture key accomplishments and lessons learned.
Always respond in valid JSON format.`

// ============================================================================
// Prompt Builders
// ============================================================================

/**
 * Build prompt for weekly summarization (L0 -> L1)
 */
export function buildWeeklySummaryPrompt(entries: WorkHistoryEntry[]): string {
  const entriesText = entries
    .map((e) => {
      const date = new Date(e.timestamp).toLocaleDateString()
      const outcome = e.outcome ? ` [${e.outcome}]` : ""
      const project = e.project ? ` (${e.project})` : ""
      const files = e.filesModified?.length ? ` - ${e.filesModified.length} files` : ""
      return `- [${date}]${project}${outcome}: ${e.summary}${files}`
    })
    .join("\n")

  return `${PROMPT_TAGS.weekly}
Summarize the following work history entries from one week.

Work entries:
${entriesText}

Respond with a JSON object containing:
{
  "summary": "A concise 2-3 sentence summary of the week's work",
  "achievements": ["achievement 1", "achievement 2", ...], // 2-4 key achievements
  "lessons": ["lesson 1", ...] // 0-2 lessons learned (only if clearly evident)
}

Focus on what was accomplished and any patterns in the work. Be specific about technologies and outcomes.`
}

/**
 * Build prompt for monthly summarization (L1 -> L2)
 */
export function buildMonthlySummaryPrompt(weeks: WeeklySummary[]): string {
  const weeksText = weeks
    .map((w, i) => {
      const startDate = new Date(w.weekStart).toLocaleDateString()
      return `Week ${i + 1} (${startDate}):
  Summary: ${w.summary}
  Projects: ${w.projects.join(", ") || "various"}
  Achievements: ${w.keyAchievements.join("; ") || "none recorded"}
  Tech: ${w.techStack.join(", ") || "various"}`
    })
    .join("\n\n")

  return `${PROMPT_TAGS.monthly}
Summarize the following weekly summaries from one month.

${weeksText}

Respond with a JSON object containing:
{
  "summary": "A concise 3-4 sentence summary of the month's work and progress",
  "achievements": ["achievement 1", ...], // 3-5 key achievements across the month
  "lessons": ["lesson 1", ...], // 1-3 consolidated lessons learned
  "techEvolution": "Brief description of technology stack changes or new tools adopted"
}

Focus on trends, major accomplishments, and growth patterns. Identify recurring themes.`
}

/**
 * Build prompt for knowledge extraction (L2 -> L3)
 */
export function buildKnowledgeExtractionPrompt(monthlySummaries: MonthlySummary[]): string {
  const summariesText = monthlySummaries
    .map((m) => {
      return `${m.month}:
  Summary: ${m.summary}
  Projects: ${m.projects.join(", ")}
  Lessons: ${m.lessonsLearned.join("; ") || "none"}`
    })
    .join("\n\n")

  return `${PROMPT_TAGS.knowledge}
Analyze the following monthly summaries and extract long-term knowledge.

${summariesText}

Identify patterns that appear across multiple months. Extract knowledge that would be valuable to remember long-term.

Respond with a JSON object containing:
{
  "knowledge": [
    {
      "category": "lesson" | "pattern" | "preference" | "skill",
      "content": "The distilled knowledge or insight",
      "confidence": 0.0-1.0, // Based on how often this appeared
      "sourceMonths": ["2024-01", ...] // Which months contributed
    },
    ...
  ]
}

Focus on:
- Recurring lessons that apply broadly
- Work patterns that emerged
- Skills that were developed
- Preferences that became clear

Only include high-confidence insights that appeared in at least 2 months.`
}

/**
 * Build prompt to check if two insights should be merged
 */
export function buildMergeDecisionPrompt(insight1: string, insight2: string): string {
  return `${PROMPT_TAGS.merge}
Determine if these two insights describe the SAME underlying lesson or pattern.
They may use different words but convey the same idea.

Insight A: "${insight1}"

Insight B: "${insight2}"

Respond with a JSON object:
{
  "same_insight": true | false,
  "reason": "Brief explanation",
  "merged_content": "If same_insight is true, provide a merged version that captures both"
}

Examples of insights that SHOULD be merged:
- "Use snake_case for API fields" and "REST endpoints should use underscores" (same naming convention)
- "Always write tests first" and "TDD helps catch bugs early" (same testing practice)

Examples of insights that should NOT be merged:
- "Use TypeScript for type safety" and "Use TypeScript for better IDE support" (different reasons)
- "Prefer composition over inheritance" and "Use mixins for code reuse" (related but different patterns)`
}

// ============================================================================
// Fallback Summarization (No LLM)
// ============================================================================

/**
 * Create a basic weekly summary without LLM
 */
export function fallbackWeeklySummary(
  entries: WorkHistoryEntry[],
  projects: string[],
  techStack: string[]
): WeeklySummarizationResponse {
  const successfulEntries = entries.filter((e) => e.outcome === "success")
  const achievements = successfulEntries.slice(0, 3).map((e) => e.summary)

  let summary = `Completed ${entries.length} work sessions`
  if (projects.length > 0) {
    summary += ` across ${projects.length} project${projects.length > 1 ? "s" : ""}`
  }
  if (techStack.length > 0) {
    summary += ` using ${techStack.slice(0, 3).join(", ")}`
  }
  summary += "."

  return {
    summary,
    achievements,
    lessons: [],
  }
}

/**
 * Create a basic monthly summary without LLM
 */
export function fallbackMonthlySummary(
  weeks: WeeklySummary[],
  projects: string[],
  allTechStack: string[]
): MonthlySummarizationResponse {
  const totalEntries = weeks.reduce((sum, w) => sum + w.entryCount, 0)
  const allAchievements = weeks.flatMap((w) => w.keyAchievements)

  let summary = `Completed ${totalEntries} work sessions across ${weeks.length} weeks`
  if (projects.length > 0) {
    summary += ` in ${projects.slice(0, 3).join(", ")}`
    if (projects.length > 3) summary += ` and ${projects.length - 3} other projects`
  }
  summary += "."

  return {
    summary,
    achievements: allAchievements.slice(0, 5),
    lessons: weeks.flatMap((w) => w.lessonsLearned).slice(0, 3),
    techEvolution: allTechStack.join(", "),
  }
}
