import { describe, expect, test, beforeEach, mock } from "bun:test"

const mockFindMatchingHooks = mock(() => [{ matcher: "*", hooks: [{ type: "command", command: "test-hook" }] }])
const mockExecuteHookCommand = mock(async () => ({ exitCode: 0, stdout: "{}", stderr: "" }))

mock.module("../../shared", () => ({
  findMatchingHooks: (...args: unknown[]) => mockFindMatchingHooks(...args),
  executeHookCommand: (...args: unknown[]) => mockExecuteHookCommand(...args),
  objectToSnakeCase: (value: Record<string, unknown>) => value,
  transformToolName: (toolName: string) => toolName,
  log: () => {},
}))

mock.module("./config-loader", () => ({
  isHookCommandDisabled: () => false,
}))

const { executePreToolUseHooks } = await import("./pre-tool-use")

describe("executePreToolUseHooks", () => {
  beforeEach(() => {
    mockFindMatchingHooks.mockClear()
    mockExecuteHookCommand.mockClear()
    mockFindMatchingHooks.mockReturnValue([{ matcher: "*", hooks: [{ type: "command", command: "test-hook" }] }])
  })

  test("accepts permissionDecision from hookSpecificOutput", async () => {
    // #given
    mockExecuteHookCommand.mockResolvedValueOnce({
      exitCode: 0,
      stdout: JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
          permissionDecisionReason: "blocked by policy",
        },
      }),
      stderr: "",
    })

    // #when
    const result = await executePreToolUseHooks(
      {
        sessionId: "session-1",
        toolName: "write",
        toolInput: { path: "a.txt" },
        cwd: "/tmp",
      },
      { PreToolUse: [] }
    )

    // #then
    expect(result.decision).toBe("deny")
    expect(result.reason).toBe("blocked by policy")
  })

  test("ignores legacy decision/reason fields and falls back to allow", async () => {
    // #given
    mockExecuteHookCommand.mockResolvedValueOnce({
      exitCode: 0,
      stdout: JSON.stringify({
        decision: "block",
        reason: "legacy format",
      }),
      stderr: "",
    })

    // #when
    const result = await executePreToolUseHooks(
      {
        sessionId: "session-1",
        toolName: "write",
        toolInput: { path: "a.txt" },
        cwd: "/tmp",
      },
      { PreToolUse: [] }
    )

    // #then
    expect(result.decision).toBe("allow")
    expect(result.reason).toBeUndefined()
  })
})
