import type {
  BudgetPriority,
  ContextBudgetConfig as SharedContextBudgetConfig,
  ContextChannel,
} from "../context-view"

/**
 * Source identifier for context injection
 * Each source registers context that will be merged and injected together
 */
export type KnownContextSourceType =
  | "keyword-detector"
  | "work-orchestrator"
  | "rules-injector"
  | "directory-agents"
  | "directory-readme"
  | "user-memory"
  | "org-memory"
  | "session-handoff"
  | "repo-overview-injector"
  | "context-manifest-injector"
  | "hook-message-injector"
  | "claude-code-hooks"
  | "governance"
  | "conditional-rules"
  | "custom"

export type ContextSourceType = KnownContextSourceType | (string & {})

/**
 * Priority levels for context ordering
 * Higher priority contexts appear first in the merged output
 */
export type ContextPriority = BudgetPriority

/**
 * A single context entry registered by a source
 */
export interface ContextEntry {
  /** Unique identifier for this entry within the source */
  id: string
  /** The source that registered this context */
  source: ContextSourceType
  /** The actual context content to inject */
  content: string
  /** Priority for ordering (default: normal) */
  priority: ContextPriority
  /** Timestamp when registered */
  timestamp: number
  /** Optional metadata for debugging/logging */
  metadata?: Record<string, unknown>
}

/**
 * Options for registering context
 */
export interface RegisterContextOptions {
  /** Unique ID for this context entry (used for deduplication) */
  id: string
  /** Source identifier */
  source: ContextSourceType
  /** The content to inject */
  content: string
  /** Priority for ordering (default: normal) */
  priority?: ContextPriority
  /** Optional metadata */
  metadata?: Record<string, unknown>
  /** Injection channel for budget tracking (default: messages-transform) */
  channel?: ContextChannel
  /** Estimated token count for budget tracking */
  estimatedTokens?: number
  /** Whether this context should only be injected once per session */
  oncePerSession?: boolean
  /** Ledger immutability hint for prefix compilation */
  immutable?: boolean
}

/**
 * Result of getting pending context for a session
 */
export interface PendingContext {
  /** Merged context string, ready for injection */
  merged: string
  /** Individual entries that were merged */
  entries: ContextEntry[]
  /** Whether there's any content to inject */
  hasContent: boolean
}

/**
 * Message context from the original user message
 * Used when injecting to match the message format
 */
export interface MessageContext {
  agent?: string
  model?: {
    providerID?: string
    modelID?: string
  }
  path?: {
    cwd?: string
    root?: string
  }
  tools?: Record<string, boolean>
}

/**
 * Output parts from chat.message hook
 */
export interface OutputParts {
  parts: Array<{ type: string; text?: string; [key: string]: unknown }>
}

/**
 * Injection strategy
 */
export type InjectionStrategy = "prepend-parts" | "storage" | "auto"

/**
 * Budget configuration for context injection
 * Controls total token allocation across all context sources
 */
export type ContextBudgetConfig = SharedContextBudgetConfig
