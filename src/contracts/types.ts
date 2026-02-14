import type { HookNodeId } from "../hooks/runtime/types"

export type HookPoint =
  | "chat.params"
  | "chat.message"
  | "tool.execute.before"
  | "tool.execute.after"
  | "experimental.chat.messages.transform"
  | "experimental.session.compacting"

export type Enforcement = "hard" | "soft" | "audit"

export type ConditionExpr = Record<string, unknown>

export interface ActionExpr {
  type: "allow" | "deny" | "modify" | "audit"
  mutation?: Record<string, unknown>
  message?: string
}

export interface ContractClause {
  id: string
  description: string
  hookPoints: HookPoint[]
  enforcement: Enforcement
  selector: {
    toolName?: string | string[]
    agent?: string
    sessionTags?: string[]
  }
  condition: ConditionExpr
  action: ActionExpr
  priority: number
  conflictResolution: "first-match" | "most-restrictive" | "merge"
  enabled: boolean
  version: number
  provenance: {
    author: string
    source: string
    createdAt: number
  }
  reasonCode: string
}

export interface ExecutionContract {
  taskId: string
  clauses: ContractClause[]
  defaultConflictResolution: "first-match" | "most-restrictive"
  budgets: {
    contextProfile: "profile_400" | "profile_600"
    contextTokensTarget: number
    contextTokensHardLimit: number
    reasoningBudget: "low" | "medium" | "high"
    maxToolCalls: number
    wallClockMs: number
  }
  modelPolicy: {
    primary: "openai/gpt-5.3-codex"
    providerPriority: Array<"openai" | "google" | "anthropic">
    allowFallback: true
    minContextWindow: 400000 | 600000
  }
}

export interface PolicyEventInput {
  hookPoint: HookPoint
  sessionID: string
  toolName?: string
  agent?: string
  sessionTags?: string[]
  payload?: Record<string, unknown>
  traceNodeId?: string
  traceHookNodeId?: HookNodeId | "internal:policy-observe:chat.params" | "internal:policy-enforce:chat.params"
}

export interface PolicyDecision {
  decisionId: string
  clauseId: string
  matchedClauseIds: string[]
  hookPoint: HookPoint
  enforcement: Enforcement
  decision: "allow" | "deny" | "modify" | "audit"
  mutation?: Record<string, unknown>
  message?: string
  reasonCode: string
  timestamp: number
  trace: {
    hookNodeId: HookNodeId | "internal:policy-observe:chat.params" | "internal:policy-enforce:chat.params"
    traceNodeId?: string
    sessionID: string
    toolName?: string
  }
}

export interface ContractConfig {
  clauses: ContractClause[]
  conflictResolution: "first-match" | "most-restrictive"
}

export interface BudgetProfile {
  contextTokensTarget: number
  contextTokensHardLimit: number
  reasoningBudget: "low" | "medium" | "high"
  maxToolCalls: number
  wallClockMs: number
}

export interface EvaluatorConfig {
  enabled: boolean
  async: boolean
  metrics: string[]
}
