import { describe, test, expect, spyOn, beforeEach, afterEach, mock } from "bun:test"
import { executeSupersedeWrites } from "./pruning-supersede"
import type { PruningState } from "./pruning-types"
import * as shared from "./pruning-shared"

describe("executeSupersedeWrites", () => {
  const sessionID = "s1"
  const protectedTools = new Set<string>()

  let state: PruningState

  beforeEach(() => {
    state = {
      toolPruneActions: new Map(),
      currentTurn: 0,
      fileOperations: new Map(),
      toolSignatures: new Map(),
      erroredTools: new Map(),
    }
  })

  afterEach(() => {
    mock.restore()
  })

  test("conservative mode prunes write input when same file is read later (including last write)", () => {
    // #given: write then read same file
    spyOn(shared, "readMessages").mockReturnValue([
      {
        parts: [
          { type: "step-start" },
          {
            type: "tool",
            callID: "w1",
            tool: "write",
            state: { input: { filePath: "x.txt", content: "hello" }, output: "ok" },
          },
        ],
      },
      {
        parts: [
          { type: "step-start" },
          {
            type: "tool",
            callID: "r1",
            tool: "read",
            state: { input: { filePath: "x.txt" }, output: "contents" },
          },
        ],
      },
    ] as any)

    // #when
    const pruned = executeSupersedeWrites(
      sessionID,
      state,
      { enabled: true, aggressive: false },
      protectedTools,
      0
    )

    // #then
    expect(pruned).toBe(1)
    expect(state.toolPruneActions.get("w1")?.pruneInput).toBe(true)
    expect(state.toolPruneActions.get("w1")?.pruneOutput).toBe(false)
  })

  test("conservative mode does not prune when read happens before write", () => {
    // #given: read then write (no subsequent read)
    spyOn(shared, "readMessages").mockReturnValue([
      {
        parts: [
          { type: "step-start" },
          {
            type: "tool",
            callID: "r1",
            tool: "read",
            state: { input: { filePath: "x.txt" }, output: "old" },
          },
        ],
      },
      {
        parts: [
          { type: "step-start" },
          {
            type: "tool",
            callID: "w1",
            tool: "write",
            state: { input: { filePath: "x.txt", content: "new" }, output: "ok" },
          },
        ],
      },
    ] as any)

    // #when
    const pruned = executeSupersedeWrites(
      sessionID,
      state,
      { enabled: true, aggressive: false },
      protectedTools,
      0
    )

    // #then
    expect(pruned).toBe(0)
    expect(state.toolPruneActions.size).toBe(0)
  })

  test("aggressive mode prunes write input when ANY file is read later", () => {
    // #given: write x.txt then read y.txt
    spyOn(shared, "readMessages").mockReturnValue([
      {
        parts: [
          { type: "step-start" },
          {
            type: "tool",
            callID: "w1",
            tool: "write",
            state: { input: { filePath: "x.txt", content: "hello" }, output: "ok" },
          },
        ],
      },
      {
        parts: [
          { type: "step-start" },
          {
            type: "tool",
            callID: "r1",
            tool: "read",
            state: { input: { filePath: "y.txt" }, output: "y" },
          },
        ],
      },
    ] as any)

    // #when
    const pruned = executeSupersedeWrites(
      sessionID,
      state,
      { enabled: true, aggressive: true },
      protectedTools,
      0
    )

    // #then
    expect(pruned).toBe(1)
    expect(state.toolPruneActions.get("w1")?.pruneInput).toBe(true)
    expect(state.toolPruneActions.get("w1")?.pruneOutput).toBe(false)
  })
})

