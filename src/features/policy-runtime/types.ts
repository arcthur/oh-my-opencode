import type { HookNodeId } from "../../hooks/runtime/types"
import type { HookPoint, PolicyDecision } from "../../contracts"

export interface ObservedEvent {
  observedId: string
  timestamp: number
  sessionID: string
  hookPoint: HookPoint
  toolName?: string
  agent?: string
  payload?: Record<string, unknown>
  traceHookNodeId:
    | HookNodeId
    | "internal:policy-observe:chat.params"
    | "internal:policy-enforce:chat.params"
}

export interface DecisionEvent {
  decisionEventId: string
  timestamp: number
  sessionID: string
  decision: PolicyDecision
}

export interface OutcomeEvent {
  outcomeEventId: string
  timestamp: number
  sessionID: string
  decisionId: string
  clauseId: string
  hookPoint: HookPoint
  toolName?: string
  outcome: "applied" | "blocked" | "skipped" | "error" | "superseded"
  message?: string
  traceNodeId?: string
}

export interface PolicyEventWriter {
  appendObserved(event: ObservedEvent): void
  appendDecision(event: DecisionEvent): void
  appendOutcome(event: OutcomeEvent): void
}

export interface PolicyObservedLedgerEntry {
  id: string
  sessionID: string
  timestamp: number
  previousHash: string
  hash: string
  type: "observed"
  observed: ObservedEvent
}

export type PolicyLedgerEntry = PolicyObservedLedgerEntry
