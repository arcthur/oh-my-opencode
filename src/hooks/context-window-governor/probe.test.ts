import { describe, expect, mock, test } from "bun:test"
import { createContextWindowProbe } from "./probe"

describe("context-window probe", () => {
  test("deduplicates session.messages for same session + callID", async () => {
    // #given
    const messages = mock(() =>
      Promise.resolve({
        data: [
          {
            info: {
              role: "assistant",
              providerID: "anthropic",
              modelID: "claude-opus-4-5",
              tokens: {
                input: 140000,
                output: 1000,
                reasoning: 0,
                cache: { read: 10000, write: 0 },
              },
            },
          },
        ],
      })
    )

    const probe = createContextWindowProbe({
      client: { session: { messages } } as never,
      resolveLimit: () => 200000,
    })

    // #when
    const a = await probe.getSnapshot({ sessionID: "s1", callID: "c1" })
    const b = await probe.getSnapshot({ sessionID: "s1", callID: "c1" })

    // #then
    expect(messages).toHaveBeenCalledTimes(1)
    expect(a?.usageRatio).toBe(0.75)
    expect(b?.usageRatio).toBe(0.75)
  })

  test("parses usage payloads where prompt tokens already include cached tokens", async () => {
    // #given
    const messages = mock(() =>
      Promise.resolve({
        data: [
          {
            info: {
              role: "assistant",
              providerID: "openai",
              modelID: "gpt-5",
              usage: {
                prompt_tokens: 2000,
                completion_tokens: 500,
                prompt_tokens_details: { cached_tokens: 600 },
              },
            },
          },
        ],
      })
    )

    const probe = createContextWindowProbe({
      client: { session: { messages } } as never,
      resolveLimit: () => 4000,
    })

    // #when
    const snapshot = await probe.getSnapshot({ sessionID: "s-openai", callID: "c-1" })

    // #then
    expect(snapshot?.usedInputCacheTokens).toBe(2000)
    expect(snapshot?.cacheReadTokens).toBe(600)
    expect(snapshot?.cacheHitRatio).toBeCloseTo(0.3, 5)
    expect(snapshot?.usageRatio).toBeCloseTo(0.5, 5)
  })
})
