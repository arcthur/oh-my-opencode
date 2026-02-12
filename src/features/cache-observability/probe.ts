export type CacheUsageConfidence = "high" | "medium" | "low"

export interface CacheUsageSnapshot {
  inputTokens: number
  outputTokens: number
  totalTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  effectiveInputTokens: number
  cacheHitRatio: number
  includesCacheInInput: boolean
  confidence: CacheUsageConfidence
  source: string
}

interface NumberCandidate {
  path: string
  includesCacheInInput?: boolean
}

interface MatchedNumber {
  value: number
  path: string
  includesCacheInInput: boolean
}

const INPUT_CANDIDATES: NumberCandidate[] = [
  { path: "tokens.input", includesCacheInInput: false },
  { path: "usage.input_tokens", includesCacheInInput: false },
  { path: "usage.prompt_tokens", includesCacheInInput: true },
  { path: "usage.promptTokenCount", includesCacheInInput: true },
  { path: "usageMetadata.promptTokenCount", includesCacheInInput: true },
  { path: "input_tokens", includesCacheInInput: false },
  { path: "prompt_tokens", includesCacheInInput: true },
]

const OUTPUT_CANDIDATES: NumberCandidate[] = [
  { path: "tokens.output" },
  { path: "usage.output_tokens" },
  { path: "usage.completion_tokens" },
  { path: "usage.candidatesTokenCount" },
  { path: "usageMetadata.candidatesTokenCount" },
  { path: "output_tokens" },
  { path: "completion_tokens" },
]

const TOTAL_CANDIDATES: NumberCandidate[] = [
  { path: "tokens.total" },
  { path: "usage.total_tokens" },
  { path: "usage.totalTokenCount" },
  { path: "usageMetadata.totalTokenCount" },
  { path: "total_tokens" },
]

const CACHE_READ_CANDIDATES: NumberCandidate[] = [
  { path: "tokens.cache.read" },
  { path: "usage.cached_input_tokens" },
  { path: "usage.cache_read_input_tokens" },
  { path: "usage.cache_read_tokens" },
  { path: "usage.prompt_tokens_details.cached_tokens" },
  { path: "usageMetadata.cachedContentTokenCount" },
  { path: "cached_input_tokens" },
  { path: "cache_read_tokens" },
]

const CACHE_WRITE_CANDIDATES: NumberCandidate[] = [
  { path: "tokens.cache.write" },
  { path: "usage.cache_creation_input_tokens" },
  { path: "usage.cache_write_tokens" },
  { path: "usage.prompt_tokens_details.cache_creation_tokens" },
  { path: "cache_creation_input_tokens" },
  { path: "cache_write_tokens" },
]

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null
  }
  return value as Record<string, unknown>
}

function readPathNumber(payload: unknown, path: string): number | undefined {
  const keys = path.split(".")
  let cursor: unknown = payload

  for (const key of keys) {
    const record = asRecord(cursor)
    if (!record || !(key in record)) {
      return undefined
    }
    cursor = record[key]
  }

  if (typeof cursor !== "number" || !Number.isFinite(cursor)) {
    return undefined
  }

  return Math.max(0, Math.floor(cursor))
}

function pickNumber(payload: unknown, candidates: NumberCandidate[]): MatchedNumber | null {
  for (const candidate of candidates) {
    const value = readPathNumber(payload, candidate.path)
    if (typeof value === "number") {
      return {
        value,
        path: candidate.path,
        includesCacheInInput: candidate.includesCacheInInput ?? false,
      }
    }
  }
  return null
}

function clamp01(value: number): number {
  if (value < 0) return 0
  if (value > 1) return 1
  return value
}

function resolveConfidence(params: {
  input: MatchedNumber | null
  output: MatchedNumber | null
  total: MatchedNumber | null
  cacheRead: MatchedNumber | null
}): CacheUsageConfidence {
  if (params.input && params.output && params.cacheRead) {
    return "high"
  }
  if ((params.input || params.total) && params.output) {
    return "medium"
  }
  return "low"
}

function buildSourceLabel(params: {
  input: MatchedNumber | null
  output: MatchedNumber | null
  total: MatchedNumber | null
  cacheRead: MatchedNumber | null
  cacheWrite: MatchedNumber | null
  inferredInputFromTotal: boolean
}): string {
  const parts: string[] = []
  if (params.input) parts.push(`input:${params.input.path}`)
  if (params.output) parts.push(`output:${params.output.path}`)
  if (params.total) parts.push(`total:${params.total.path}`)
  if (params.cacheRead) parts.push(`cacheRead:${params.cacheRead.path}`)
  if (params.cacheWrite) parts.push(`cacheWrite:${params.cacheWrite.path}`)
  if (params.inferredInputFromTotal) parts.push("input:inferred-from-total")
  if (parts.length === 0) {
    return "unavailable"
  }
  return parts.join(",")
}

export function extractCacheUsageSnapshot(payload: unknown): CacheUsageSnapshot {
  const input = pickNumber(payload, INPUT_CANDIDATES)
  const output = pickNumber(payload, OUTPUT_CANDIDATES)
  const total = pickNumber(payload, TOTAL_CANDIDATES)
  const cacheRead = pickNumber(payload, CACHE_READ_CANDIDATES)
  const cacheWrite = pickNumber(payload, CACHE_WRITE_CANDIDATES)

  let inputTokens = input?.value ?? 0
  const outputTokens = output?.value ?? 0
  const cacheReadTokens = cacheRead?.value ?? 0
  const cacheWriteTokens = cacheWrite?.value ?? 0
  const includesCacheInInput = input?.includesCacheInInput ?? false
  let inferredInputFromTotal = false

  if (!input && total && total.value > 0) {
    inputTokens = Math.max(0, total.value - outputTokens)
    inferredInputFromTotal = true
  }

  let effectiveInputTokens = includesCacheInInput
    ? inputTokens
    : inputTokens + cacheReadTokens

  if (effectiveInputTokens === 0 && cacheReadTokens > 0) {
    effectiveInputTokens = cacheReadTokens
  }

  const totalTokens =
    total?.value ?? Math.max(0, effectiveInputTokens + outputTokens)
  const cacheHitRatio =
    effectiveInputTokens > 0 ? clamp01(cacheReadTokens / effectiveInputTokens) : 0

  return {
    inputTokens,
    outputTokens,
    totalTokens,
    cacheReadTokens,
    cacheWriteTokens,
    effectiveInputTokens,
    cacheHitRatio,
    includesCacheInInput,
    confidence: resolveConfidence({ input, output, total, cacheRead }),
    source: buildSourceLabel({
      input,
      output,
      total,
      cacheRead,
      cacheWrite,
      inferredInputFromTotal,
    }),
  }
}

