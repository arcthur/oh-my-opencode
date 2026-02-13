import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { GovernanceLedgerWriter } from "../governance"
import { DefaultPolicyEventWriter } from "./event-writer"
import { PolicyLedgerStore } from "./policy-ledger"

const tempDirs: string[] = []

function createTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of tempDirs.splice(0, tempDirs.length)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe("DefaultPolicyEventWriter", () => {
  test("appendObserved writes to policy-ledger only", () => {
    const baseDir = createTempDir("policy-ledger-")
    const store = new PolicyLedgerStore({
      enabled: true,
      baseDir,
      retentionDays: 7,
    })
    const writer = new DefaultPolicyEventWriter({
      policyLedger: store,
      resolveGovernanceLedger: () => null,
    })

    writer.appendObserved({
      observedId: "obs_1",
      timestamp: 1,
      sessionID: "s1",
      hookPoint: "tool.execute.before",
      toolName: "Write",
      payload: { args: { file: "a.ts" } },
      traceHookNodeId: "internal:policy-observe:tool.execute.before",
    })

    const entries = store.readSession("s1")
    expect(entries).toHaveLength(1)
    expect(entries[0]?.observed.hookPoint).toBe("tool.execute.before")
    expect(entries[0]?.observed.toolName).toBe("Write")
  })

  test("appendDecision and appendOutcome write to governance-ledger", () => {
    const baseDir = createTempDir("policy-ledger-decision-outcome-")
    const store = new PolicyLedgerStore({
      enabled: true,
      baseDir,
      retentionDays: 7,
    })
    const calls: string[] = []
    const governanceStub = {
      logPolicyDecision: () => {
        calls.push("decision")
        return {
          id: "d",
          timestamp: 1,
          previousHash: "genesis",
          type: "policy-decision" as const,
          policy: {
            decisionId: "p",
            clauseId: "c",
            matchedClauseIds: ["c"],
            hookPoint: "tool.execute.before",
            enforcement: "hard" as const,
            decision: "deny" as const,
            reasonCode: "RC",
          },
          sessionId: "s1",
          hookNodeId: "internal:policy-enforce:tool.execute.before",
        }
      },
      logPolicyOutcome: () => {
        calls.push("outcome")
        return {
          id: "o",
          timestamp: 1,
          previousHash: "genesis",
          type: "policy-outcome" as const,
          decisionId: "p",
          clauseId: "c",
          outcome: "blocked" as const,
          sessionId: "s1",
          hookPoint: "tool.execute.before",
        }
      },
    } as unknown as GovernanceLedgerWriter

    const writer = new DefaultPolicyEventWriter({
      policyLedger: store,
      resolveGovernanceLedger: () => governanceStub,
    })

    writer.appendDecision({
      decisionEventId: "de_1",
      timestamp: 1,
      sessionID: "s1",
      decision: {
        decisionId: "pd_1",
        clauseId: "clause_1",
        matchedClauseIds: ["clause_1"],
        hookPoint: "tool.execute.before",
        enforcement: "hard",
        decision: "deny",
        reasonCode: "DENY_WRITE",
        timestamp: 1,
        trace: {
          hookNodeId: "internal:policy-enforce:tool.execute.before",
          sessionID: "s1",
          toolName: "Write",
        },
      },
    })

    writer.appendOutcome({
      outcomeEventId: "oe_1",
      timestamp: 1,
      sessionID: "s1",
      decisionId: "pd_1",
      clauseId: "clause_1",
      hookPoint: "tool.execute.before",
      toolName: "Write",
      outcome: "blocked",
      message: "blocked",
    })

    expect(calls).toEqual(["decision", "outcome"])
    const entries = store.readSession("s1")
    expect(entries).toHaveLength(0)
  })

  test("appendDecision and appendOutcome no-op when governance writer is unavailable", () => {
    const baseDir = createTempDir("policy-ledger-no-gov-")
    const store = new PolicyLedgerStore({
      enabled: true,
      baseDir,
      retentionDays: 7,
    })

    const writer = new DefaultPolicyEventWriter({
      policyLedger: store,
      resolveGovernanceLedger: () => null,
    })

    writer.appendDecision({
      decisionEventId: "de_2",
      timestamp: 2,
      sessionID: "s2",
      decision: {
        decisionId: "pd_2",
        clauseId: "clause_2",
        matchedClauseIds: ["clause_2"],
        hookPoint: "tool.execute.before",
        enforcement: "soft",
        decision: "modify",
        reasonCode: "MODIFY_ARGS",
        timestamp: 2,
        mutation: { args: { path: "a.ts" } },
        trace: {
          hookNodeId: "internal:policy-enforce:tool.execute.before",
          sessionID: "s2",
          toolName: "Write",
        },
      },
    })

    writer.appendOutcome({
      outcomeEventId: "oe_2",
      timestamp: 2,
      sessionID: "s2",
      decisionId: "pd_2",
      clauseId: "clause_2",
      hookPoint: "tool.execute.before",
      toolName: "Write",
      outcome: "applied",
      message: "modified",
      traceNodeId: "internal:policy-enforce:tool.execute.before",
    })

    const entries = store.readSession("s2")
    expect(entries).toHaveLength(0)
  })

  test("appendOutcome forwards superseded outcome to governance ledger", () => {
    const baseDir = createTempDir("policy-ledger-superseded-")
    const store = new PolicyLedgerStore({
      enabled: true,
      baseDir,
      retentionDays: 7,
    })
    let capturedOutcome: string | undefined
    const governanceStub = {
      logPolicyDecision: () => {
        throw new Error("not expected")
      },
      logPolicyOutcome: (params: { outcome: string }) => {
        capturedOutcome = params.outcome
        return {
          id: "o",
          timestamp: 1,
          previousHash: "genesis",
          type: "policy-outcome" as const,
          decisionId: "p",
          clauseId: "c",
          outcome: "superseded" as const,
          sessionId: "s3",
          hookPoint: "tool.execute.before",
        }
      },
    } as unknown as GovernanceLedgerWriter

    const writer = new DefaultPolicyEventWriter({
      policyLedger: store,
      resolveGovernanceLedger: () => governanceStub,
    })

    writer.appendOutcome({
      outcomeEventId: "oe_3",
      timestamp: 3,
      sessionID: "s3",
      decisionId: "pd_3",
      clauseId: "clause_3",
      hookPoint: "tool.execute.before",
      toolName: "Write",
      outcome: "superseded",
      message: "Governance blocked after policy allowed",
      traceNodeId: "internal:policy-enforce:tool.execute.before",
    })

    expect(capturedOutcome).toBe("superseded")
  })
})
