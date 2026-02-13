import { beforeEach, describe, expect, mock, test } from "bun:test"
import { contextBudgetArbiter } from "../../features/context-view"
import { createCommentCheckerHooks } from "./index"

const mockRunCommentChecker = mock(async () => ({ hasComments: false, message: "" }))
const mockGetCommentCheckerPath = mock(async () => null as string | null)
const mockStartBackgroundInit = mock(() => {})

describe("createCommentCheckerHooks", () => {
  beforeEach(() => {
    contextBudgetArbiter.resetForTesting()
    mockRunCommentChecker.mockClear()
    mockGetCommentCheckerPath.mockClear()
    mockStartBackgroundInit.mockClear()
    mockGetCommentCheckerPath.mockResolvedValue(null)
  })

  test("does not crash when output.output is undefined", async () => {
    // #given
    const hooks = createCommentCheckerHooks(undefined, {
      runCommentChecker: mockRunCommentChecker,
      getCommentCheckerPath: mockGetCommentCheckerPath,
      startBackgroundInit: mockStartBackgroundInit,
    })
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
