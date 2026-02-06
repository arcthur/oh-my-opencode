/**
 * Session Handoff Summarizer
 *
 * LLM integration for handoff extraction with:
 * - Circuit breaker pattern for fault tolerance
 * - Session reuse for efficiency
 */

import type { PluginInput } from "@opencode-ai/plugin"
import type { CategoriesConfig } from "../../config/schema"
import type { SessionHandoffConfig, ExtractorConfig } from "./types"
import { log } from "../../shared/logger"

// ============================================================================
// Types
// ============================================================================

export type CircuitState = "closed" | "open" | "half-open"

interface CircuitBreakerState {
  state: CircuitState
  failureCount: number
  lastFailureTime: number
  nextRetryTime: number
}

export interface HandoffSummarizer {
  callLLM: (prompt: string, systemPrompt: string, model: string) => Promise<string>
  getCircuitState: () => CircuitState
  resetCircuit: () => void
}

// ============================================================================
// Circuit Breaker Configuration
// ============================================================================

const CIRCUIT_BREAKER_CONFIG = {
  /** Number of failures before opening circuit */
  failureThreshold: 3,
  /** Time in ms before attempting recovery (30 seconds) */
  resetTimeout: 30_000,
} as const

// ============================================================================
// Model Resolution
// ============================================================================

const MODEL_MAP: Record<ExtractorConfig["model"], { providerID: string; modelID: string }> = {
  haiku: { providerID: "anthropic", modelID: "claude-3-5-haiku-latest" },
  sonnet: { providerID: "anthropic", modelID: "claude-sonnet-4-20250514" },
  opus: { providerID: "anthropic", modelID: "claude-opus-4-20250514" },
}

function resolveModel(
  model: ExtractorConfig["model"],
  categories?: CategoriesConfig
): { providerID: string; modelID: string } {
  // Check for quick category override
  if (categories?.quick?.model) {
    const [providerID, modelID] = categories.quick.model.split("/")
    if (providerID && modelID) {
      return { providerID, modelID }
    }
  }

  return MODEL_MAP[model]
}

// ============================================================================
// Factory Function
// ============================================================================

export interface CreateHandoffSummarizerOptions {
  categories?: CategoriesConfig
}

/**
 * Create a handoff summarizer for LLM-based extraction
 */
export function createHandoffSummarizer(
  ctx: PluginInput,
  config: SessionHandoffConfig,
  options?: CreateHandoffSummarizerOptions
): HandoffSummarizer | undefined {
  const sessionApi = ctx?.client?.session
  if (!sessionApi?.create || !sessionApi?.prompt || !sessionApi?.messages) {
    log("[session-handoff] Session API not available, summarizer disabled")
    return undefined
  }

  // Session ID for reuse
  let currentSessionId: string | null = null

  // Circuit breaker state
  const circuitBreaker: CircuitBreakerState = {
    state: "closed",
    failureCount: 0,
    lastFailureTime: 0,
    nextRetryTime: 0,
  }

  const shouldAllowRequest = (): boolean => {
    const now = Date.now()

    switch (circuitBreaker.state) {
      case "closed":
        return true

      case "open":
        if (now >= circuitBreaker.nextRetryTime) {
          circuitBreaker.state = "half-open"
          log("[session-handoff] circuit breaker half-open, allowing probe request")
          return true
        }
        return false

      case "half-open":
        return true
    }
  }

  const recordSuccess = (): void => {
    if (circuitBreaker.state === "half-open") {
      log("[session-handoff] circuit breaker recovered, closing")
    }
    circuitBreaker.state = "closed"
    circuitBreaker.failureCount = 0
  }

  const recordFailure = (error: unknown): void => {
    const now = Date.now()
    circuitBreaker.failureCount++
    circuitBreaker.lastFailureTime = now

    if (circuitBreaker.state === "half-open") {
      circuitBreaker.state = "open"
      circuitBreaker.nextRetryTime = now + CIRCUIT_BREAKER_CONFIG.resetTimeout
      log("[session-handoff] circuit breaker re-opened after half-open failure", {
        error: String(error),
      })
      return
    }

    if (circuitBreaker.failureCount >= CIRCUIT_BREAKER_CONFIG.failureThreshold) {
      circuitBreaker.state = "open"
      circuitBreaker.nextRetryTime = now + CIRCUIT_BREAKER_CONFIG.resetTimeout
      log("[session-handoff] circuit breaker opened", {
        failureCount: circuitBreaker.failureCount,
        nextRetryTime: new Date(circuitBreaker.nextRetryTime).toISOString(),
      })
    } else {
      log("[session-handoff] summarizer failure recorded", {
        failureCount: circuitBreaker.failureCount,
        threshold: CIRCUIT_BREAKER_CONFIG.failureThreshold,
        error: String(error),
      })
    }
  }

  const getOrCreateSession = async (): Promise<string> => {
    if (currentSessionId) {
      return currentSessionId
    }

    const createResult = await sessionApi.create({
      body: { title: "session-handoff:extractor" },
      query: { directory: ctx.directory },
    })

    const sessionId = createResult?.data?.id
    if (!sessionId) {
      throw new Error("Failed to create handoff extraction session")
    }

    currentSessionId = sessionId
    log("[session-handoff] created extraction session", { sessionId })

    return sessionId
  }

  const extractAssistantText = (messages: unknown): string | null => {
    if (!Array.isArray(messages)) return null

    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i]
      if (msg?.role === "assistant") {
        // Handle parts array
        if (Array.isArray(msg.parts)) {
          for (const part of msg.parts) {
            if (part?.type === "text" && typeof part.text === "string") {
              return part.text
            }
          }
        }
        // Handle direct content
        if (typeof msg.content === "string") {
          return msg.content
        }
      }
    }

    return null
  }

  const callLLM = async (
    prompt: string,
    systemPrompt: string,
    modelName: string
  ): Promise<string> => {
    if (!shouldAllowRequest()) {
      throw new CircuitOpenError(
        `Circuit breaker open, next retry at ${new Date(circuitBreaker.nextRetryTime).toISOString()}`
      )
    }

    const model = resolveModel(
      modelName as ExtractorConfig["model"],
      options?.categories
    )

    try {
      const sessionId = await getOrCreateSession()

      await sessionApi.prompt({
        path: { id: sessionId },
        body: {
          model,
          tools: {
            // Disable all tools for extraction
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
          parts: [{ type: "text", text: `${systemPrompt}\n\n${prompt}` }],
        },
      })

      const messagesResult = await sessionApi.messages({ path: { id: sessionId } })
      const messages = (messagesResult as { data?: unknown }).data ?? messagesResult

      const text = extractAssistantText(messages)
      if (!text) {
        throw new Error("No assistant response found for extraction")
      }

      recordSuccess()
      return text
    } catch (error) {
      recordFailure(error)
      throw error
    }
  }

  return {
    callLLM,
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
