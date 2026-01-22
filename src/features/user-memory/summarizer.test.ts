import { afterEach, describe, expect, mock, test, beforeEach } from "bun:test"
import type { PluginInput } from "@opencode-ai/plugin"
import {
  createUserMemorySummarizer,
  createAggregationSummarizer,
  CircuitOpenError,
} from "./summarizer"

describe("user-memory summarizer", () => {
  afterEach(() => {
    mock.restore()
  })

  describe("createUserMemorySummarizer", () => {
    test("returns undefined if session API is unavailable", () => {
      const ctx = {
        directory: "/test",
        client: {},
      } as unknown as PluginInput

      const summarizer = createUserMemorySummarizer(ctx)
      expect(summarizer).toBeUndefined()
    })

    test("uses aggregation_model mapping and returns assistant text", async () => {
      const create = mock(() => Promise.resolve({ data: { id: "session-1" } }))
      const prompt = mock(() => Promise.resolve({}))
      const messages = mock(() =>
        Promise.resolve({
          data: [
            {
              info: { role: "assistant", time: { created: 10 } },
              parts: [{ type: "text", text: '{"summary":"ok","achievements":[],"lessons":[]}' }],
            },
          ],
        })
      )
      const ctx = {
        directory: "/test/project",
        client: { session: { create, prompt, messages } },
      } as unknown as PluginInput

      const summarizer = createUserMemorySummarizer(ctx, {
        categories: { "unspecified-low": { model: "openai/gpt-5.2" } },
      })

      const result = await summarizer!.summarize("prompt", { kind: "weekly", model: "sonnet" })

      expect(result).toContain('"summary"')
      const calls = prompt.mock.calls as unknown as Array<
        [{ body?: { model?: { providerID?: string; modelID?: string } } }]
      >
      const promptArgs = calls[0]?.[0]
      expect(promptArgs?.body?.model?.providerID).toBe("openai")
      expect(promptArgs?.body?.model?.modelID).toBe("gpt-5.2")
    })

    test("reuses sessions for same kind and model", async () => {
      const create = mock(() => Promise.resolve({ data: { id: "session-1" } }))
      const prompt = mock(() => Promise.resolve({}))
      const messages = mock(() =>
        Promise.resolve({
          data: [
            {
              info: { role: "assistant", time: { created: 10 } },
              parts: [{ type: "text", text: '{"summary":"ok"}' }],
            },
          ],
        })
      )
      const ctx = {
        directory: "/test",
        client: { session: { create, prompt, messages } },
      } as unknown as PluginInput

      const summarizer = createUserMemorySummarizer(ctx)

      await summarizer!.summarize("prompt1", { kind: "weekly", model: "haiku" })
      await summarizer!.summarize("prompt2", { kind: "weekly", model: "haiku" })

      // Should only create one session
      expect(create).toHaveBeenCalledTimes(1)
    })

    test("creates separate sessions for different kinds", async () => {
      const create = mock(() => Promise.resolve({ data: { id: `session-${Date.now()}` } }))
      const prompt = mock(() => Promise.resolve({}))
      const messages = mock(() =>
        Promise.resolve({
          data: [
            {
              info: { role: "assistant", time: { created: 10 } },
              parts: [{ type: "text", text: '{"summary":"ok"}' }],
            },
          ],
        })
      )
      const ctx = {
        directory: "/test",
        client: { session: { create, prompt, messages } },
      } as unknown as PluginInput

      const summarizer = createUserMemorySummarizer(ctx)

      await summarizer!.summarize("prompt1", { kind: "weekly", model: "haiku" })
      await summarizer!.summarize("prompt2", { kind: "monthly", model: "haiku" })

      expect(create).toHaveBeenCalledTimes(2)
    })
  })

  describe("circuit breaker", () => {
    test("opens circuit after threshold failures", async () => {
      let callCount = 0
      const create = mock(() => Promise.resolve({ data: { id: "session-1" } }))
      const prompt = mock(() => {
        callCount++
        return Promise.reject(new Error("API Error"))
      })
      const messages = mock(() => Promise.resolve({ data: [] }))
      const ctx = {
        directory: "/test",
        client: { session: { create, prompt, messages } },
      } as unknown as PluginInput

      const summarizer = createUserMemorySummarizer(ctx)

      // Make failures to trigger circuit breaker (threshold is 3)
      for (let i = 0; i < 3; i++) {
        try {
          await summarizer!.summarize("prompt", { kind: "weekly", model: "haiku" })
        } catch {
          // Expected
        }
      }

      expect(summarizer!.getCircuitState()).toBe("open")

      // Next call should throw CircuitOpenError without hitting API
      const beforeCount = callCount
      await expect(
        summarizer!.summarize("prompt", { kind: "weekly", model: "haiku" })
      ).rejects.toBeInstanceOf(CircuitOpenError)
      expect(callCount).toBe(beforeCount) // No new API call
    })

    test("resets circuit on success", async () => {
      let shouldFail = true
      const create = mock(() => Promise.resolve({ data: { id: "session-1" } }))
      const prompt = mock(() => {
        if (shouldFail) {
          return Promise.reject(new Error("API Error"))
        }
        return Promise.resolve({})
      })
      const messages = mock(() =>
        Promise.resolve({
          data: [
            {
              info: { role: "assistant", time: { created: 10 } },
              parts: [{ type: "text", text: '{"summary":"ok"}' }],
            },
          ],
        })
      )
      const ctx = {
        directory: "/test",
        client: { session: { create, prompt, messages } },
      } as unknown as PluginInput

      const summarizer = createUserMemorySummarizer(ctx)

      // Make one failure
      try {
        await summarizer!.summarize("prompt", { kind: "weekly", model: "haiku" })
      } catch {
        // Expected
      }

      // Now succeed
      shouldFail = false
      await summarizer!.summarize("prompt", { kind: "weekly", model: "haiku" })

      expect(summarizer!.getCircuitState()).toBe("closed")
    })

    test("can manually reset circuit", async () => {
      const create = mock(() => Promise.resolve({ data: { id: "session-1" } }))
      const prompt = mock(() => Promise.reject(new Error("API Error")))
      const messages = mock(() => Promise.resolve({ data: [] }))
      const ctx = {
        directory: "/test",
        client: { session: { create, prompt, messages } },
      } as unknown as PluginInput

      const summarizer = createUserMemorySummarizer(ctx)

      // Trigger failures
      for (let i = 0; i < 3; i++) {
        try {
          await summarizer!.summarize("prompt", { kind: "weekly", model: "haiku" })
        } catch {
          // Expected
        }
      }

      expect(summarizer!.getCircuitState()).toBe("open")

      summarizer!.resetCircuit()
      expect(summarizer!.getCircuitState()).toBe("closed")
    })
  })

  describe("createAggregationSummarizer", () => {
    test("returns fallback when no summarizer provided", async () => {
      const summarizer = createAggregationSummarizer(undefined, { aggregation_model: "haiku" })
      const result = await summarizer("test prompt")

      expect(result.summary).toBe("")
      expect(result.achievements).toEqual([])
      expect(result.lessons).toEqual([])
    })

    test("parses weekly response correctly", async () => {
      const mockSummarizer = {
        summarize: mock(() =>
          Promise.resolve('{"summary": "Did work", "achievements": ["thing"], "lessons": []}')
        ),
        getCircuitState: () => "closed" as const,
        resetCircuit: () => {},
      }

      const summarizer = createAggregationSummarizer(mockSummarizer, { aggregation_model: "haiku" })
      const result = await summarizer("[UserMemory:Weekly] summarize this")

      expect(result.summary).toBe("Did work")
      expect(result.achievements).toEqual(["thing"])
    })

    test("parses monthly response correctly", async () => {
      const mockSummarizer = {
        summarize: mock(() =>
          Promise.resolve(
            '{"summary": "Month recap", "achievements": ["ship"], "lessons": ["focus"], "techEvolution": "TypeScript"}'
          )
        ),
        getCircuitState: () => "closed" as const,
        resetCircuit: () => {},
      }

      const summarizer = createAggregationSummarizer(mockSummarizer, { aggregation_model: "haiku" })
      const result = await summarizer("[UserMemory:Monthly] summarize this")

      expect(result.summary).toBe("Month recap")
      expect(result.achievements).toEqual(["ship"])
      expect(result.techEvolution).toBe("TypeScript")
    })

    test("returns fallback on circuit open", async () => {
      const mockSummarizer = {
        summarize: mock(() => Promise.reject(new CircuitOpenError("Circuit open"))),
        getCircuitState: () => "open" as const,
        resetCircuit: () => {},
      }

      const summarizer = createAggregationSummarizer(mockSummarizer, { aggregation_model: "haiku" })
      const result = await summarizer("test prompt")

      expect(result.summary).toBe("")
    })
  })
})
