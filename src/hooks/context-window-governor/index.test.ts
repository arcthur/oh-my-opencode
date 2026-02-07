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
        prompt_async: mock(() => Promise.resolve()),
      },
      tui: {
        showToast: overrides?.showToast ?? mock(() => Promise.resolve()),
      },
    },
  } as never
}

describe("context-window-governor hook", () => {
  test("warns and preemptively compacts using unified snapshot", async () => {
    // #given
    const summarize = mock(() => Promise.resolve())
    let calls = 0
    const messages = mock(() => {
      calls += 1
      const input = calls === 1 ? 142000 : 160000
      return Promise.resolve({
        data: [
          {
            info: {
              role: "assistant",
              providerID: "anthropic",
              modelID: "claude-opus-4-5",
              tokens: {
                input,
                output: 1000,
                reasoning: 0,
                cache: { read: 0, write: 0 },
              },
            },
          },
        ],
      })
    })

    const hook = createContextWindowGovernorHook(createCtx({ summarize, messages }), {
      warningRatio: 0.7,
      preemptiveRatio: 0.78,
      warningResetRatio: 0.65,
      preemptiveResetRatio: 0.73,
    })

    const output = { title: "", output: "tool-output", metadata: {} }

    // #when
    await hook["tool.execute.after"]({ tool: "Read", sessionID: "s1", callID: "c1" }, output)
    await hook["tool.execute.after"]({ tool: "Read", sessionID: "s1", callID: "c2" }, output)

    // #then
    expect(output.output).toContain("SYSTEM REMINDER")
    expect(summarize).toHaveBeenCalledTimes(1)
    expect(messages).toHaveBeenCalledTimes(2)
  })

  test("runs recovery after preemptive failure releases lease if recovery was scheduled mid-compaction", async () => {
    // #given
    let rejectPreemptive: ((error: unknown) => void) | undefined
    const preemptiveGate = new Promise<void>((_resolve, reject) => {
      rejectPreemptive = reject
    })

    let summarizeCalls = 0
    const summarize = mock(() => {
      summarizeCalls += 1
      if (summarizeCalls === 1) {
        return preemptiveGate
      }
      return Promise.resolve()
    })

    const showToast = mock(() => Promise.resolve())
    const messages = mock(() =>
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
    )

    const hook = createContextWindowGovernorHook(
      createCtx({ summarize, messages, showToast }),
      {
        recovery: {
          maxAttempts: 1,
          initialDelayMs: 0,
          maxDelayMs: 0,
          toastCooldownMs: 0,
        },
      }
    )

    const output = { title: "", output: "tool-output", metadata: {} }

    // #when
    const preemptivePromise = hook["tool.execute.after"](
      { tool: "Read", sessionID: "s5", callID: "c1" },
      output
    )

    // Wait for preemptive summarize call to start.
    const startDeadline = Date.now() + 1000
    while (summarizeCalls !== 1) {
      if (Date.now() > startDeadline) {
        throw new Error("Preemptive summarize did not start within 1s.")
      }
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
    expect(summarizeCalls).toBe(1)

    await hook.event({
      event: {
        type: "session.error",
        properties: {
          sessionID: "s5",
          error: "prompt is too long: 250000 tokens > 200000 maximum",
        },
      },
    })

    // Recovery attempt while lease is held should be skipped.
    await hook.event({ event: { type: "session.idle", properties: { sessionID: "s5" } } })
    expect(summarizeCalls).toBe(1)

    rejectPreemptive?.(new Error("preemptive-failed"))
    await preemptivePromise

    // #then
    expect(summarizeCalls).toBe(2)
  })

  test("caps recovery retries and suppresses toast spam when identity is missing", async () => {
    // #given
    const summarize = mock(() => Promise.resolve())
    const showToast = mock(() => Promise.resolve())
    const messages = mock(() =>
      Promise.resolve({
        data: [
          {
            info: {
              role: "assistant",
              providerID: "anthropic",
              tokens: {
                input: 10,
                output: 0,
                reasoning: 0,
                cache: { read: 0, write: 0 },
              },
            },
          },
        ],
      })
    )

    const hook = createContextWindowGovernorHook(createCtx({ summarize, showToast, messages }), {
      recovery: {
        maxAttempts: 2,
        initialDelayMs: 0,
        maxDelayMs: 0,
        toastCooldownMs: 60_000,
      },
    })

    // #when
    await hook.event({
      event: {
        type: "session.error",
        properties: {
          sessionID: "s4",
          error: "prompt is too long: 250000 tokens > 200000 maximum",
        },
      },
    })

    for (let i = 0; i < 5; i++) {
      await hook.event({
        event: { type: "session.idle", properties: { sessionID: "s4" } },
      })
    }

    // #then
    expect(summarize).toHaveBeenCalledTimes(0)
    expect(showToast).toHaveBeenCalledTimes(1)
  })

  test("runs recovery on session.error then session.idle", async () => {
    // #given
    const summarize = mock(() => Promise.resolve())
    const hook = createContextWindowGovernorHook(createCtx({ summarize }))

    // #when
    await hook.event({
      event: {
        type: "session.error",
        properties: {
          sessionID: "s2",
          error: "prompt is too long: 250000 tokens > 200000 maximum",
        },
      },
    })

    await hook.event({
      event: {
        type: "session.idle",
        properties: { sessionID: "s2" },
      },
    })

    // #then
    expect(summarize).toHaveBeenCalledTimes(1)
  })

  test("injects compaction context without extra session.messages in compacting event", async () => {
    // #given
    const messages = mock(() => Promise.resolve({ data: [] }))
    const hook = createContextWindowGovernorHook(createCtx({ messages }))
    const output = { context: [] as string[] }

    // #when
    await hook["experimental.session.compacting"]({ sessionID: "s3" }, output)

    // #then
    expect(output.context.length).toBeGreaterThan(0)
    expect(messages).toHaveBeenCalledTimes(0)
  })
})
