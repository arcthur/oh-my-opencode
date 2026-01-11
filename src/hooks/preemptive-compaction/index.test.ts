import { describe, test, expect, mock, beforeEach, afterEach, spyOn } from "bun:test"
import type { PluginInput } from "@opencode-ai/plugin"
import { createPreemptiveCompactionHook } from "./index"
import {
  DEFAULT_THRESHOLD,
  MIN_TOKENS_FOR_COMPACTION,
  COMPACTION_COOLDOWN_MS,
} from "./constants"
import * as hookMessageInjector from "../../features/hook-message-injector"

interface MockTokens {
  input: number
  output: number
  reasoning: number
  cache: { read: number; write: number }
}

function createMockTokens(overrides?: Partial<MockTokens>): MockTokens {
  return {
    input: 100000,
    output: 5000,
    reasoning: 0,
    cache: { read: 50000, write: 0 },
    ...overrides,
  }
}

function createMockCtx(
  directory = "/test/project",
  messagesResponse: unknown = { data: [] }
): PluginInput {
  return {
    directory,
    client: {
      session: {
        messages: mock(() => Promise.resolve(messagesResponse)),
        summarize: mock(() => Promise.resolve()),
      },
      tui: {
        showToast: mock(() => Promise.resolve()),
      },
    },
  } as unknown as PluginInput
}

function createMessageInfo(overrides?: Record<string, unknown>) {
  return {
    id: "msg-123",
    role: "assistant",
    sessionID: "session-123",
    providerID: "anthropic",
    modelID: "claude-sonnet-4-20250514",
    tokens: createMockTokens(),
    summary: false,
    finish: true,
    ...overrides,
  }
}

describe("createPreemptiveCompactionHook", () => {
  let mockCtx: PluginInput
  let findNearestMessageSpy: ReturnType<typeof spyOn>

  beforeEach(() => {
    mockCtx = createMockCtx()
    findNearestMessageSpy = spyOn(
      hookMessageInjector,
      "findNearestMessageWithFields"
    ).mockReturnValue(null)
  })

  afterEach(() => {
    findNearestMessageSpy.mockRestore()
  })

  // #region initialization
  describe("initialization", () => {
    test("returns noop handler when explicitly disabled via config", async () => {
      // #given: Explicitly disabled config
      const hook = createPreemptiveCompactionHook(mockCtx, {
        experimental: { preemptive_compaction: false },
      })

      // #when: Trigger event with high usage
      const event = {
        event: {
          type: "message.updated",
          properties: {
            info: createMessageInfo({
              tokens: createMockTokens({ input: 180000 }),
            }),
          },
        },
      }
      await hook.event(event)

      // #then: Should not call summarize (noop)
      expect(mockCtx.client.session.summarize).not.toHaveBeenCalled()
    })

    // Note: custom threshold behavior is tested in boundary value tests
  })
  // #endregion

  // #region model support
  describe("model support", () => {
    test("supports claude models", async () => {
      // #given: Claude model with high usage
      const hook = createPreemptiveCompactionHook(mockCtx)
      const event = {
        event: {
          type: "message.updated",
          properties: {
            info: createMessageInfo({
              modelID: "claude-sonnet-4-20250514",
              tokens: createMockTokens({ input: 180000 }),
            }),
          },
        },
      }

      // #when
      await hook.event(event)

      // #then: Should trigger compaction
      expect(mockCtx.client.session.summarize).toHaveBeenCalled()
    })

    test("does not support non-claude models", async () => {
      // #given: GPT model
      const hook = createPreemptiveCompactionHook(mockCtx)
      const event = {
        event: {
          type: "message.updated",
          properties: {
            info: createMessageInfo({
              modelID: "gpt-4-turbo",
              tokens: createMockTokens({ input: 180000 }),
            }),
          },
        },
      }

      // #when
      await hook.event(event)

      // #then: Should not process
      expect(mockCtx.client.session.summarize).not.toHaveBeenCalled()
    })
  })
  // #endregion

  // #region message.updated event
  describe("message.updated event", () => {
    test("skips non-assistant messages", async () => {
      // #given: User message
      const hook = createPreemptiveCompactionHook(mockCtx)
      const event = {
        event: {
          type: "message.updated",
          properties: {
            info: createMessageInfo({ role: "user" }),
          },
        },
      }

      // #when
      await hook.event(event)

      // #then: Should not process
      expect(mockCtx.client.session.summarize).not.toHaveBeenCalled()
    })

    test("skips unfinished messages", async () => {
      // #given: Unfinished message
      const hook = createPreemptiveCompactionHook(mockCtx)
      const event = {
        event: {
          type: "message.updated",
          properties: {
            info: createMessageInfo({ finish: false }),
          },
        },
      }

      // #when
      await hook.event(event)

      // #then: Should not process
      expect(mockCtx.client.session.summarize).not.toHaveBeenCalled()
    })

    test("skips messages without tokens", async () => {
      // #given: Message without tokens
      const hook = createPreemptiveCompactionHook(mockCtx)
      const event = {
        event: {
          type: "message.updated",
          properties: {
            info: createMessageInfo({ tokens: undefined }),
          },
        },
      }

      // #when
      await hook.event(event)

      // #then: Should not process
      expect(mockCtx.client.session.summarize).not.toHaveBeenCalled()
    })

    test("skips when below MIN_TOKENS_FOR_COMPACTION threshold", async () => {
      // #given: Low token usage (below 50K)
      const hook = createPreemptiveCompactionHook(mockCtx)
      const event = {
        event: {
          type: "message.updated",
          properties: {
            info: createMessageInfo({
              tokens: createMockTokens({
                input: 20000,
                output: 1000,
                cache: { read: 5000, write: 0 },
              }), // 26K total
            }),
          },
        },
      }

      // #when
      await hook.event(event)

      // #then: Should not process (below MIN_TOKENS_FOR_COMPACTION)
      expect(mockCtx.client.session.summarize).not.toHaveBeenCalled()
      expect(MIN_TOKENS_FOR_COMPACTION).toBe(50000)
    })

    test("skips already summarized sessions", async () => {
      // #given: Message marked as summary
      const hook = createPreemptiveCompactionHook(mockCtx)
      const event = {
        event: {
          type: "message.updated",
          properties: {
            info: createMessageInfo({
              summary: true,
              tokens: createMockTokens({ input: 180000 }),
            }),
          },
        },
      }

      // #when
      await hook.event(event)

      // #then: Should not process (already summarized)
      expect(mockCtx.client.session.summarize).not.toHaveBeenCalled()
    })

    test("skips when compaction already in progress", async () => {
      // #given: Create hook and start first compaction
      const slowSummarize = mock(
        () => new Promise((resolve) => setTimeout(resolve, 100))
      )
      const ctx = {
        ...mockCtx,
        client: {
          ...mockCtx.client,
          session: {
            ...mockCtx.client.session,
            summarize: slowSummarize,
          },
        },
      } as unknown as PluginInput

      const hook = createPreemptiveCompactionHook(ctx)
      const sessionID = "session-concurrent"
      const info = createMessageInfo({
        sessionID,
        tokens: createMockTokens({ input: 180000 }),
      })

      // Start first compaction (don't await)
      const firstPromise = hook.event({
        event: {
          type: "message.updated",
          properties: { info },
        },
      })

      // #when: Second attempt while first in progress
      await hook.event({
        event: {
          type: "message.updated",
          properties: { info },
        },
      })

      await firstPromise

      // #then: Should only call summarize once
      expect(slowSummarize).toHaveBeenCalledTimes(1)
    })
  })
  // #endregion

  // #region session.idle event
  describe("session.idle event", () => {
    test("fetches messages and checks compaction", async () => {
      // #given: Session with high usage message
      const messagesResponse = {
        data: [
          {
            info: createMessageInfo({
              tokens: createMockTokens({ input: 180000 }),
            }),
          },
        ],
      }
      const ctx = createMockCtx("/test", messagesResponse)
      const hook = createPreemptiveCompactionHook(ctx)

      // #when
      await hook.event({
        event: {
          type: "session.idle",
          properties: { sessionID: "session-idle" },
        },
      })

      // #then: Should fetch messages and potentially trigger compaction
      expect(ctx.client.session.messages).toHaveBeenCalled()
    })

    test("handles missing provider/model info by loading from storage", async () => {
      // #given: Message without providerID/modelID
      const messagesResponse = {
        data: [
          {
            info: createMessageInfo({
              providerID: undefined,
              modelID: undefined,
              tokens: createMockTokens({ input: 180000 }),
            }),
          },
        ],
      }
      const ctx = createMockCtx("/test", messagesResponse)

      // Mock storage to return provider/model info
      findNearestMessageSpy.mockReturnValue({
        model: { providerID: "anthropic", modelID: "claude-sonnet-4-20250514" },
      })

      const hook = createPreemptiveCompactionHook(ctx)

      // #when
      await hook.event({
        event: {
          type: "session.idle",
          properties: { sessionID: "session-idle" },
        },
      })

      // #then: Should still be able to process with storage info
      // (Whether compaction triggers depends on other conditions)
      expect(ctx.client.session.messages).toHaveBeenCalled()
    })

    test("gracefully handles API errors", async () => {
      // #given: API that throws
      const failingMessages = mock(() => Promise.reject(new Error("API Error")))
      const ctx = {
        ...mockCtx,
        client: {
          ...mockCtx.client,
          session: {
            ...mockCtx.client.session,
            messages: failingMessages,
          },
        },
      } as unknown as PluginInput

      const hook = createPreemptiveCompactionHook(ctx)

      // #when: Event with API error - should not throw
      const result = await hook.event({
        event: {
          type: "session.idle",
          properties: { sessionID: "session-error" },
        },
      })

      // #then: Should have attempted the API call but not crashed
      expect(failingMessages).toHaveBeenCalled()
      expect(ctx.client.session.summarize).not.toHaveBeenCalled()
    })

    test("skips when no sessionID provided", async () => {
      // #given: Event without sessionID
      const hook = createPreemptiveCompactionHook(mockCtx)

      // #when
      await hook.event({
        event: {
          type: "session.idle",
          properties: {},
        },
      })

      // #then: Should not fetch messages
      expect(mockCtx.client.session.messages).not.toHaveBeenCalled()
    })
  })
  // #endregion

  // Note: session.deleted behavior is covered by "complete flow" test in complex state transitions

  // #region compaction flow
  describe("compaction flow", () => {
    test("shows warning toast before compaction", async () => {
      // #given: High usage
      const hook = createPreemptiveCompactionHook(mockCtx)
      const event = {
        event: {
          type: "message.updated",
          properties: {
            info: createMessageInfo({
              tokens: createMockTokens({ input: 180000 }),
            }),
          },
        },
      }

      // #when
      await hook.event(event)

      // #then: Should show warning toast
      expect(mockCtx.client.tui.showToast).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.objectContaining({
            title: "Preemptive Compaction",
            variant: "warning",
          }),
        })
      )
    })

    test("calls onBeforeSummarize callback if provided", async () => {
      // #given: Hook with onBeforeSummarize callback
      const onBeforeSummarize = mock(() => Promise.resolve())
      const hook = createPreemptiveCompactionHook(mockCtx, {
        onBeforeSummarize,
      })

      // #when
      await hook.event({
        event: {
          type: "message.updated",
          properties: {
            info: createMessageInfo({
              tokens: createMockTokens({ input: 180000 }),
            }),
          },
        },
      })

      // #then: Callback should be called with context
      expect(onBeforeSummarize).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionID: "session-123",
          providerID: "anthropic",
          modelID: "claude-sonnet-4-20250514",
          directory: "/test/project",
        })
      )
    })

    test("shows success toast after compaction", async () => {
      // #given: High usage
      const hook = createPreemptiveCompactionHook(mockCtx)

      // #when
      await hook.event({
        event: {
          type: "message.updated",
          properties: {
            info: createMessageInfo({
              tokens: createMockTokens({ input: 180000 }),
            }),
          },
        },
      })

      // #then: Should show success toast
      expect(mockCtx.client.tui.showToast).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.objectContaining({
            title: "Compaction Complete",
            variant: "success",
          }),
        })
      )
    })

    test("clears compactionInProgress lock on success", async () => {
      // #given: Hook
      const hook = createPreemptiveCompactionHook(mockCtx)
      const sessionID = "session-lock"

      // First compaction
      await hook.event({
        event: {
          type: "message.updated",
          properties: {
            info: createMessageInfo({
              sessionID,
              tokens: createMockTokens({ input: 180000 }),
            }),
          },
        },
      })

      // Delete session to clear cooldown
      await hook.event({
        event: {
          type: "session.deleted",
          properties: { info: { id: sessionID } },
        },
      })

      // #when: Second compaction after success
      ;(mockCtx.client.session.summarize as ReturnType<typeof mock>).mockClear()
      await hook.event({
        event: {
          type: "message.updated",
          properties: {
            info: createMessageInfo({
              sessionID,
              tokens: createMockTokens({ input: 180000 }),
            }),
          },
        },
      })

      // #then: Should be able to compact again (lock was cleared)
      expect(mockCtx.client.session.summarize).toHaveBeenCalled()
    })

    test("clears compactionInProgress lock on error", async () => {
      // #given: Summarize that fails
      const failingCtx = {
        ...mockCtx,
        client: {
          ...mockCtx.client,
          session: {
            ...mockCtx.client.session,
            summarize: mock(() => Promise.reject(new Error("Summarize failed"))),
          },
          tui: {
            showToast: mock(() => Promise.resolve()),
          },
        },
      } as unknown as PluginInput

      const hook = createPreemptiveCompactionHook(failingCtx)
      const sessionID = "session-error-lock"

      // First compaction (fails)
      await hook.event({
        event: {
          type: "message.updated",
          properties: {
            info: createMessageInfo({
              sessionID,
              tokens: createMockTokens({ input: 180000 }),
            }),
          },
        },
      })

      // Delete session to clear cooldown
      await hook.event({
        event: {
          type: "session.deleted",
          properties: { info: { id: sessionID } },
        },
      })

      // #when: Second attempt
      ;(failingCtx.client.session.summarize as ReturnType<typeof mock>).mockClear()
      await hook.event({
        event: {
          type: "message.updated",
          properties: {
            info: createMessageInfo({
              sessionID,
              tokens: createMockTokens({ input: 180000 }),
            }),
          },
        },
      })

      // #then: Should be able to try again (lock was cleared despite error)
      expect(failingCtx.client.session.summarize).toHaveBeenCalled()
    })
  })
  // #endregion

  // #region getModelLimit callback
  describe("getModelLimit callback", () => {
    test("uses callback result when provided", async () => {
      // #given: Custom model limit callback returning 100K
      const getModelLimit = mock(() => 100000)
      const hook = createPreemptiveCompactionHook(mockCtx, {
        getModelLimit,
      })

      // With 100K limit, 90K usage = 90% (above 85% threshold)
      const event = {
        event: {
          type: "message.updated",
          properties: {
            info: createMessageInfo({
              tokens: createMockTokens({
                input: 80000,
                output: 5000,
                cache: { read: 5000, write: 0 },
              }), // 90K total
            }),
          },
        },
      }

      // #when
      await hook.event(event)

      // #then: Should trigger compaction (90% of custom 100K limit)
      expect(getModelLimit).toHaveBeenCalledWith("anthropic", "claude-sonnet-4-20250514")
      expect(mockCtx.client.session.summarize).toHaveBeenCalled()
    })

    test("falls back to default when callback returns undefined", async () => {
      // #given: Callback returns undefined
      const getModelLimit = mock(() => undefined)
      const hook = createPreemptiveCompactionHook(mockCtx, {
        getModelLimit,
      })

      // With default 200K limit, 90K usage = 45% (below 85% threshold)
      const event = {
        event: {
          type: "message.updated",
          properties: {
            info: createMessageInfo({
              tokens: createMockTokens({
                input: 80000,
                output: 5000,
                cache: { read: 5000, write: 0 },
              }), // 90K total = 45% of 200K
            }),
          },
        },
      }

      // #when
      await hook.event(event)

      // #then: Should not trigger (45% below 85% threshold with default 200K limit)
      expect(mockCtx.client.session.summarize).not.toHaveBeenCalled()
    })
  })
  // #endregion

  // #region complex state transitions
  describe("complex state transitions", () => {
    test("complete flow: message.updated → cooldown active → session.deleted → new trigger", async () => {
      // #given: High usage scenario
      const hook = createPreemptiveCompactionHook(mockCtx)
      const sessionID = "session-full-flow"
      const highUsageInfo = createMessageInfo({
        sessionID,
        tokens: createMockTokens({ input: 180000 }),
      })

      // Step 1: First compaction via message.updated
      await hook.event({
        event: { type: "message.updated", properties: { info: highUsageInfo } },
      })
      expect(mockCtx.client.session.summarize).toHaveBeenCalledTimes(1)

      // Step 2: Second attempt blocked by cooldown
      ;(mockCtx.client.session.summarize as ReturnType<typeof mock>).mockClear()
      await hook.event({
        event: { type: "message.updated", properties: { info: highUsageInfo } },
      })
      expect(mockCtx.client.session.summarize).not.toHaveBeenCalled()

      // Step 3: Delete session to clear cooldown
      await hook.event({
        event: { type: "session.deleted", properties: { info: { id: sessionID } } },
      })

      // Step 4: New trigger should work after deletion
      ;(mockCtx.client.session.summarize as ReturnType<typeof mock>).mockClear()
      await hook.event({
        event: { type: "message.updated", properties: { info: highUsageInfo } },
      })
      expect(mockCtx.client.session.summarize).toHaveBeenCalledTimes(1)
    })

    test("session.idle fallback when message.updated misses provider info", async () => {
      // #given: Message without provider info, then session.idle fills it
      const messagesResponse = {
        data: [
          {
            info: createMessageInfo({
              providerID: "anthropic",
              modelID: "claude-sonnet-4-20250514",
              tokens: createMockTokens({ input: 180000 }),
            }),
          },
        ],
      }
      const ctx = createMockCtx("/test", messagesResponse)
      const hook = createPreemptiveCompactionHook(ctx)
      const sessionID = "session-idle-fallback"

      // Step 1: message.updated with missing providerID - should not trigger
      await hook.event({
        event: {
          type: "message.updated",
          properties: {
            info: createMessageInfo({
              sessionID,
              providerID: undefined,
              modelID: undefined,
              tokens: createMockTokens({ input: 180000 }),
            }),
          },
        },
      })
      expect(ctx.client.session.summarize).not.toHaveBeenCalled()

      // Step 2: session.idle fetches messages with full info - should trigger
      await hook.event({
        event: { type: "session.idle", properties: { sessionID } },
      })
      expect(ctx.client.session.summarize).toHaveBeenCalledTimes(1)
    })

    test("concurrent compaction attempts across different sessions", async () => {
      // #given: Two sessions with high usage
      const slowSummarize = mock(
        () => new Promise((resolve) => setTimeout(resolve, 50))
      )
      const ctx = {
        ...mockCtx,
        client: {
          ...mockCtx.client,
          session: { ...mockCtx.client.session, summarize: slowSummarize },
        },
      } as unknown as PluginInput

      const hook = createPreemptiveCompactionHook(ctx)

      const infoA = createMessageInfo({
        sessionID: "session-A",
        tokens: createMockTokens({ input: 180000 }),
      })
      const infoB = createMessageInfo({
        sessionID: "session-B",
        tokens: createMockTokens({ input: 180000 }),
      })

      // #when: Both sessions trigger compaction concurrently
      const promiseA = hook.event({
        event: { type: "message.updated", properties: { info: infoA } },
      })
      const promiseB = hook.event({
        event: { type: "message.updated", properties: { info: infoB } },
      })

      await Promise.all([promiseA, promiseB])

      // #then: Both should trigger (different sessions don't block each other)
      expect(slowSummarize).toHaveBeenCalledTimes(2)
    })

    test("session.deleted during compaction in progress clears state correctly", async () => {
      // #given: Compaction takes time
      let resolveCompaction: () => void
      const pendingCompaction = new Promise<void>((resolve) => {
        resolveCompaction = resolve
      })
      const slowSummarize = mock(() => pendingCompaction)
      const ctx = {
        ...mockCtx,
        client: {
          ...mockCtx.client,
          session: { ...mockCtx.client.session, summarize: slowSummarize },
        },
      } as unknown as PluginInput

      const hook = createPreemptiveCompactionHook(ctx)
      const sessionID = "session-delete-during"
      const info = createMessageInfo({
        sessionID,
        tokens: createMockTokens({ input: 180000 }),
      })

      // Start compaction (don't await)
      const compactionPromise = hook.event({
        event: { type: "message.updated", properties: { info } },
      })

      // #when: Delete session while compaction in progress
      await hook.event({
        event: { type: "session.deleted", properties: { info: { id: sessionID } } },
      })

      // Complete the pending compaction
      resolveCompaction!()
      await compactionPromise

      // #then: State should be cleared; new compaction should be possible
      slowSummarize.mockClear()
      await hook.event({
        event: { type: "message.updated", properties: { info } },
      })

      // Note: This verifies the lock is released after delete
      expect(slowSummarize).toHaveBeenCalledTimes(1)
    })

    test("onBeforeSummarize rejection prevents summarize call", async () => {
      // #given: onBeforeSummarize that rejects
      const onBeforeSummarize = mock(() => Promise.reject(new Error("Pre-check failed")))
      const hook = createPreemptiveCompactionHook(mockCtx, { onBeforeSummarize })

      // #when: Trigger compaction
      await hook.event({
        event: {
          type: "message.updated",
          properties: {
            info: createMessageInfo({ tokens: createMockTokens({ input: 180000 }) }),
          },
        },
      })

      // #then: Callback should be called, but summarize should NOT be called due to rejection
      expect(onBeforeSummarize).toHaveBeenCalled()
      expect(mockCtx.client.session.summarize).not.toHaveBeenCalled()
    })
  })
  // #endregion

  // #region boundary value tests
  describe("boundary value tests", () => {
    test("exactly at 85% threshold triggers compaction", async () => {
      // #given: Exactly 85% of 200K = 170K tokens
      const hook = createPreemptiveCompactionHook(mockCtx)
      const event = {
        event: {
          type: "message.updated",
          properties: {
            info: createMessageInfo({
              tokens: createMockTokens({
                input: 150000,
                output: 10000,
                cache: { read: 10000, write: 0 },
              }), // Exactly 170K = 85%
            }),
          },
        },
      }

      // #when
      await hook.event(event)

      // #then: Should trigger (at threshold)
      expect(mockCtx.client.session.summarize).toHaveBeenCalled()
    })

    test("just below 85% threshold does not trigger", async () => {
      // #given: 169,999 tokens (just under 85%)
      const hook = createPreemptiveCompactionHook(mockCtx)
      const event = {
        event: {
          type: "message.updated",
          properties: {
            info: createMessageInfo({
              tokens: createMockTokens({
                input: 149999,
                output: 10000,
                cache: { read: 10000, write: 0 },
              }), // 169,999 tokens
            }),
          },
        },
      }

      // #when
      await hook.event(event)

      // #then: Should not trigger (just below threshold)
      expect(mockCtx.client.session.summarize).not.toHaveBeenCalled()
    })

    test("exactly at MIN_TOKENS_FOR_COMPACTION with high ratio still triggers", async () => {
      // #given: Custom limit that makes 51K = 85%
      // The hook calculates total as input + output + cache.read
      // But MIN_TOKENS check might only count input + cache.read
      // Use 51K input to ensure we're above MIN_TOKENS (50K)
      // With limit 60000, 51K/60K = 85% which is at threshold
      const getModelLimit = mock(() => 60000)
      const hook = createPreemptiveCompactionHook(mockCtx, { getModelLimit })

      const event = {
        event: {
          type: "message.updated",
          properties: {
            info: createMessageInfo({
              tokens: createMockTokens({
                input: 45000,
                output: 2000,
                cache: { read: 6000, write: 0 },
              }), // 51K total = 85% of 60K, above MIN_TOKENS
            }),
          },
        },
      }

      // #when
      await hook.event(event)

      // #then: Should trigger (above MIN_TOKENS and at ratio threshold)
      expect(mockCtx.client.session.summarize).toHaveBeenCalled()
    })

    test("below MIN_TOKENS_FOR_COMPACTION never triggers even with 100% ratio", async () => {
      // #given: Very small custom limit (10K) making usage 100% but below MIN_TOKENS
      const getModelLimit = mock(() => 10000)
      const hook = createPreemptiveCompactionHook(mockCtx, { getModelLimit })

      const event = {
        event: {
          type: "message.updated",
          properties: {
            info: createMessageInfo({
              tokens: createMockTokens({
                input: 9000,
                output: 500,
                cache: { read: 500, write: 0 },
              }), // 10K = 100% ratio but below MIN_TOKENS
            }),
          },
        },
      }

      // #when
      await hook.event(event)

      // #then: Should not trigger (below MIN_TOKENS_FOR_COMPACTION)
      expect(mockCtx.client.session.summarize).not.toHaveBeenCalled()
    })

    test("custom threshold boundary at 0.5 (50%)", async () => {
      // #given: 50% threshold, 200K limit
      const hook = createPreemptiveCompactionHook(mockCtx, {
        experimental: { preemptive_compaction_threshold: 0.5 },
      })

      // Exactly 100K = 50%
      const eventAt50 = {
        event: {
          type: "message.updated",
          properties: {
            info: createMessageInfo({
              sessionID: "boundary-50",
              tokens: createMockTokens({
                input: 80000,
                output: 10000,
                cache: { read: 10000, write: 0 },
              }),
            }),
          },
        },
      }

      await hook.event(eventAt50)
      expect(mockCtx.client.session.summarize).toHaveBeenCalled()
    })
  })
  // #endregion

  // #region edge cases
  describe("edge cases", () => {
    test("handles missing info in event properties", async () => {
      // #given: Event without info
      const hook = createPreemptiveCompactionHook(mockCtx)

      // #when
      await hook.event({
        event: {
          type: "message.updated",
          properties: {},
        },
      })

      // #then: Should not throw
      expect(mockCtx.client.session.summarize).not.toHaveBeenCalled()
    })

    test("handles missing sessionID in message info", async () => {
      // #given: Message without sessionID
      const hook = createPreemptiveCompactionHook(mockCtx)

      // #when
      await hook.event({
        event: {
          type: "message.updated",
          properties: {
            info: createMessageInfo({ sessionID: undefined }),
          },
        },
      })

      // #then: Should not throw
      expect(mockCtx.client.session.summarize).not.toHaveBeenCalled()
    })

    test("handles toast errors gracefully", async () => {
      // #given: Toast that fails
      const ctx = {
        ...mockCtx,
        client: {
          ...mockCtx.client,
          tui: {
            showToast: mock(() => Promise.reject(new Error("Toast failed"))),
          },
        },
      } as unknown as PluginInput

      const hook = createPreemptiveCompactionHook(ctx)

      // #when
      await hook.event({
        event: {
          type: "message.updated",
          properties: {
            info: createMessageInfo({
              tokens: createMockTokens({ input: 180000 }),
            }),
          },
        },
      })

      // #then: Should still complete (toast errors caught)
      expect(ctx.client.session.summarize).toHaveBeenCalled()
    })

    test("skips when providerID/modelID missing after checking", async () => {
      // #given: Message with tokens but missing provider info
      const hook = createPreemptiveCompactionHook(mockCtx)

      // #when
      await hook.event({
        event: {
          type: "message.updated",
          properties: {
            info: createMessageInfo({
              providerID: undefined,
              modelID: "claude-sonnet-4-20250514",
              tokens: createMockTokens({ input: 180000 }),
            }),
          },
        },
      })

      // #then: Should not call summarize (providerID missing)
      expect(mockCtx.client.session.summarize).not.toHaveBeenCalled()
    })
  })
  // #endregion
})
