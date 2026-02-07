export type BudgetPriority = "critical" | "high" | "normal" | "low"

export type ContextChannel =
  | "messages-transform"
  | "tool-output"
  | "chat-message"
  | "delegate-prompt"
  | "synthetic-message"
  | "session-prompt"

export interface BudgetRequest {
  sessionID: string
  source: string
  channel: ContextChannel
  id: string
  priority: BudgetPriority
  content: string
  oncePerSession?: boolean
  estimatedTokens?: number
}

export type BudgetDecisionReason =
  | "accepted"
  | "truncated"
  | "dropped_total"
  | "dropped_source"
  | "dropped_channel"
  | "once_per_session"

export interface BudgetDecision {
  accepted: boolean
  finalContent: string
  finalTokens: number
  reason: BudgetDecisionReason
}

export interface ContextBudgetConfig {
  total_budget: number
  source_limits?: Record<string, number>
  channel_limits?: Partial<Record<ContextChannel, number>>
  reserved_budget: number
  overflow_strategy: "truncate" | "drop-low-priority"
}
