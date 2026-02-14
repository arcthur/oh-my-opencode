import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { ExecutionContract } from "../../../src/contracts"
import { GovernanceLedgerWriter } from "../../../src/features/governance/ledger"
import { createPolicyEventWriter } from "../../../src/features/policy-runtime/event-writer"
import { PolicyLedgerStore } from "../../../src/features/policy-runtime/policy-ledger"
import { createPolicyRuntime } from "../../../src/features/policy-runtime/runtime"

function baseContract(): ExecutionContract {
  return {
    taskId: "runtime-ledger-test",
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
        provenance: { author: "test", source: "integration", createdAt: 1 },
        reasonCode: "DENY_WRITE",
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

describe("policy runtime integration (real ledgers)", () => {
  let workspace: string
  let policyLedgerDir: string
  let governanceLedgerDir: string

  beforeEach(() => {
    workspace = join(tmpdir(), `policy-runtime-ledger-${Date.now()}-${Math.random().toString(16).slice(2)}`)
    policyLedgerDir = join(workspace, "policy-ledger")
    governanceLedgerDir = join(workspace, "governance-ledger")
    mkdirSync(policyLedgerDir, { recursive: true })
    mkdirSync(governanceLedgerDir, { recursive: true })
  })

  afterEach(() => {
    if (existsSync(workspace)) {
      rmSync(workspace, { recursive: true, force: true })
    }
  })

  test("observe/enforce persists observed events and governance decisions/outcomes", async () => {
    // #given
    const sessionID = "ses-policy-ledger-1"
    const policyLedger = new PolicyLedgerStore({ baseDir: policyLedgerDir })
    const governanceLedger = new GovernanceLedgerWriter(sessionID, { baseDir: governanceLedgerDir })

    const eventWriter = createPolicyEventWriter({
      policyLedger,
      resolveGovernanceLedger: (id) => (id === sessionID ? governanceLedger : null),
    })
    const runtime = createPolicyRuntime({
      contract: baseContract(),
      eventWriter,
    })

    // #when
    await runtime.observe({
      hookPoint: "tool.execute.before",
      sessionID,
      toolName: "Write",
      traceHookNodeId: "internal:policy-observe:tool.execute.before",
    })
    const decisions = await runtime.enforce({
      hookPoint: "tool.execute.before",
      sessionID,
      toolName: "Write",
      traceHookNodeId: "internal:policy-enforce:tool.execute.before",
    })

    // #then
    expect(decisions).toHaveLength(1)
    const observed = policyLedger.readSession(sessionID)
    expect(observed).toHaveLength(1)
    expect(observed[0]?.type).toBe("observed")
    expect(observed[0]?.observed.sessionID).toBe(sessionID)
    expect(observed[0]?.observed.toolName).toBe("Write")

    const decisionEvents = governanceLedger.query({ type: "policy-decision" })
    const outcomeEvents = governanceLedger.query({ type: "policy-outcome" })
    expect(decisionEvents.length).toBeGreaterThan(0)
    expect(outcomeEvents.length).toBeGreaterThan(0)

    const outcomeAny = outcomeEvents[0] as unknown as { outcome?: string; sessionId?: string }
    expect(outcomeAny.sessionId).toBe(sessionID)
    expect(outcomeAny.outcome).toBe("blocked")

    // Verify persistence by reloading from disk
    const reloaded = new GovernanceLedgerWriter(sessionID, { baseDir: governanceLedgerDir })
    expect(reloaded.query({ type: "policy-decision" }).length).toBe(decisionEvents.length)
    expect(reloaded.query({ type: "policy-outcome" }).length).toBe(outcomeEvents.length)
  })

  test("recordSuperseded persists superseded outcomes to governance ledger", async () => {
    // #given
    const sessionID = "ses-policy-ledger-2"
    const policyLedger = new PolicyLedgerStore({ baseDir: policyLedgerDir })
    const governanceLedger = new GovernanceLedgerWriter(sessionID, { baseDir: governanceLedgerDir })

    const eventWriter = createPolicyEventWriter({
      policyLedger,
      resolveGovernanceLedger: (id) => (id === sessionID ? governanceLedger : null),
    })
    const runtime = createPolicyRuntime({ contract: baseContract(), eventWriter })

    // #when
    const decisions = await runtime.enforce({
      hookPoint: "tool.execute.before",
      sessionID,
      toolName: "Write",
      traceHookNodeId: "internal:policy-enforce:tool.execute.before",
    })
    runtime.recordSuperseded({
      sessionID,
      hookPoint: "tool.execute.before",
      decisions,
      reason: "Governance blocked after policy allowed",
    })

    // #then
    const outcomes = governanceLedger.query({ type: "policy-outcome" }) as Array<{ outcome?: string; message?: string }>
    expect(outcomes.some((o) => o.outcome === "superseded" && (o.message ?? "").includes("Governance blocked"))).toBe(true)
  })

  test("enforce still returns decisions when governance ledger is unavailable", async () => {
    // #given
    const sessionID = "ses-policy-ledger-3"
    const policyLedger = new PolicyLedgerStore({ baseDir: policyLedgerDir })
    const eventWriter = createPolicyEventWriter({
      policyLedger,
      resolveGovernanceLedger: () => null,
    })
    const runtime = createPolicyRuntime({ contract: baseContract(), eventWriter })

    // #when
    await runtime.observe({
      hookPoint: "tool.execute.before",
      sessionID,
      toolName: "Write",
      traceHookNodeId: "internal:policy-observe:tool.execute.before",
    })
    const decisions = await runtime.enforce({
      hookPoint: "tool.execute.before",
      sessionID,
      toolName: "Write",
      traceHookNodeId: "internal:policy-enforce:tool.execute.before",
    })

    // #then
    expect(decisions).toHaveLength(1)
    expect(policyLedger.readSession(sessionID).length).toBe(1)
  })
})

