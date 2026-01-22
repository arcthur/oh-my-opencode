/**
 * Zod schemas for User Memory LLM responses
 *
 * All LLM interactions use validated schemas for type safety and error handling.
 */

import { z } from "zod/v4"

// ============================================================================
// Prompt Tags (Unified)
// ============================================================================

export const PROMPT_TAGS = {
  weekly: "[UserMemory:Weekly]",
  monthly: "[UserMemory:Monthly]",
  merge: "[UserMemory:MergeDecision]",
  knowledge: "[UserMemory:Knowledge]",
} as const

export type PromptKind = keyof typeof PROMPT_TAGS

export function detectPromptKind(prompt: string): PromptKind | "unknown" {
  for (const [kind, tag] of Object.entries(PROMPT_TAGS)) {
    if (prompt.includes(tag)) return kind as PromptKind
  }
  return "unknown"
}

// ============================================================================
// Weekly Summarization Schema
// ============================================================================

export const WeeklySummarizationResponseSchema = z.object({
  summary: z.string().min(1).describe("Concise 2-3 sentence summary of the week's work"),
  achievements: z.array(z.string()).default([]).describe("2-4 key achievements"),
  lessons: z.array(z.string()).default([]).describe("0-2 lessons learned"),
})

export type WeeklySummarizationResponse = z.infer<typeof WeeklySummarizationResponseSchema>

// ============================================================================
// Monthly Summarization Schema
// ============================================================================

export const MonthlySummarizationResponseSchema = z.object({
  summary: z.string().min(1).describe("Concise 3-4 sentence summary of the month's work"),
  achievements: z.array(z.string()).default([]).describe("3-5 key achievements"),
  lessons: z.array(z.string()).default([]).describe("1-3 consolidated lessons"),
  techEvolution: z.string().optional().describe("Technology stack evolution description"),
})

export type MonthlySummarizationResponse = z.infer<typeof MonthlySummarizationResponseSchema>

// ============================================================================
// Knowledge Extraction Schema
// ============================================================================

export const KnowledgeCategory = z.enum(["lesson", "pattern", "preference", "skill"])

export const ExtractedKnowledgeSchema = z.object({
  category: KnowledgeCategory,
  content: z.string().min(1),
  confidence: z.number().min(0).max(1),
  sourceMonths: z.array(z.string()),
})

export const KnowledgeExtractionResponseSchema = z.object({
  knowledge: z.array(ExtractedKnowledgeSchema).default([]),
})

export type KnowledgeExtractionResponse = z.infer<typeof KnowledgeExtractionResponseSchema>

// ============================================================================
// Merge Decision Schema
// ============================================================================

export const MergeDecisionResponseSchema = z.object({
  same_insight: z.boolean(),
  reason: z.string().optional(),
  merged_content: z.string().optional(),
})

export type MergeDecisionResponse = z.infer<typeof MergeDecisionResponseSchema>

// ============================================================================
// Session API Response Schemas
// ============================================================================

export const SessionMessagePartSchema = z.object({
  type: z.string(),
  text: z.string().optional(),
})

export const SessionMessageSchema = z.object({
  info: z
    .object({
      role: z.string().optional(),
      time: z
        .object({
          created: z.number().optional(),
        })
        .optional(),
    })
    .optional(),
  parts: z.array(SessionMessagePartSchema).optional(),
})

export const SessionMessagesResponseSchema = z.array(SessionMessageSchema)

// ============================================================================
// Parsing Utilities
// ============================================================================

/**
 * Extract JSON from LLM response (handles markdown code blocks)
 */
export function extractJson(response: string): string | null {
  // Try to find JSON in code block first
  const codeBlockMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (codeBlockMatch) {
    return codeBlockMatch[1].trim()
  }

  // Try to find raw JSON object
  const jsonMatch = response.match(/\{[\s\S]*\}/)
  return jsonMatch?.[0] ?? null
}

/**
 * Parse and validate LLM response with schema
 */
export function parseWithSchema<T>(
  response: string,
  schema: z.ZodType<T>,
  fallback: T
): { data: T; error: string | null } {
  const json = extractJson(response)
  if (!json) {
    return { data: fallback, error: "No JSON found in response" }
  }

  try {
    const parsed = JSON.parse(json)
    const result = schema.safeParse(parsed)
    if (result.success) {
      return { data: result.data, error: null }
    }
    return { data: fallback, error: result.error.message }
  } catch (e) {
    return { data: fallback, error: `JSON parse error: ${e}` }
  }
}

/**
 * Parse weekly summarization response
 */
export function parseWeeklySummarization(response: string): WeeklySummarizationResponse {
  const { data } = parseWithSchema(response, WeeklySummarizationResponseSchema, {
    summary: response.slice(0, 500),
    achievements: [],
    lessons: [],
  })
  return data
}

/**
 * Parse monthly summarization response
 */
export function parseMonthlySummarization(response: string): MonthlySummarizationResponse {
  const { data } = parseWithSchema(response, MonthlySummarizationResponseSchema, {
    summary: response.slice(0, 500),
    achievements: [],
    lessons: [],
  })
  return data
}

/**
 * Parse knowledge extraction response
 */
export function parseKnowledgeExtraction(response: string): KnowledgeExtractionResponse {
  const { data } = parseWithSchema(response, KnowledgeExtractionResponseSchema, {
    knowledge: [],
  })
  return data
}

/**
 * Parse merge decision response
 */
export function parseMergeDecision(response: string): MergeDecisionResponse {
  const { data } = parseWithSchema(response, MergeDecisionResponseSchema, {
    same_insight: false,
  })
  return data
}

/**
 * Extract assistant text from session messages with schema validation
 */
export function extractAssistantText(messages: unknown): string | null {
  const result = SessionMessagesResponseSchema.safeParse(messages)
  if (!result.success) return null

  const assistantMessages = result.data
    .filter((m) => m.info?.role === "assistant")
    .sort((a, b) => (b.info?.time?.created ?? 0) - (a.info?.time?.created ?? 0))

  const lastAssistant = assistantMessages[0]
  if (!lastAssistant?.parts) return null

  const textParts = lastAssistant.parts.filter((p) => p.type === "text" || p.type === "reasoning")
  const text = textParts
    .map((p) => p.text ?? "")
    .filter(Boolean)
    .join("\n")
    .trim()

  return text.length > 0 ? text : null
}

/**
 * Parse month string to timestamp (with validation)
 */
export function parseMonthToTimestamp(month: string): number | null {
  // Expected format: YYYY-MM
  if (!/^\d{4}-\d{2}$/.test(month)) return null

  const date = new Date(`${month}-01T00:00:00Z`)
  if (isNaN(date.getTime())) return null

  return date.getTime()
}
