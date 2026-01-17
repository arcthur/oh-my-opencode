/**
 * LLM Prompt Templates for Hierarchical Memory Aggregation
 *
 * These prompts are used to summarize work history at different time scales.
 * The summarization is performed by the hook using the available LLM client.
 */

import type { WorkHistoryEntry, WeeklySummary, MonthlySummary } from "./types"
import type { SummarizationResponse } from "./aggregation"

// ============================================================================
// Prompt Templates
// ============================================================================

/**
 * System prompt for all summarization tasks
 */
export const SUMMARIZATION_SYSTEM_PROMPT = `You are a helpful assistant that summarizes work history for developers.
Your goal is to create concise, actionable summaries that capture key accomplishments and lessons learned.
Always respond in valid JSON format.`

/**
 * Build prompt for weekly summarization (L0 -> L1)
 */
export function buildWeeklySummaryPrompt(entries: WorkHistoryEntry[]): string {
  const entriesText = entries
    .map((e) => {
      const date = new Date(e.timestamp).toLocaleDateString()
      const outcome = e.outcome ? ` [${e.outcome}]` : ""
      const project = e.project ? ` (${e.project})` : ""
      const files = e.filesModified?.length
        ? ` - ${e.filesModified.length} files`
        : ""
      return `- [${date}]${project}${outcome}: ${e.summary}${files}`
    })
    .join("\n")

  return `Summarize the following work history entries from one week.

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

  return `Summarize the following weekly summaries from one month.

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
export function buildKnowledgeExtractionPrompt(
  monthlySummaries: MonthlySummary[]
): string {
  const summariesText = monthlySummaries
    .map((m) => {
      return `${m.month}:
  Summary: ${m.summary}
  Projects: ${m.projects.join(", ")}
  Lessons: ${m.lessonsLearned.join("; ") || "none"}`
    })
    .join("\n\n")

  return `Analyze the following monthly summaries and extract long-term knowledge.

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

// ============================================================================
// Response Parsing
// ============================================================================

/**
 * Parse the LLM response for weekly/monthly summarization
 */
export function parseSummarizationResponse(
  response: string
): SummarizationResponse {
  try {
    // Try to extract JSON from the response
    const jsonMatch = response.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      throw new Error("No JSON found in response")
    }

    const parsed = JSON.parse(jsonMatch[0])

    return {
      summary: parsed.summary || "",
      achievements: Array.isArray(parsed.achievements)
        ? parsed.achievements
        : [],
      lessons: Array.isArray(parsed.lessons) ? parsed.lessons : [],
      techEvolution: parsed.techEvolution,
    }
  } catch (error) {
    // Return a default response if parsing fails
    return {
      summary: response.slice(0, 500),
      achievements: [],
      lessons: [],
    }
  }
}

/**
 * Knowledge extraction response structure
 */
export interface KnowledgeExtractionResponse {
  knowledge: Array<{
    category: "lesson" | "pattern" | "preference" | "skill"
    content: string
    confidence: number
    sourceMonths: string[]
  }>
}

/**
 * Parse the LLM response for knowledge extraction
 */
export function parseKnowledgeExtractionResponse(
  response: string
): KnowledgeExtractionResponse {
  try {
    const jsonMatch = response.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      throw new Error("No JSON found in response")
    }

    const parsed = JSON.parse(jsonMatch[0])

    return {
      knowledge: Array.isArray(parsed.knowledge)
        ? parsed.knowledge.map((k: Record<string, unknown>) => ({
            category: k.category || "lesson",
            content: String(k.content || ""),
            confidence: Number(k.confidence) || 0.5,
            sourceMonths: Array.isArray(k.sourceMonths) ? k.sourceMonths : [],
          }))
        : [],
    }
  } catch (error) {
    return { knowledge: [] }
  }
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
): SummarizationResponse {
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
): SummarizationResponse {
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

// ============================================================================
// Semantic Clustering Prompts
// ============================================================================

/**
 * Build prompt to check if two insights should be merged
 */
export function buildMergeDecisionPrompt(
  insight1: string,
  insight2: string
): string {
  return `Determine if these two insights describe the SAME underlying lesson or pattern.
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

/**
 * Parse merge decision response
 */
export interface MergeDecisionResponse {
  same_insight: boolean
  reason?: string
  merged_content?: string
}

export function parseMergeDecisionResponse(
  response: string
): MergeDecisionResponse {
  try {
    const jsonMatch = response.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      return { same_insight: false }
    }

    const parsed = JSON.parse(jsonMatch[0])
    return {
      same_insight: Boolean(parsed.same_insight),
      reason: parsed.reason,
      merged_content: parsed.merged_content,
    }
  } catch {
    return { same_insight: false }
  }
}

