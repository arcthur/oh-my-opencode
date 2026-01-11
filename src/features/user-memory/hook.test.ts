import { describe, test, expect, spyOn, beforeEach, afterEach, mock } from "bun:test"
import type { PluginInput } from "@opencode-ai/plugin"
import { createUserMemoryHook } from "./hook"
import * as storage from "./storage"
import { DEFAULT_PATTERN_STATS } from "./types"

describe("createUserMemoryHook", () => {
  let ctx: PluginInput
  let savePatternStatsSpy: ReturnType<typeof spyOn>
  let aggregateFrequentPatternsSpy: ReturnType<typeof spyOn>

  beforeEach(() => {
    ctx = {
      directory: "/test/project",
      client: {},
    } as unknown as PluginInput

    spyOn(storage, "loadPatternStats").mockReturnValue({ ...DEFAULT_PATTERN_STATS })
    savePatternStatsSpy = spyOn(storage, "savePatternStats").mockImplementation(() => {})
    aggregateFrequentPatternsSpy = spyOn(storage, "aggregateFrequentPatterns").mockImplementation(() => [])
    spyOn(storage, "recordToolUsage").mockImplementation(() => {})
    spyOn(storage, "getMemorySummary").mockReturnValue("[User Memory]\n- pref: concise")
  })

  afterEach(() => {
    mock.restore()
  })

  test("injects memory once per session", async () => {
    // #given
    const hook = createUserMemoryHook(ctx)

    const input = { tool: "Read", sessionID: "s1", callID: "c1" }
    const output = { title: "ok", output: "tool output", metadata: {} }

    // #when
    await hook["tool.execute.after"](input as never, output as never)
    await hook["tool.execute.after"](input as never, output as never)

    // #then
    const occurrences = output.output.split("[User Memory]").length - 1
    expect(occurrences).toBe(1)
  })

  test("captures declarative remember statements, not imperative remember-to", async () => {
    // #given
    const addExplicitMemorySpy = spyOn(storage, "addExplicitMemory").mockImplementation(() => {})
    const hook = createUserMemoryHook(ctx)

    // #when
    await hook["user.prompt.submit"]({ message: { content: "Remember that we prefer bun." } } as never)
    await hook["user.prompt.submit"]({ message: { content: "remember to run tests" } } as never)

    // #then
    expect(addExplicitMemorySpy).toHaveBeenCalledTimes(1)
    expect(addExplicitMemorySpy).toHaveBeenCalledWith("we prefer bun.")
  })

  test("persists pattern stats on session.compacted and session.deleted", async () => {
    // #given
    const hook = createUserMemoryHook(ctx)

    // #when
    await hook.event({ event: { type: "session.compacted", properties: { sessionID: "s1" } } } as never)
    await hook.event({ event: { type: "session.deleted", properties: { info: { id: "s1" } } } } as never)

    // #then
    expect(savePatternStatsSpy).toHaveBeenCalledTimes(2)
    expect(aggregateFrequentPatternsSpy).toHaveBeenCalledTimes(2)
  })
})
