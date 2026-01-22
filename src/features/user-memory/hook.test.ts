import { describe, test, expect, spyOn, beforeEach, afterEach, mock } from "bun:test"
import type { PluginInput } from "@opencode-ai/plugin"
import { createUserMemoryHook, type UserMemorySummarizer } from "./hook"
import * as storage from "./storage"
import { DEFAULT_PATTERN_STATS, DEFAULT_USER_MEMORY } from "./types"

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

  test("uses injected summarizer for aggregation prompts", async () => {
    // #given
    const now = 1_700_000_000_000
    spyOn(Date, "now").mockReturnValue(now)
    spyOn(storage, "loadUserMemory").mockReturnValue({
      ...DEFAULT_USER_MEMORY,
      workHistory: [
        {
          timestamp: now - 6 * 24 * 60 * 60 * 1000,
          summary: "Worked on module X",
          project: "proj-x",
          outcome: "success",
        },
      ],
      lastWeeklyAggregation: now - 8 * 24 * 60 * 60 * 1000,
      lastMonthlyAggregation: now,
      lastKnowledgeExtraction: now,
    })
    spyOn(storage, "saveUserMemory").mockImplementation(() => {})

    const summarizer: UserMemorySummarizer = {
      summarize: async () =>
        JSON.stringify({
          summary: "Weekly summary",
          achievements: [],
          lessons: [],
        }),
      getCircuitState: () => "closed",
      resetCircuit: () => {},
    }
    const summarizeSpy = spyOn(summarizer, "summarize")

    const hook = createUserMemoryHook(ctx, undefined, { summarizer })

    // #when
    await hook.event({ event: { type: "session.deleted", properties: { info: { id: "s1" } } } } as never)

    // #then
    expect(summarizeSpy).toHaveBeenCalled()
  })

  test("augments long-term knowledge with LLM extraction", async () => {
    // #given
    const now = 1_700_000_000_000
    spyOn(Date, "now").mockReturnValue(now)
    spyOn(storage, "loadUserMemory").mockReturnValue({
      ...DEFAULT_USER_MEMORY,
      workHistory: [],
      monthlySummaries: [
        {
          month: "2025-01",
          summary: "Worked on testing strategy.",
          projects: ["proj-x"],
          keyAchievements: ["Improved coverage"],
          lessonsLearned: ["Write tests early"],
          techStackEvolution: "TypeScript",
          weekCount: 4,
        },
      ],
      longTermKnowledge: [],
      lastWeeklyAggregation: now - 10 * 24 * 60 * 60 * 1000,
      lastMonthlyAggregation: now - 40 * 24 * 60 * 60 * 1000,
      lastKnowledgeExtraction: now - 200 * 24 * 60 * 60 * 1000,
    })
    const saveSpy = spyOn(storage, "saveUserMemory").mockImplementation(() => {})

    const summarizer: UserMemorySummarizer = {
      summarize: async (_prompt, options) => {
        if (options.kind === "knowledge") {
          return JSON.stringify({
            knowledge: [
              {
                category: "lesson",
                content: "Write tests early",
                confidence: 0.7,
                sourceMonths: ["2025-01", "2025-02"],
              },
            ],
          })
        }
        return JSON.stringify({
          summary: "Weekly summary",
          achievements: [],
          lessons: [],
        })
      },
      getCircuitState: () => "closed",
      resetCircuit: () => {},
    }

    const hook = createUserMemoryHook(ctx, undefined, { summarizer })

    // #when
    await hook.event({ event: { type: "session.deleted", properties: { info: { id: "s1" } } } } as never)

    // #then
    const saved = saveSpy.mock.calls[0]?.[0]
    const knowledge = saved?.longTermKnowledge ?? []
    expect(knowledge.some((k: { content?: string }) => k.content === "Write tests early")).toBe(true)
  })
})
