import { describe, test, expect, mock } from "bun:test"

const { executeActiveHandoff } = require("../../../src/features/session-handoff/launcher")
const { DEFAULT_HANDOFF_CONFIG } = require("../../../src/features/session-handoff/types")

function createRecoveryPattern(id: string) {
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

describe("executeActiveHandoff", () => {
  test("merges recoveryPatterns from session state into prompt and stored package", async () => {
    // given
    const request = {
      goal: "Fix bug",
      sourceSessionId: "session_1",
      projectPath: "/project",
      launchMode: "preview",
    }

    const saveHandoff = mock(() => {})
    const deps = {
      callLLM: async () =>
        JSON.stringify({
          decisions: [],
          artifacts: [],
          antiPatterns: [],
          domainContext: [],
        }),
      saveHandoff,
    }

    const sessionState = {
      projectPath: "/project",
      startTime: Date.now() - 1000,
      messages: [{ role: "user", content: "Initial session goal", timestamp: Date.now() - 900 }],
      toolCalls: [],
      fileChanges: new Set<string>(["src/foo.ts"]),
      recoveryPatterns: [createRecoveryPattern("rp_1")],
    }

    // when
    const result = await executeActiveHandoff(request, deps, sessionState, DEFAULT_HANDOFF_CONFIG)

    // then
    expect(result.prompt).toContain("## Recovery Patterns")
    expect(result.handoffPackage.payload.recoveryPatterns?.[0]?.id).toBe("rp_1")

    expect(saveHandoff).toHaveBeenCalledTimes(1)
    const saved = saveHandoff.mock.calls[0]?.[0]
    expect(saved?.payload?.recoveryPatterns?.[0]?.id).toBe("rp_1")
  })
})
