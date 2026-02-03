import { describe, it, expect } from "bun:test"
import { buildHandoffPrompt } from "./prompt-builder"
import type { HandoffPackage, HandoffPayload, RecoveryPattern } from "./types"

function createRecoveryPattern(id: string): RecoveryPattern {
  return {
    id,
    failureSequence: [
      {
        tool: "Bash",
        args: { command: "bun test" },
        error: "Tests failed",
        timestamp: 1,
      },
      {
        tool: "Edit",
        args: { file_path: "src/foo.ts" },
        error: "Type error",
        timestamp: 2,
      },
    ],
    resolution: {
      tool: "Edit",
      args: { file_path: "src/foo.ts" },
      result: "Fixed types",
      timestamp: 3,
    },
    insight: {
      summary: "Fix types before running tests",
      precheck: "Run typecheck",
      keyDifference: "Updated type definitions",
      confidence: 0.9,
    },
    contextSignature: {
      filePatterns: ["*.ts", "src/*"],
      errorCategory: "type-error",
      toolChain: ["Bash", "Edit"],
    },
    stats: {
      occurrences: 1,
      firstSeen: 1,
      lastSeen: 3,
      successfulApplications: 0,
    },
  }
}

describe("buildHandoffPrompt", () => {
  it("includes recovery patterns when present", () => {
    // given
    const payload: HandoffPayload = {
      decisions: [{ what: "Test framework", chosen: "bun:test", why: "Built-in" }],
      artifacts: [{ path: "src/foo.ts", changeType: "modified", summary: "Refactor" }],
      antiPatterns: [{ approach: "Skip tests", reason: "Risky" }],
      domainContext: ["Tests are run via bun test"],
      remainingTasks: ["Add coverage"],
      recoveryPatterns: [createRecoveryPattern("rp_1")],
    }

    const sourcePackage: HandoffPackage = {
      id: "ho_test_1",
      sourceSessionId: "session_1",
      createdAt: Date.now(),
      expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
      metadata: {
        originalGoal: "Improve tests",
        durationMs: 1000,
        projectPath: "/project",
        keyFiles: ["src/foo.ts"],
        outcome: "completed",
      },
      payload,
    }

    // when
    const prompt = buildHandoffPrompt("Improve tests", payload, sourcePackage)

    // then
    expect(prompt).toContain("## Recovery Patterns")
    expect(prompt).toContain("RP-1")
    expect(prompt).toContain("Fix types before running tests")
  })

  it("does not truncate anti-patterns or recovery patterns by default (up to extraction cap)", () => {
    // given
    const antiPatterns = Array.from({ length: 10 }, (_, i) => ({
      approach: `Bad approach ${i + 1}`,
      reason: `Reason ${i + 1}`,
    }))

    const recoveryPatterns = Array.from({ length: 10 }, (_, i) => createRecoveryPattern(`rp_${i + 1}`))

    const payload: HandoffPayload = {
      decisions: [],
      artifacts: [],
      antiPatterns,
      domainContext: [],
      recoveryPatterns,
    }

    const sourcePackage: HandoffPackage = {
      id: "ho_test_2",
      sourceSessionId: "session_2",
      createdAt: Date.now(),
      expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
      metadata: {
        originalGoal: "Test",
        durationMs: 1000,
        projectPath: "/project",
        keyFiles: [],
        outcome: "completed",
      },
      payload,
    }

    // when
    const prompt = buildHandoffPrompt("Test", payload, sourcePackage)

    // then
    expect(prompt).toContain("10. **Bad approach 10**")
    expect(prompt).toContain("### RP-10")
  })
})
