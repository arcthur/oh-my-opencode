import type { GovernanceLedgerWriter } from "../governance"
import { getPolicyLedgerStore, type PolicyLedgerStore } from "./policy-ledger"
import type {
  DecisionEvent,
  ObservedEvent,
  OutcomeEvent,
  PolicyEventWriter,
} from "./types"

export interface PolicyEventWriterOptions {
  policyLedger?: PolicyLedgerStore
  resolveGovernanceLedger?: (sessionID: string) => GovernanceLedgerWriter | null
}

export class DefaultPolicyEventWriter implements PolicyEventWriter {
  private readonly policyLedger: PolicyLedgerStore
  private readonly resolveGovernanceLedger?: (sessionID: string) => GovernanceLedgerWriter | null

  constructor(options: PolicyEventWriterOptions = {}) {
    this.policyLedger = options.policyLedger ?? getPolicyLedgerStore()
    this.resolveGovernanceLedger = options.resolveGovernanceLedger
  }

  appendObserved(event: ObservedEvent): void {
    this.policyLedger.appendObserved(event)
  }

  appendDecision(event: DecisionEvent): void {
    const ledger = this.resolveGovernanceLedger?.(event.sessionID)
    if (!ledger) {
      return
    }

    ledger.logPolicyDecision({
      policy: {
        decisionId: event.decision.decisionId,
        clauseId: event.decision.clauseId,
        matchedClauseIds: event.decision.matchedClauseIds,
        hookPoint: event.decision.hookPoint,
        enforcement: event.decision.enforcement,
        decision: event.decision.decision,
        reasonCode: event.decision.reasonCode,
      },
      sessionId: event.sessionID,
      hookNodeId: event.decision.trace.hookNodeId,
      toolName: event.decision.trace.toolName,
      mutation: event.decision.mutation,
      message: event.decision.message,
      traceNodeId: event.decision.trace.traceNodeId,
    })
  }

  appendOutcome(event: OutcomeEvent): void {
    const ledger = this.resolveGovernanceLedger?.(event.sessionID)
    if (!ledger) {
      return
    }

    ledger.logPolicyOutcome({
      decisionId: event.decisionId,
      clauseId: event.clauseId,
      outcome: event.outcome,
      sessionId: event.sessionID,
      hookPoint: event.hookPoint,
      toolName: event.toolName,
      message: event.message,
      traceNodeId: event.traceNodeId,
    })
  }
}

export function createPolicyEventWriter(
  options: PolicyEventWriterOptions = {}
): PolicyEventWriter {
  return new DefaultPolicyEventWriter(options)
}
