import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import type { ExecutionContract, PolicyDecision, PolicyEventInput } from "../../../src/contracts"
import { evaluatePolicyDecisions } from "../../../src/features/policy-runtime/kernel"

function buildContract(): ExecutionContract {
  return {
    taskId: "parity-task",
    clauses: [
      {
        id: "deny-write",
        description: "deny write",
        hookPoints: ["tool.execute.before"],
        enforcement: "hard",
        selector: { toolName: "Write" },
        condition: {},
        action: { type: "deny", message: "blocked" },
        priority: 10,
        conflictResolution: "most-restrictive",
        enabled: true,
        version: 1,
        provenance: { author: "test", source: "parity", createdAt: 1 },
        reasonCode: "DENY_WRITE",
      },
      {
        id: "audit-read",
        description: "audit read",
        hookPoints: ["tool.execute.before"],
        enforcement: "audit",
        selector: { toolName: "Read" },
        condition: {},
        action: { type: "audit", message: "read-audit" },
        priority: 20,
        conflictResolution: "most-restrictive",
        enabled: true,
        version: 1,
        provenance: { author: "test", source: "parity", createdAt: 1 },
        reasonCode: "AUDIT_READ",
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

function normalize(decisions: PolicyDecision[]): Array<Pick<PolicyDecision, "decision" | "reasonCode">> {
  return decisions.map((decision) => ({
    decision: decision.decision,
    reasonCode: decision.reasonCode,
  }))
}

interface ReplayFixtureRecord {
  event: PolicyEventInput
  expected: Array<Pick<PolicyDecision, "decision" | "reasonCode">>
}

function loadReplayFixture(): ReplayFixtureRecord[] {
  const fixturePath = join(
    import.meta.dir,
    "../../../src/features/policy-runtime/fixtures/policy-replay-session.jsonl"
  )
  const raw = readFileSync(fixturePath, "utf-8")
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as ReplayFixtureRecord)
}

describe("policy replay parity", () => {
  test("replays one session event log with >=99% parity", () => {
    const contract = buildContract()
    const events = loadReplayFixture()
    expect(events.length).toBeGreaterThanOrEqual(100)

    let matched = 0
    for (const record of events) {
      const nextGen = normalize(evaluatePolicyDecisions(contract, record.event))
      const legacy = record.expected
      if (JSON.stringify(legacy) === JSON.stringify(nextGen)) {
        matched += 1
      }
    }

    const parity = matched / events.length
    expect(parity).toBeGreaterThanOrEqual(0.99)
  })
})
