import { describe, expect, test } from "bun:test"
import type { ExecutionContract, PolicyEventInput } from "../../contracts/types"
import { evaluatePolicyDecisions } from "./kernel"

function baseContract(overrides?: Partial<ExecutionContract>): ExecutionContract {
  return {
    taskId: "task-1",
    clauses: [],
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
    ...overrides,
  }
}

function baseEvent(overrides?: Partial<PolicyEventInput>): PolicyEventInput {
  return {
    hookPoint: "tool.execute.before",
    sessionID: "s1",
    toolName: "Write",
    ...overrides,
  }
}

describe("evaluatePolicyDecisions conflict resolution", () => {
  test("most-restrictive picks deny over allow", () => {
    const contract = baseContract({
      clauses: [
        {
          id: "allow-1",
          description: "allow write",
          hookPoints: ["tool.execute.before"],
          enforcement: "hard",
          selector: { toolName: "Write" },
          condition: {},
          action: { type: "allow" },
          priority: 100,
          conflictResolution: "most-restrictive",
          enabled: true,
          version: 1,
          provenance: { author: "test", source: "unit", createdAt: 1 },
          reasonCode: "ALLOW",
        },
        {
          id: "deny-1",
          description: "deny write",
          hookPoints: ["tool.execute.before"],
          enforcement: "hard",
          selector: { toolName: "Write" },
          condition: {},
          action: { type: "deny", message: "blocked" },
          priority: 200,
          conflictResolution: "most-restrictive",
          enabled: true,
          version: 1,
          provenance: { author: "test", source: "unit", createdAt: 1 },
          reasonCode: "DENY",
        },
      ],
    })

    const decisions = evaluatePolicyDecisions(contract, baseEvent())
    expect(decisions).toHaveLength(1)
    expect(decisions[0]?.decision).toBe("deny")
    expect(decisions[0]?.matchedClauseIds).toEqual(["allow-1", "deny-1"])
  })

  test("first-match honors priority then id", () => {
    const contract = baseContract({
      clauses: [
        {
          id: "b",
          description: "b",
          hookPoints: ["tool.execute.before"],
          enforcement: "soft",
          selector: { toolName: "Write" },
          condition: {},
          action: { type: "modify", mutation: { mode: "b" } },
          priority: 100,
          conflictResolution: "first-match",
          enabled: true,
          version: 1,
          provenance: { author: "test", source: "unit", createdAt: 1 },
          reasonCode: "B",
        },
        {
          id: "a",
          description: "a",
          hookPoints: ["tool.execute.before"],
          enforcement: "soft",
          selector: { toolName: "Write" },
          condition: {},
          action: { type: "modify", mutation: { mode: "a" } },
          priority: 100,
          conflictResolution: "first-match",
          enabled: true,
          version: 1,
          provenance: { author: "test", source: "unit", createdAt: 1 },
          reasonCode: "A",
        },
      ],
    })

    const decisions = evaluatePolicyDecisions(contract, baseEvent())
    expect(decisions).toHaveLength(1)
    expect(decisions[0]?.clauseId).toBe("a")
    expect(decisions[0]?.decision).toBe("modify")
    expect(decisions[0]?.mutation).toEqual({ mode: "a" })
  })

  test("merge returns one decision per matched clause sorted by priority/id", () => {
    const contract = baseContract({
      clauses: [
        {
          id: "z",
          description: "z",
          hookPoints: ["tool.execute.before"],
          enforcement: "audit",
          selector: { toolName: "Write" },
          condition: {},
          action: { type: "audit", message: "z" },
          priority: 120,
          conflictResolution: "merge",
          enabled: true,
          version: 1,
          provenance: { author: "test", source: "unit", createdAt: 1 },
          reasonCode: "Z",
        },
        {
          id: "a",
          description: "a",
          hookPoints: ["tool.execute.before"],
          enforcement: "soft",
          selector: { toolName: "Write" },
          condition: {},
          action: { type: "modify", mutation: { one: 1 } },
          priority: 110,
          conflictResolution: "merge",
          enabled: true,
          version: 1,
          provenance: { author: "test", source: "unit", createdAt: 1 },
          reasonCode: "A",
        },
      ],
    })

    const decisions = evaluatePolicyDecisions(contract, baseEvent())
    expect(decisions.map((d) => d.clauseId)).toEqual(["a", "z"])
    expect(decisions.map((d) => d.decision)).toEqual(["modify", "audit"])
  })

  test("matches payload-prefixed condition paths", () => {
    const contract = baseContract({
      clauses: [
        {
          id: "payload-guard",
          description: "matches payload path",
          hookPoints: ["tool.execute.before"],
          enforcement: "hard",
          selector: { toolName: "Write" },
          condition: {
            equals: {
              "payload.guards.writeExistingFile.blocked": true,
            },
          },
          action: { type: "deny", message: "blocked-by-payload" },
          priority: 100,
          conflictResolution: "most-restrictive",
          enabled: true,
          version: 1,
          provenance: { author: "test", source: "unit", createdAt: 1 },
          reasonCode: "PAYLOAD_GUARD",
        },
      ],
    })

    const decisions = evaluatePolicyDecisions(
      contract,
      baseEvent({
        payload: {
          guardsVersion: 1,
          guards: {
            writeExistingFile: {
              blocked: true,
            },
          },
        },
      })
    )

    expect(decisions).toHaveLength(1)
    expect(decisions[0]?.decision).toBe("deny")
    expect(decisions[0]?.message).toBe("blocked-by-payload")
  })

  test("throws on guards condition when guardsVersion is missing", () => {
    const contract = baseContract({
      clauses: [
        {
          id: "guard-version-required",
          description: "guarded clause",
          hookPoints: ["tool.execute.before"],
          enforcement: "hard",
          selector: { toolName: "Write" },
          condition: {
            equals: {
              "payload.guards.writeExistingFile.blocked": true,
            },
          },
          action: { type: "deny", message: "blocked-by-payload" },
          priority: 100,
          conflictResolution: "most-restrictive",
          enabled: true,
          version: 1,
          provenance: { author: "test", source: "unit", createdAt: 1 },
          reasonCode: "PAYLOAD_GUARD",
        },
      ],
    })

    expect(() =>
      evaluatePolicyDecisions(
        contract,
        baseEvent({
          payload: {
            guards: {
              writeExistingFile: {
                blocked: true,
              },
            },
          },
        })
      )).toThrow("incompatible guards payload version")
  })

  test("throws on guards condition when guardsVersion is incompatible", () => {
    const contract = baseContract({
      clauses: [
        {
          id: "guard-version-required",
          description: "guarded clause",
          hookPoints: ["tool.execute.before"],
          enforcement: "hard",
          selector: { toolName: "Write" },
          condition: {
            equals: {
              "payload.guards.writeExistingFile.blocked": true,
            },
          },
          action: { type: "deny", message: "blocked-by-payload" },
          priority: 100,
          conflictResolution: "most-restrictive",
          enabled: true,
          version: 1,
          provenance: { author: "test", source: "unit", createdAt: 1 },
          reasonCode: "PAYLOAD_GUARD",
        },
      ],
    })

    expect(() =>
      evaluatePolicyDecisions(
        contract,
        baseEvent({
          payload: {
            guardsVersion: 2,
            guards: {
              writeExistingFile: {
                blocked: true,
              },
            },
          },
        })
      )).toThrow("incompatible guards payload version")
  })

  test("most-restrictive ranks audit above allow", () => {
    // #given a contract with allow + audit clauses for the same tool
    const contract = baseContract({
      clauses: [
        {
          id: "allow-1",
          description: "allow write",
          hookPoints: ["tool.execute.before"],
          enforcement: "soft",
          selector: { toolName: "Write" },
          condition: {},
          action: { type: "allow" },
          priority: 100,
          conflictResolution: "most-restrictive",
          enabled: true,
          version: 1,
          provenance: { author: "test", source: "unit", createdAt: 1 },
          reasonCode: "ALLOW",
        },
        {
          id: "audit-1",
          description: "audit write",
          hookPoints: ["tool.execute.before"],
          enforcement: "audit",
          selector: { toolName: "Write" },
          condition: {},
          action: { type: "audit", message: "audited" },
          priority: 200,
          conflictResolution: "most-restrictive",
          enabled: true,
          version: 1,
          provenance: { author: "test", source: "unit", createdAt: 1 },
          reasonCode: "AUDIT",
        },
      ],
    })

    // #when evaluating policy decisions
    const decisions = evaluatePolicyDecisions(contract, baseEvent())

    // #then audit wins (not allow)
    expect(decisions).toHaveLength(1)
    expect(decisions[0]?.decision).toBe("audit")
    expect(decisions[0]?.matchedClauseIds).toEqual(["allow-1", "audit-1"])
  })

  test("most-restrictive picks highest rank not first match", () => {
    // #given a contract with modify (priority 100) + deny (priority 200)
    const contract = baseContract({
      clauses: [
        {
          id: "modify-1",
          description: "modify write",
          hookPoints: ["tool.execute.before"],
          enforcement: "soft",
          selector: { toolName: "Write" },
          condition: {},
          action: { type: "modify", mutation: { mode: "safe" } },
          priority: 100,
          conflictResolution: "most-restrictive",
          enabled: true,
          version: 1,
          provenance: { author: "test", source: "unit", createdAt: 1 },
          reasonCode: "MODIFY",
        },
        {
          id: "deny-1",
          description: "deny write",
          hookPoints: ["tool.execute.before"],
          enforcement: "hard",
          selector: { toolName: "Write" },
          condition: {},
          action: { type: "deny", message: "blocked" },
          priority: 200,
          conflictResolution: "most-restrictive",
          enabled: true,
          version: 1,
          provenance: { author: "test", source: "unit", createdAt: 1 },
          reasonCode: "DENY",
        },
      ],
    })

    // #when evaluating policy decisions
    const decisions = evaluatePolicyDecisions(contract, baseEvent())

    // #then deny wins regardless of priority ordering
    expect(decisions).toHaveLength(1)
    expect(decisions[0]?.decision).toBe("deny")
    expect(decisions[0]?.clauseId).toBe("deny-1")
  })

  test("merge mode sets matchedClauseIds to all matched clause ids", () => {
    // #given a contract with 2 merge clauses
    const contract = baseContract({
      clauses: [
        {
          id: "merge-a",
          description: "merge a",
          hookPoints: ["tool.execute.before"],
          enforcement: "soft",
          selector: { toolName: "Write" },
          condition: {},
          action: { type: "modify", mutation: { a: 1 } },
          priority: 100,
          conflictResolution: "merge",
          enabled: true,
          version: 1,
          provenance: { author: "test", source: "unit", createdAt: 1 },
          reasonCode: "A",
        },
        {
          id: "merge-b",
          description: "merge b",
          hookPoints: ["tool.execute.before"],
          enforcement: "soft",
          selector: { toolName: "Write" },
          condition: {},
          action: { type: "audit", message: "b" },
          priority: 200,
          conflictResolution: "merge",
          enabled: true,
          version: 1,
          provenance: { author: "test", source: "unit", createdAt: 1 },
          reasonCode: "B",
        },
      ],
    })

    // #when evaluating policy decisions
    const decisions = evaluatePolicyDecisions(contract, baseEvent())

    // #then BOTH decisions have matchedClauseIds containing both clause IDs
    expect(decisions).toHaveLength(2)
    expect(decisions[0]?.matchedClauseIds).toEqual(["merge-a", "merge-b"])
    expect(decisions[1]?.matchedClauseIds).toEqual(["merge-a", "merge-b"])
  })

  test("uses contract default conflict resolution when matched clauses use mixed modes", () => {
    const contract = baseContract({
      defaultConflictResolution: "first-match",
      clauses: [
        {
          id: "a",
          description: "allow",
          hookPoints: ["tool.execute.before"],
          enforcement: "soft",
          selector: { toolName: "Write" },
          condition: {},
          action: { type: "allow" },
          priority: 100,
          conflictResolution: "merge",
          enabled: true,
          version: 1,
          provenance: { author: "test", source: "unit", createdAt: 1 },
          reasonCode: "ALLOW_A",
        },
        {
          id: "b",
          description: "deny",
          hookPoints: ["tool.execute.before"],
          enforcement: "hard",
          selector: { toolName: "Write" },
          condition: {},
          action: { type: "deny", message: "blocked" },
          priority: 200,
          conflictResolution: "most-restrictive",
          enabled: true,
          version: 1,
          provenance: { author: "test", source: "unit", createdAt: 1 },
          reasonCode: "DENY_B",
        },
      ],
    })

    const decisions = evaluatePolicyDecisions(contract, baseEvent())
    expect(decisions).toHaveLength(1)
    expect(decisions[0]?.decision).toBe("allow")
    expect(decisions[0]?.matchedClauseIds).toEqual(["a", "b"])
  })
})
