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
})
