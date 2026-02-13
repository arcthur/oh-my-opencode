import { randomUUID } from "node:crypto"
import type { ExecutionContract, HookPoint, PolicyDecision, PolicyEventInput } from "../../contracts"
import { evaluatePolicyDecisions } from "./kernel"
import type { AsyncPolicyEvaluator } from "./evaluator"
import type { PolicyEventWriter } from "./types"
import type { ProvenanceClaimStore } from "../provenance-memory"

export interface PolicyRuntime {
  observe: (event: PolicyEventInput) => Promise<void>
  enforce: (event: PolicyEventInput) => Promise<PolicyDecision[]>
  recordSuperseded: (params: {
    sessionID: string
    hookPoint: HookPoint
    decisions: PolicyDecision[]
    reason: string
  }) => void
}

export interface CreatePolicyRuntimeOptions {
  contract: ExecutionContract
  eventWriter: PolicyEventWriter
  evaluator?: AsyncPolicyEvaluator
  provenanceStore?: ProvenanceClaimStore
}

function makeObservedId(): string {
  return `obs_${Date.now()}_${randomUUID().slice(0, 8)}`
}

function makeDecisionEventId(): string {
  return `dec_evt_${Date.now()}_${randomUUID().slice(0, 8)}`
}

function makeOutcomeEventId(): string {
  return `out_evt_${Date.now()}_${randomUUID().slice(0, 8)}`
}

export function createPolicyRuntime(options: CreatePolicyRuntimeOptions): PolicyRuntime {
  const { contract, eventWriter, evaluator, provenanceStore } = options

  return {
    async observe(event: PolicyEventInput): Promise<void> {
      const traceHookNodeId = event.traceHookNodeId
      if (!traceHookNodeId) {
        return
      }

      eventWriter.appendObserved({
        observedId: makeObservedId(),
        timestamp: Date.now(),
        sessionID: event.sessionID,
        hookPoint: event.hookPoint,
        toolName: event.toolName,
        agent: event.agent,
        payload: event.payload,
        traceHookNodeId,
      })

      const claims = (event.payload as { provenanceClaims?: unknown } | undefined)?.provenanceClaims
      if (Array.isArray(claims)) {
        for (const rawClaim of claims) {
          if (!rawClaim || typeof rawClaim !== "object") {
            continue
          }
          const claimRecord = rawClaim as Record<string, unknown>
          if (
            typeof claimRecord.claim !== "string"
            || typeof claimRecord.sourceEventId !== "string"
            || !Array.isArray(claimRecord.retrievalPath)
          ) {
            continue
          }

          const retrievalPath = claimRecord.retrievalPath
            .filter((part): part is string => typeof part === "string")
          if (retrievalPath.length === 0) {
            continue
          }

          provenanceStore?.appendClaim({
            sessionID: event.sessionID,
            layer: claimRecord.layer === "experience" ? "experience" : "fact",
            claim: claimRecord.claim,
            sourceEventId: claimRecord.sourceEventId,
            retrievalPath,
            metadata:
              claimRecord.metadata && typeof claimRecord.metadata === "object"
                ? (claimRecord.metadata as Record<string, unknown>)
                : undefined,
          })
        }
      }
    },

    async enforce(event: PolicyEventInput): Promise<PolicyDecision[]> {
      const decisions = evaluatePolicyDecisions(contract, event)
      const now = Date.now()

      for (const decision of decisions) {
        eventWriter.appendDecision({
          decisionEventId: makeDecisionEventId(),
          timestamp: now,
          sessionID: event.sessionID,
          decision,
        })

        const outcome: "applied" | "blocked" = decision.decision === "deny" && decision.enforcement === "hard"
          ? "blocked"
          : "applied"
        eventWriter.appendOutcome({
          outcomeEventId: makeOutcomeEventId(),
          timestamp: now,
          sessionID: event.sessionID,
          decisionId: decision.decisionId,
          clauseId: decision.clauseId,
          hookPoint: decision.hookPoint,
          toolName: decision.trace.toolName,
          outcome,
          message: decision.message,
          traceNodeId: decision.trace.hookNodeId,
        })

        evaluator?.evaluate({
          sessionID: event.sessionID,
          decision,
          outcome,
        })
      }

      return decisions
    },

    recordSuperseded(params): void {
      const now = Date.now()
      for (const decision of params.decisions) {
        eventWriter.appendOutcome({
          outcomeEventId: makeOutcomeEventId(),
          timestamp: now,
          sessionID: params.sessionID,
          decisionId: decision.decisionId,
          clauseId: decision.clauseId,
          hookPoint: params.hookPoint,
          toolName: decision.trace.toolName,
          outcome: "superseded",
          message: params.reason,
          traceNodeId: decision.trace.hookNodeId,
        })
      }
    },
  }
}
