import { describe, it, expect } from "bun:test"
import { filterPayloadByGoal } from "./goal-extractor"
import type { HandoffPayload, RecoveryPattern } from "./types"

function createRecoveryPattern(id: string): RecoveryPattern {
  return {
    id,
    failureSequence: [
      {
        tool: "Edit",
        args: { file_path: "src/foo.ts" },
        error: "Type error",
        timestamp: 1,
      },
    ],
    resolution: {
      tool: "Edit",
      args: { file_path: "src/foo.ts" },
      result: "Success",
      timestamp: 2,
    },
    contextSignature: {
      filePatterns: ["*.ts"],
      errorCategory: "type-error",
      toolChain: ["Edit"],
    },
    stats: {
      occurrences: 1,
      firstSeen: 1,
      lastSeen: 2,
      successfulApplications: 0,
    },
  }
}

describe("filterPayloadByGoal", () => {
  it("preserves antiPatterns and recoveryPatterns", () => {
    // #given
    const payload: HandoffPayload = {
      decisions: [
        { what: "Auth approach", chosen: "JWT", why: "Simple" },
        { what: "Storage", chosen: "Cookie", why: "Security" },
      ],
      artifacts: [
        { path: "src/auth.ts", changeType: "modified", summary: "Updated auth flow" },
        { path: "src/token.ts", changeType: "created", summary: "Added token helpers" },
      ],
      antiPatterns: [
        { approach: "Store token in localStorage", reason: "XSS risk" },
        { approach: "Disable CSRF", reason: "Security regression" },
      ],
      domainContext: ["Auth lives in src/auth.ts", "Token parsing in src/token.ts"],
      remainingTasks: ["Add tests"],
      recoveryPatterns: [createRecoveryPattern("rp_1"), createRecoveryPattern("rp_2")],
    }

    // #when
    const result = filterPayloadByGoal(payload, {
      goal: "Implement auth",
      maxDecisions: 1,
      maxArtifacts: 1,
      maxDomainContext: 1,
    })

    // #then
    expect(result.payload.antiPatterns).toHaveLength(2)
    expect(result.payload.recoveryPatterns).toHaveLength(2)
    expect(result.payload.recoveryPatterns?.map((p) => p.id)).toEqual(["rp_1", "rp_2"])
  })
})

