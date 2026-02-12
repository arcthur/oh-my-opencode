import { beforeEach, describe, expect, mock, test } from "bun:test"

const mockRunCommentChecker = mock(async () => ({ hasComments: false, message: "" }))
const mockGetCommentCheckerPath = mock(async () => null as string | null)
const mockStartBackgroundInit = mock(() => {})

mock.module("./cli", () => ({
  runCommentChecker: mockRunCommentChecker,
  getCommentCheckerPath: mockGetCommentCheckerPath,
  startBackgroundInit: mockStartBackgroundInit,
}))

mock.module("../../features/context-budget", () => ({
  appendBudgetedOutput: mock(() => ({ accepted: false })),
}))

const { createCommentCheckerHooks } = await import("./index")

describe("createCommentCheckerHooks", () => {
  beforeEach(() => {
    mockRunCommentChecker.mockClear()
    mockGetCommentCheckerPath.mockClear()
    mockStartBackgroundInit.mockClear()
    mockGetCommentCheckerPath.mockResolvedValue(null)
  })

  test("does not crash when output.output is undefined", async () => {
    // #given
    const hooks = createCommentCheckerHooks()
    await hooks["tool.execute.before"](
      { tool: "Write", sessionID: "ses_1", callID: "call_1" },
      { args: { filePath: "/tmp/test.ts", content: "const a = 1" } },
    )
    const output = {
      title: "Write",
      output: undefined as unknown as string,
      metadata: {},
    }

    // #when / #then
    await expect(
      hooks["tool.execute.after"](
        { tool: "Write", sessionID: "ses_1", callID: "call_1" },
        output,
      ),
    ).resolves.toBeUndefined()
    expect(output.output).toBeUndefined()
  })
})
