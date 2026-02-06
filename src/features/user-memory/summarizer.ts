/**
 * User Memory Summarizer
 *
 * Handles LLM-based summarization with:
 * - Circuit breaker pattern for fault tolerance
 * - Session reuse with LRU eviction
 * - Typed responses via zod schemas
 */

import type { PluginInput } from "@opencode-ai/plugin"
import type { CategoriesConfig } from "../../config/schema"
import type { HierarchicalMemoryConfig } from "./types"
import {
  detectPromptKind,
  extractAssistantText,
  parseMonthlySummarization,
  parseWeeklySummarization,
  type PromptKind,
} from "./schemas"
import { SUMMARIZATION_SYSTEM_PROMPT } from "./prompts"
import { resolveUserMemoryAggregationModel } from "../../shared"
import { log } from "../../shared/logger"
import type { SummarizationResponse } from "./aggregation"

// ============================================================================
// Types
// ============================================================================

export interface SummarizerOptions {
  kind: PromptKind | "unknown"
  model: HierarchicalMemoryConfig["aggregation_model"]
}

export interface UserMemorySummarizer {
  summarize: (prompt: string, options: SummarizerOptions) => Promise<string>
  getCircuitState: () => CircuitState
  resetCircuit: () => void
}

export type CircuitState = "closed" | "open" | "half-open"

interface CircuitBreakerState {
  state: CircuitState
  failureCount: number
  lastFailureTime: number
  nextRetryTime: number
}

interface SessionEntry {
  id: string
  lastUsed: number
}

// ============================================================================
// Circuit Breaker Configuration
// ============================================================================

const CIRCUIT_BREAKER_CONFIG = {
  /** Number of failures before opening circuit */
  failureThreshold: 3,
  /** Time in ms before attempting recovery (30 seconds) */
  resetTimeout: 30_000,
  /** Max failures in half-open state before re-opening */
  halfOpenMaxFailures: 1,
} as const

// ============================================================================
// Session Pool Configuration
// ============================================================================

const SESSION_POOL_CONFIG = {
  /** Maximum sessions to keep in pool */
  maxSessions: 6,
} as const

// ============================================================================
// Factory Function
// ============================================================================

export function createUserMemorySummarizer(
  ctx: PluginInput,
  options?: { categories?: CategoriesConfig; systemDefaultModel?: string }
): UserMemorySummarizer | undefined {
  const sessionApi = ctx?.client?.session
  if (!sessionApi?.create || !sessionApi?.prompt || !sessionApi?.messages) {
    return undefined
  }

  // Session pool with LRU eviction
  const sessionPool = new Map<string, SessionEntry>()

  // Circuit breaker state
  const circuitBreaker: CircuitBreakerState = {
    state: "closed",
    failureCount: 0,
    lastFailureTime: 0,
    nextRetryTime: 0,
  }

  const resolveModel = (
    aggregationModel: HierarchicalMemoryConfig["aggregation_model"]
  ): { providerID: string; modelID: string } | undefined => {
    return resolveUserMemoryAggregationModel(aggregationModel, options?.categories, options?.systemDefaultModel)
  }

  const getSessionKey = (kind: PromptKind | "unknown", model: string): string => {
    return `${kind}:${model}`
  }

  const evictOldestSession = (): void => {
    if (sessionPool.size < SESSION_POOL_CONFIG.maxSessions) return

    let oldest: [string, SessionEntry] | null = null
    for (const entry of sessionPool.entries()) {
      if (!oldest || entry[1].lastUsed < oldest[1].lastUsed) {
        oldest = entry
      }
    }
    if (oldest) {
      sessionPool.delete(oldest[0])
      log("[user-memory] evicted session from pool", { key: oldest[0] })
    }
  }

  const getOrCreateSession = async (
    kind: PromptKind | "unknown",
    modelString: string
  ): Promise<string> => {
    const key = getSessionKey(kind, modelString)
    const existing = sessionPool.get(key)

    if (existing) {
      existing.lastUsed = Date.now()
      return existing.id
    }

    evictOldestSession()

    const createResult = await sessionApi.create({
      body: { title: `user-memory:${kind}` },
      query: { directory: ctx.directory },
    })

    const sessionId = createResult?.data?.id
    if (!sessionId) {
      throw new Error("Failed to create summarization session")
    }

    sessionPool.set(key, { id: sessionId, lastUsed: Date.now() })
    log("[user-memory] created new session", { key, sessionId })

    return sessionId
  }

  const shouldAllowRequest = (): boolean => {
    const now = Date.now()

    switch (circuitBreaker.state) {
      case "closed":
        return true

      case "open":
        if (now >= circuitBreaker.nextRetryTime) {
          circuitBreaker.state = "half-open"
          log("[user-memory] circuit breaker half-open, allowing probe request")
          return true
        }
        return false

      case "half-open":
        return true
    }
  }

  const recordSuccess = (): void => {
    if (circuitBreaker.state === "half-open") {
      log("[user-memory] circuit breaker recovered, closing")
    }
    circuitBreaker.state = "closed"
    circuitBreaker.failureCount = 0
  }

  const recordFailure = (error: unknown): void => {
    const now = Date.now()
    circuitBreaker.failureCount++
    circuitBreaker.lastFailureTime = now

    if (circuitBreaker.state === "half-open") {
      // Any failure in half-open immediately re-opens
      circuitBreaker.state = "open"
      circuitBreaker.nextRetryTime = now + CIRCUIT_BREAKER_CONFIG.resetTimeout
      log("[user-memory] circuit breaker re-opened after half-open failure", {
        error: String(error),
      })
      return
    }

    if (circuitBreaker.failureCount >= CIRCUIT_BREAKER_CONFIG.failureThreshold) {
      circuitBreaker.state = "open"
      circuitBreaker.nextRetryTime = now + CIRCUIT_BREAKER_CONFIG.resetTimeout
      log("[user-memory] circuit breaker opened", {
        failureCount: circuitBreaker.failureCount,
        nextRetryTime: new Date(circuitBreaker.nextRetryTime).toISOString(),
      })
    } else {
      log("[user-memory] summarizer failure recorded", {
        failureCount: circuitBreaker.failureCount,
        threshold: CIRCUIT_BREAKER_CONFIG.failureThreshold,
        error: String(error),
      })
    }
  }

  const summarize = async (prompt: string, opts: SummarizerOptions): Promise<string> => {
    if (!shouldAllowRequest()) {
      throw new CircuitOpenError(
        `Circuit breaker open, next retry at ${new Date(circuitBreaker.nextRetryTime).toISOString()}`
      )
    }

    const model = resolveModel(opts.model)
    if (!model) {
      throw new Error(`Unable to resolve model for aggregation: ${opts.model}`)
    }

    const modelString = `${model.providerID}/${model.modelID}`

    try {
      const sessionId = await getOrCreateSession(opts.kind, modelString)

      await sessionApi.prompt({
        path: { id: sessionId },
        body: {
          model,
          tools: {
            read: false,
            write: false,
            edit: false,
            bash: false,
            glob: false,
            grep: false,
            task: false,
            delegate_task: false,
            look_at: false,
            skill: false,
            skill_mcp: false,
            slashcommand: false,
          },
          parts: [{ type: "text", text: `${SUMMARIZATION_SYSTEM_PROMPT}\n\n${prompt}` }],
        },
      })

      const messagesResult = await sessionApi.messages({ path: { id: sessionId } })
      const messages = (messagesResult as { data?: unknown }).data ?? messagesResult

      const text = extractAssistantText(messages)
      if (!text) {
        throw new Error("No assistant response found for summarization")
      }

      recordSuccess()
      return text
    } catch (error) {
      recordFailure(error)
      throw error
    }
  }

  return {
    summarize,
    getCircuitState: () => circuitBreaker.state,
    resetCircuit: () => {
      circuitBreaker.state = "closed"
      circuitBreaker.failureCount = 0
      circuitBreaker.lastFailureTime = 0
      circuitBreaker.nextRetryTime = 0
    },
  }
}

// ============================================================================
// Custom Error Types
// ============================================================================

export class CircuitOpenError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "CircuitOpenError"
  }
}

// ============================================================================
// Fallback Summarizer (No LLM)
// ============================================================================

export interface FallbackSummarizationResponse {
  summary: string
  achievements: string[]
  lessons: string[]
}

export function createFallbackSummarizer(): (prompt: string) => Promise<FallbackSummarizationResponse> {
  return async (_prompt: string) => ({
    summary: "",
    achievements: [],
    lessons: [],
  })
}

// ============================================================================
// Summarizer Adapter for Aggregation
// ============================================================================

/**
 * Creates a summarize function compatible with the aggregation module.
 * Wraps the summarizer with fallback handling and response parsing.
 */
export function createAggregationSummarizer(
  summarizer: UserMemorySummarizer | undefined,
  config: { aggregation_model: HierarchicalMemoryConfig["aggregation_model"] }
): (prompt: string) => Promise<SummarizationResponse> {
  const fallback = createFallbackSummarizer()

  return async (prompt: string) => {
    if (!summarizer) {
      return fallback(prompt)
    }

    const kind = detectPromptKind(prompt)

    try {
      const raw = await summarizer.summarize(prompt, {
        kind,
        model: config.aggregation_model,
      })

      // Parse based on prompt kind
      if (kind === "merge" || kind === "knowledge") {
        return { summary: raw, achievements: [], lessons: [] }
      }

      if (kind === "monthly") {
        return parseMonthlySummarization(raw)
      }

      return parseWeeklySummarization(raw)
    } catch (error) {
      if (error instanceof CircuitOpenError) {
        log("[user-memory] circuit open, using fallback", { kind })
      } else {
        log("[user-memory] summarizer failed, using fallback", { error: String(error), kind })
      }
      return fallback(prompt)
    }
  }
}
