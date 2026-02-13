import { describe, expect, test } from "bun:test"
import type { ExecutionContract, PolicyDecision } from "../../contracts"
import { createPolicyRuntime } from "./runtime"
import type { OutcomeEvent, PolicyEventWriter } from "./types"

function baseContract(): ExecutionContract {
  return {
    taskId: "runtime-test",
    clauses: [
      {
        id: "deny-write",
        description: "deny write",
        hookPoints: ["tool.execute.before"],
        enforcement: "hard",
        selector: { toolName: "Write" },
        condition: {},
        action: { type: "deny", message: "blocked" },
        priority: 1,
        conflictResolution: "most-restrictive",
        enabled: true,
        version: 1,
        provenance: { author: "test", source: "unit", createdAt: 1 },
        reasonCode: "DENY",
      },
    ],
    defaultConflictResolution: "most-restrictive",
    budgets: {
      contextProfile: "profile_400",
      contextTokensTarget: 240000,
      contextTokensHardLimit: 320000,
      reasoningBudget: "medium",
      maxToolCalls: 30,
      wallClockMs: 120000,
    },
    modelPolicy: {
      primary: "openai/gpt-5.3-codex",
      providerPriority: ["openai", "google", "anthropic"],
      allowFallback: true,
      minContextWindow: 400000,
    },
  }
}

describe("policy runtime integration", () => {
  test("writes decision/outcome and triggers async evaluator", async () => {
    const written: string[] = []
    const writer: PolicyEventWriter = {
      appendObserved: () => {
        written.push("observed")
      },
      appendDecision: () => {
        written.push("decision")
      },
      appendOutcome: () => {
        written.push("outcome")
      },
    }
    const evaluated: string[] = []
    const runtime = createPolicyRuntime({
      contract: baseContract(),
      eventWriter: writer,
      evaluator: {
        evaluate: () => {
          evaluated.push("evaluated")
        },
      } as never,
    })

    await runtime.observe({
      hookPoint: "tool.execute.before",
      sessionID: "s1",
      toolName: "Write",
      traceHookNodeId: "internal:policy-observe:tool.execute.before",
    })
    const decisions = await runtime.enforce({
      hookPoint: "tool.execute.before",
      sessionID: "s1",
      toolName: "Write",
      traceHookNodeId: "internal:policy-enforce:tool.execute.before",
    })

    expect(decisions).toHaveLength(1)
    expect(written).toEqual(["observed", "decision", "outcome"])
    expect(evaluated).toEqual(["evaluated"])
  })

  test("captures provenance claims emitted via event payload", async () => {
    const captured: string[] = []
    const runtime = createPolicyRuntime({
      contract: baseContract(),
      eventWriter: {
        appendObserved: () => {},
        appendDecision: () => {},
        appendOutcome: () => {},
      },
      provenanceStore: {
        configure: () => {},
        appendClaim: (input) => {
          captured.push(`${input.layer}:${input.sourceEventId}`)
          return {
            claimId: "c1",
            timestamp: 1,
            ...input,
          }
        },
        readClaims: () => [],
        verifyChain: () => ({ valid: true }),
      },
    })

    await runtime.observe({
      hookPoint: "tool.execute.before",
      sessionID: "s2",
      toolName: "Write",
      traceHookNodeId: "internal:policy-observe:tool.execute.before",
      payload: {
        provenanceClaims: [
          {
            layer: "fact",
            claim: "Write tool blocked when file exists",
            sourceEventId: "evt_9",
            retrievalPath: ["policy-ledger", "evt_9"],
          },
        ],
      },
    })

    expect(captured).toEqual(["fact:evt_9"])
  })

  test("recordSuperseded writes outcome events with outcome 'superseded'", async () => {
    // #given — a runtime with a writer that captures outcome events
    const outcomes: OutcomeEvent[] = []
    const writer: PolicyEventWriter = {
      appendObserved: () => {},
      appendDecision: () => {},
      appendOutcome: (event) => {
        outcomes.push(event)
      },
    }
    const contract = baseContract()
    const runtime = createPolicyRuntime({ contract, eventWriter: writer })

    // #when — enforce produces "applied" decisions, then recordSuperseded is called
    const decisions = await runtime.enforce({
      hookPoint: "tool.execute.before",
      sessionID: "s-sup",
      toolName: "Write",
      traceHookNodeId: "internal:policy-enforce:tool.execute.before",
    })
    expect(decisions.length).toBeGreaterThan(0)

    // clear captured outcomes from enforce
    const enforceOutcomes = outcomes.splice(0, outcomes.length)
    expect(enforceOutcomes.length).toBeGreaterThan(0)

    runtime.recordSuperseded({
      sessionID: "s-sup",
      hookPoint: "tool.execute.before",
      decisions,
      reason: "Governance blocked after policy allowed",
    })

    // #then — one superseded outcome per decision
    expect(outcomes).toHaveLength(decisions.length)
    for (const outcomeEvent of outcomes) {
      expect(outcomeEvent.outcome).toBe("superseded")
      expect(outcomeEvent.message).toContain("Governance blocked after policy allowed")
      expect(outcomeEvent.sessionID).toBe("s-sup")
      expect(outcomeEvent.hookPoint).toBe("tool.execute.before")
    }
  })
})
