import { describe, test, expect, spyOn, beforeEach, afterEach, mock } from "bun:test"
import type { PluginInput } from "@opencode-ai/plugin"
import { createUserMemoryHook, type UserMemorySummarizer } from "./hook"
import * as storage from "./storage"
import { DEFAULT_PATTERN_STATS, DEFAULT_USER_MEMORY } from "./types"
import * as embeddingsProvider from "./embeddings/provider"
import * as embeddingsCache from "./embeddings/cache"
import * as bm25 from "./embeddings/bm25"

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

  test("BM25 index uses most recent 20 work history entries (not oldest)", async () => {
    // #given
    const now = 1_700_000_000_000
    spyOn(Date, "now").mockReturnValue(now)

    const workHistory = Array.from({ length: 30 }, (_, i) => ({
      // Newest first: 30..1
      timestamp: now - i * 1000,
      summary: `entry-${30 - i}`,
      project: "proj-x",
    }))

    spyOn(storage, "loadUserMemory").mockReturnValue({
      ...DEFAULT_USER_MEMORY,
      workHistory,
      lastWeeklyAggregation: now,
      lastMonthlyAggregation: now,
      lastKnowledgeExtraction: now,
    })
    spyOn(storage, "saveUserMemory").mockImplementation(() => {})

    // Avoid loading real embedding providers / touching disk
    spyOn(embeddingsProvider, "getProviderWithFallback").mockResolvedValue({
      provider: { name: "local", dimension: 384, embed: async () => [[]], isAvailable: async () => true },
      usedFallback: false,
    })
    spyOn(embeddingsCache, "loadEmbeddingCache").mockReturnValue(null)
    spyOn(embeddingsCache, "saveEmbeddingCache").mockImplementation(() => {})

    const buildBM25Spy = spyOn(bm25, "buildBM25Index")

    const hook = createUserMemoryHook(ctx, {
      embeddings: { enabled: true, provider: "local", cache_enabled: false, batch_size: 20 },
    })

    // #when
    await hook.event({ event: { type: "session.deleted", properties: { info: { id: "s1" } } } } as never)

    // #then
    expect(buildBM25Spy).toHaveBeenCalled()
    const docs = buildBM25Spy.mock.calls[0]?.[0] as Array<{ id: string; text: string }>
    const historyDocs = docs.filter((d) => d.id.startsWith("history:"))
    expect(historyDocs).toHaveLength(20)

    // Should include newest (entry-30 .. entry-11), exclude oldest (entry-10 .. entry-1)
    const texts = historyDocs.map((d) => d.text)
    expect(texts.some((t) => t.endsWith("entry-30"))).toBe(true)
    expect(texts.some((t) => t.endsWith("entry-11"))).toBe(true)
    expect(texts.some((t) => t.endsWith("entry-10"))).toBe(false)
    expect(texts.some((t) => t.endsWith("entry-1"))).toBe(false)
  })

  test("when provider fallback is used, saved cache metadata matches actual provider", async () => {
    // #given
    const now = 1_700_000_000_000
    spyOn(Date, "now").mockReturnValue(now)

    spyOn(storage, "loadUserMemory").mockReturnValue({
      ...DEFAULT_USER_MEMORY,
      workHistory: [
        { timestamp: now - 1000, summary: "did something", project: "proj-x" },
      ],
      lastWeeklyAggregation: now,
      lastMonthlyAggregation: now,
      lastKnowledgeExtraction: now,
    })
    spyOn(storage, "saveUserMemory").mockImplementation(() => {})

    // Config says openai, but provider falls back to local
    spyOn(embeddingsProvider, "getProviderWithFallback").mockResolvedValue({
      provider: { name: "local", dimension: 384, embed: async () => [[]], isAvailable: async () => true },
      usedFallback: true,
    })
    spyOn(embeddingsCache, "loadEmbeddingCache").mockReturnValue(null)
    const saveCacheSpy = spyOn(embeddingsCache, "saveEmbeddingCache").mockImplementation(() => {})
    spyOn(bm25, "buildBM25Index").mockImplementation(() => ({
      documents: [],
      documentFrequency: new Map(),
      avgDocLength: 0,
      totalDocuments: 0,
      version: 1,
      lastUpdated: now,
    }))

    const hook = createUserMemoryHook(ctx, {
      embeddings: { enabled: true, provider: "openai", cache_enabled: false, batch_size: 20, openai_model: "text-embedding-3-small" },
    })

    // #when
    await hook.event({ event: { type: "session.deleted", properties: { info: { id: "s1" } } } } as never)

    // #then
    expect(saveCacheSpy).toHaveBeenCalled()
    const savedEmbeddings = saveCacheSpy.mock.calls[0]?.[0] as { provider: string; model: string; dimension: number }
    expect(savedEmbeddings.provider).toBe("local")
    expect(savedEmbeddings.dimension).toBe(384)
  })

  test("injects context-aware relevant memory on user prompt when embeddings enabled", async () => {
    // #given
    const mockCollector = {
      register: mock(() => {}),
      resetOncePerSession: mock(() => {}),
    }

    spyOn(storage, "getContextAwareMemorySummary").mockResolvedValue("[Relevant User Memory]\n- X\n[End User Memory]")
    spyOn(storage, "getMemorySummary").mockReturnValue("[User Memory]\n- baseline")

    const hook = createUserMemoryHook(
      ctx,
      {
        embeddings: { enabled: true, provider: "local", cache_enabled: false, batch_size: 20 },
      },
      { collector: mockCollector as never }
    )

    // #when
    await hook["user.prompt.submit"]({
      sessionID: "s1",
      message: { role: "user", content: "We are working on user-memory embeddings scoring." },
    } as never)

    // #then
    const calls = mockCollector.register.mock.calls as unknown as Array<
      [string, { id: string; source: string; content: string; priority?: string; oncePerSession?: boolean }]
    >
    // Should register relevant context (priority high, not once-per-session)
    expect(calls.some((c) =>
      c[0] === "s1" &&
      c[1].source === "user-memory" &&
      c[1].id === "user-memory-relevant" &&
      c[1].priority === "high" &&
      c[1].oncePerSession !== true &&
      c[1].content.includes("[Relevant User Memory]")
    )).toBe(true)
  })

  test("registers memory context with collector (once per session)", async () => {
    // #given
    const mockCollector = {
      register: mock(() => {}),
      resetOncePerSession: mock(() => {}),
    }
    const hook = createUserMemoryHook(ctx, undefined, { collector: mockCollector as never })

    const input = { tool: "Read", sessionID: "s1", callID: "c1" }
    const output = {}

    // #when
    await hook["tool.execute.before"]?.(input as never, output as never)
    await hook["tool.execute.before"]?.(input as never, output as never)

    // #then - collector handles once-per-session internally via oncePerSession flag
    expect(mockCollector.register).toHaveBeenCalledTimes(2)
    const calls = mockCollector.register.mock.calls as unknown as [string, { source: string; oncePerSession: boolean }][]
    expect(calls[0][1]).toMatchObject({
      source: "user-memory",
      oncePerSession: true,
    })
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
