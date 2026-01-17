import { describe, test, expect, spyOn, beforeEach, afterEach, mock } from "bun:test"
import { executeDeduplication } from "./pruning-deduplication"
import { executeClearResults } from "./pruning-clear-results"
import { executeSupersedeWrites } from "./pruning-supersede"
import { executePurgeErrors } from "./pruning-purge-errors"
import type { PruningState } from "./pruning-types"
import * as shared from "./pruning-shared"

describe("DCP turn protection", () => {
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

  test("deduplication does not prune within last N turns", () => {
    // #given: duplicates only in protected turns (3 and 4)
    spyOn(shared, "readMessages").mockReturnValue([
      { parts: [{ type: "step-start" }, { type: "tool", callID: "c1", tool: "read", state: { input: { filePath: "a" }, output: "x" } }] },
      { parts: [{ type: "step-start" }, { type: "tool", callID: "c2", tool: "read", state: { input: { filePath: "b" }, output: "y" } }] },
      { parts: [{ type: "step-start" }, { type: "tool", callID: "c3", tool: "read", state: { input: { filePath: "dup" }, output: "old" } }] },
      { parts: [{ type: "step-start" }, { type: "tool", callID: "c4", tool: "read", state: { input: { filePath: "dup" }, output: "new" } }] },
    ] as any)

    // #when
    const pruned = executeDeduplication(sessionID, state, { enabled: true }, protectedTools, 2)

    // #then
    expect(pruned).toBe(0)
    expect(state.toolPruneActions.size).toBe(0)
  })

  test("clear-results keeps at least the protected turns", () => {
    // #given: 4 turns, keep_recent_turns=1 but protect last 2 turns
    spyOn(shared, "readMessages").mockReturnValue([
      { parts: [{ type: "step-start" }, { type: "tool", callID: "c1", tool: "grep", state: { input: {}, output: "turn1" } }] },
      { parts: [{ type: "step-start" }, { type: "tool", callID: "c2", tool: "grep", state: { input: {}, output: "turn2" } }] },
      { parts: [{ type: "step-start" }, { type: "tool", callID: "c3", tool: "grep", state: { input: {}, output: "turn3" } }] },
      { parts: [{ type: "step-start" }, { type: "tool", callID: "c4", tool: "grep", state: { input: {}, output: "turn4" } }] },
    ] as any)

    // #when
    const pruned = executeClearResults(sessionID, state, { enabled: true, keep_recent_turns: 1 }, protectedTools, 2)

    // #then: only turn 1 is prunable (turns 3 and 4 protected; turn 2 kept via effective keep)
    expect(pruned).toBe(1)
    expect(state.toolPruneActions.get("c1")?.pruneOutput).toBe(true)
    expect(state.toolPruneActions.get("c1")?.pruneInput).toBe(false)
    expect(state.toolPruneActions.has("c2")).toBe(false)
    expect(state.toolPruneActions.has("c3")).toBe(false)
    expect(state.toolPruneActions.has("c4")).toBe(false)
  })

  test("supersede-writes does not prune within last N turns", () => {
    // #given: write in turn 3 superseded by read in turn 4
    spyOn(shared, "readMessages").mockReturnValue([
      { parts: [{ type: "step-start" }] },
      { parts: [{ type: "step-start" }] },
      { parts: [{ type: "step-start" }, { type: "tool", callID: "w1", tool: "write", state: { input: { filePath: "x.txt" }, output: "ok" } }] },
      { parts: [{ type: "step-start" }, { type: "tool", callID: "r1", tool: "read", state: { input: { filePath: "x.txt" }, output: "contents" } }] },
    ] as any)

    // #when
    const pruned = executeSupersedeWrites(sessionID, state, { enabled: true, aggressive: true }, protectedTools, 2)

    // #then
    expect(pruned).toBe(0)
    expect(state.toolPruneActions.has("w1")).toBe(false)
  })

  test("purge-errors does not prune within last N turns", () => {
    // #given: error in turn 3 would be eligible by age, but is protected
    spyOn(shared, "readMessages").mockReturnValue([
      { parts: [{ type: "step-start" }] },
      { parts: [{ type: "step-start" }] },
      { parts: [{ type: "step-start" }, { type: "tool", callID: "e1", tool: "bash", state: { status: "error", input: { cmd: "bad" }, output: "err" } }] },
      { parts: [{ type: "step-start" }] },
    ] as any)

    // #when
    const pruned = executePurgeErrors(sessionID, state, { enabled: true, turns: 1 }, protectedTools, 2)

    // #then
    expect(pruned).toBe(0)
    expect(state.toolPruneActions.has("e1")).toBe(false)
  })
})
