import { describe, expect, mock, test } from "bun:test"
import { createContextWindowGovernorHook } from "./index"

function createCtx(overrides?: {
  messages?: ReturnType<typeof mock>
  summarize?: ReturnType<typeof mock>
  showToast?: ReturnType<typeof mock>
}) {
  return {
    directory: "/tmp/project",
    client: {
      session: {
        messages:
          overrides?.messages ??
          mock(() =>
            Promise.resolve({
              data: [
                {
                  info: {
                    role: "assistant",
                    providerID: "anthropic",
                    modelID: "claude-opus-4-5",
                    tokens: {
                      input: 160000,
                      output: 1000,
                      reasoning: 0,
                      cache: { read: 0, write: 0 },
                    },
                  },
                },
              ],
            })
          ),
        summarize: overrides?.summarize ?? mock(() => Promise.resolve()),
        promptAsync: mock(() => Promise.resolve()),
        prompt: mock(() => Promise.resolve()),
      },
      tui: {
        showToast: overrides?.showToast ?? mock(() => Promise.resolve()),
      },
    },
  } as never
}

describe("context-window-governor prefix stability", () => {
  test("strict mode blocks destructive recovery when budget is exhausted and hard limit bypass is not reached", async () => {
    // #given
    const summarize = mock(() => Promise.resolve())
    const hook = createContextWindowGovernorHook(createCtx({ summarize }), {
      recovery: {
        maxAttempts: 1,
        initialDelayMs: 0,
        maxDelayMs: 0,
        toastCooldownMs: 0,
      },
      prefixStability: {
        mode: "strict",
        maxDestructiveRecoveries: 0,
        windowMs: 60_000,
        cooldownMs: 60_000,
        hardLimitBypassRatio: 1.05,
      },
    })

    // #when
    await hook.event({
      event: {
        type: "session.error",
        properties: {
          sessionID: "s-prefix-1",
          error: "prompt is too long: 190000 tokens > 200000 maximum",
        },
      },
    })
    await hook.event({
      event: {
        type: "session.idle",
        properties: { sessionID: "s-prefix-1" },
      },
    })

    // #then
    expect(summarize).toHaveBeenCalledTimes(0)
  })

  test("hard limit bypass allows destructive recovery even when prefix budget is exhausted", async () => {
    // #given
    const summarize = mock(() => Promise.resolve())
    const hook = createContextWindowGovernorHook(createCtx({ summarize }), {
      recovery: {
        maxAttempts: 1,
        initialDelayMs: 0,
        maxDelayMs: 0,
        toastCooldownMs: 0,
      },
      prefixStability: {
        mode: "strict",
        maxDestructiveRecoveries: 0,
        windowMs: 60_000,
        cooldownMs: 60_000,
        hardLimitBypassRatio: 0.9,
      },
    })

    // #when
    await hook.event({
      event: {
        type: "session.error",
        properties: {
          sessionID: "s-prefix-2",
          error: "prompt is too long: 190000 tokens > 200000 maximum",
        },
      },
    })

    const deadline = Date.now() + 1000
    while (summarize.mock.calls.length < 1) {
      if (Date.now() > deadline) {
        break
      }
      await new Promise((resolve) => setTimeout(resolve, 0))
    }

    // #then
    expect(summarize).toHaveBeenCalledTimes(1)
  })
})

