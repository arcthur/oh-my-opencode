import { describe, test, expect, mock, beforeEach } from "bun:test"
import type { PluginInput } from "@opencode-ai/plugin"
import { createContextWindowMonitorHook } from "./context-window-monitor"

function createMockCtx(messagesResponse: unknown = { data: [] }): PluginInput {
  return {
    directory: "/test/project",
    client: {
      session: {
        messages: mock(() => Promise.resolve(messagesResponse)),
      },
      tui: {
        showToast: mock(() => Promise.resolve()),
      },
    },
  } as unknown as PluginInput
}

function createToolInput(
  tool: string,
  sessionID = "session-123",
  callID = "call-123"
) {
  return { tool, sessionID, callID }
}

function createToolOutput(output = "test output") {
  return { title: "Test", output, metadata: {} }
}

interface MockTokens {
  input: number
  output: number
  reasoning: number
  cache: { read: number; write: number }
}

function createMockMessage(
  role: string,
  providerID = "anthropic",
  tokens?: MockTokens
) {
  return {
    info: {
      role,
      providerID,
      tokens,
    },
  }
}

describe("createContextWindowMonitorHook", () => {
  // #region tool.execute.after
  describe("tool.execute.after", () => {
    test("does nothing for already reminded sessions", async () => {
      // #given: Anthropic session at 80% usage
      const highUsageTokens: MockTokens = {
        input: 160000, // 80% of 200K
        output: 1000,
        reasoning: 0,
        cache: { read: 0, write: 0 },
      }
      const mockCtx = createMockCtx({
        data: [createMockMessage("assistant", "anthropic", highUsageTokens)],
      })
      const hook = createContextWindowMonitorHook(mockCtx)
      const input = createToolInput("Read")

      // First call - should inject reminder
      const output1 = createToolOutput()
      await hook["tool.execute.after"](input, output1)
      expect(output1.output).toContain("SYSTEM REMINDER")

      // #when: Second call to same session
      const output2 = createToolOutput()
      await hook["tool.execute.after"](input, output2)

      // #then: Should not inject again
      expect(output2.output).toBe("test output")
    })

    test("does nothing when no assistant messages", async () => {
      // #given: Session with no assistant messages
      const mockCtx = createMockCtx({
        data: [createMockMessage("user")],
      })
      const hook = createContextWindowMonitorHook(mockCtx)
      const input = createToolInput("Read")
      const output = createToolOutput()

      // #when: Call tool.execute.after
      await hook["tool.execute.after"](input, output)

      // #then: Output unchanged
      expect(output.output).toBe("test output")
    })

    test("does nothing for non-anthropic providers", async () => {
      // #given: Non-anthropic provider at high usage
      const highUsageTokens: MockTokens = {
        input: 160000,
        output: 1000,
        reasoning: 0,
        cache: { read: 0, write: 0 },
      }
      const mockCtx = createMockCtx({
        data: [createMockMessage("assistant", "openai", highUsageTokens)],
      })
      const hook = createContextWindowMonitorHook(mockCtx)
      const input = createToolInput("Read")
      const output = createToolOutput()

      // #when: Call tool.execute.after
      await hook["tool.execute.after"](input, output)

      // #then: Output unchanged (non-anthropic provider)
      expect(output.output).toBe("test output")
    })

    // Note: threshold and reminder behavior is covered by boundary value tests
    // Note: session reminded state is covered by "complete flow" chain test

    test("calculates usage based on input + cache.read tokens", async () => {
      // #given: Session with cache reads contributing to usage
      // 100K input + 50K cache.read = 150K total (75% of 200K, above 70% threshold)
      const tokensWithCache: MockTokens = {
        input: 100000,
        output: 1000,
        reasoning: 0,
        cache: { read: 50000, write: 0 },
      }
      const mockCtx = createMockCtx({
        data: [createMockMessage("assistant", "anthropic", tokensWithCache)],
      })
      const hook = createContextWindowMonitorHook(mockCtx)
      const input = createToolInput("Read")
      const output = createToolOutput()

      // #when: Call tool.execute.after
      await hook["tool.execute.after"](input, output)

      // #then: Should inject reminder (100K + 50K = 150K, 75% usage)
      expect(output.output).toContain("SYSTEM REMINDER")
    })

    test("handles API errors gracefully", async () => {
      // #given: API that throws error
      const mockCtx = {
        directory: "/test/project",
        client: {
          session: {
            messages: mock(() => Promise.reject(new Error("API Error"))),
          },
          tui: {
            showToast: mock(() => Promise.resolve()),
          },
        },
      } as unknown as PluginInput
      const hook = createContextWindowMonitorHook(mockCtx)
      const input = createToolInput("Read")
      const output = createToolOutput()

      // #when: Call tool.execute.after
      await hook["tool.execute.after"](input, output)

      // #then: Should not throw, output unchanged
      expect(output.output).toBe("test output")
    })

    test("uses only the last assistant message tokens", async () => {
      // #given: Multiple assistant messages with different token counts
      const lowUsageTokens: MockTokens = {
        input: 50000,
        output: 1000,
        reasoning: 0,
        cache: { read: 0, write: 0 },
      }
      const highUsageTokens: MockTokens = {
        input: 160000,
        output: 1000,
        reasoning: 0,
        cache: { read: 0, write: 0 },
      }
      const mockCtx = createMockCtx({
        data: [
          createMockMessage("assistant", "anthropic", lowUsageTokens),
          createMockMessage("assistant", "anthropic", highUsageTokens),
        ],
      })
      const hook = createContextWindowMonitorHook(mockCtx)
      const input = createToolInput("Read")
      const output = createToolOutput()

      // #when: Call tool.execute.after
      await hook["tool.execute.after"](input, output)

      // #then: Should use last message tokens (high usage), inject reminder
      expect(output.output).toContain("SYSTEM REMINDER")
    })

    test("handles messages without tokens gracefully", async () => {
      // #given: Assistant message without tokens
      const mockCtx = createMockCtx({
        data: [createMockMessage("assistant", "anthropic", undefined)],
      })
      const hook = createContextWindowMonitorHook(mockCtx)
      const input = createToolInput("Read")
      const output = createToolOutput()

      // #when: Call tool.execute.after
      await hook["tool.execute.after"](input, output)

      // #then: Should not throw, output unchanged (0 tokens = below threshold)
      expect(output.output).toBe("test output")
    })

    test("handles response without data property", async () => {
      // #given: API returns array directly (no data wrapper)
      const highUsageTokens: MockTokens = {
        input: 160000,
        output: 1000,
        reasoning: 0,
        cache: { read: 0, write: 0 },
      }
      const mockCtx = createMockCtx([
        createMockMessage("assistant", "anthropic", highUsageTokens),
      ])
      const hook = createContextWindowMonitorHook(mockCtx)
      const input = createToolInput("Read")
      const output = createToolOutput()

      // #when: Call tool.execute.after
      await hook["tool.execute.after"](input, output)

      // #then: Should still work and inject reminder
      expect(output.output).toContain("SYSTEM REMINDER")
    })
  })
  // #endregion

  // #region event handling
  // Note: session.deleted behavior is covered by "complete flow" chain test
  describe("event handling", () => {
    describe("session.deleted", () => {
      test("handles missing or undefined properties gracefully", async () => {
        // #given: Hook with tracked session
        const highUsageTokens: MockTokens = {
          input: 160000,
          output: 1000,
          reasoning: 0,
          cache: { read: 0, write: 0 },
        }
        const mockCtx = createMockCtx({
          data: [createMockMessage("assistant", "anthropic", highUsageTokens)],
        })
        const hook = createContextWindowMonitorHook(mockCtx)
        const sessionID = "session-existing"

        // Track a session
        const input = createToolInput("Read", sessionID)
        const output = createToolOutput()
        await hook["tool.execute.after"](input, output)
        expect(output.output).toContain("SYSTEM REMINDER")

        // #when: Event with empty properties
        await hook.event({
          event: {
            type: "session.deleted",
            properties: {},
          },
        })

        // Event with undefined properties
        await hook.event({
          event: {
            type: "session.deleted",
            properties: undefined,
          },
        })

        // #then: Session state should be unaffected (no valid sessionID to delete)
        const output2 = createToolOutput()
        await hook["tool.execute.after"](input, output2)
        expect(output2.output).toBe("test output") // Still blocked
      })
    })

    test("ignores unknown event types", async () => {
      // #given: Hook with high usage session
      const highUsageTokens: MockTokens = {
        input: 160000,
        output: 1000,
        reasoning: 0,
        cache: { read: 0, write: 0 },
      }
      const mockCtx = createMockCtx({
        data: [createMockMessage("assistant", "anthropic", highUsageTokens)],
      })
      const hook = createContextWindowMonitorHook(mockCtx)
      const sessionID = "session-unknown-type"

      // First call triggers reminder
      const input = createToolInput("Read", sessionID)
      const output1 = createToolOutput()
      await hook["tool.execute.after"](input, output1)
      expect(output1.output).toContain("SYSTEM REMINDER")

      // #when: Unknown event
      await hook.event({
        event: {
          type: "session.unknown",
          properties: { sessionID },
        },
      })

      // #then: State should be preserved (unknown event ignored)
      // Second call should still be blocked
      const output2 = createToolOutput()
      await hook["tool.execute.after"](input, output2)
      expect(output2.output).toBe("test output")
    })
  })
  // #endregion

  // #region complex state transitions
  describe("complex state transitions", () => {
    test("complete flow: remind → session.deleted → re-remind", async () => {
      // #given: High usage session
      const highUsageTokens: MockTokens = {
        input: 160000,
        output: 1000,
        reasoning: 0,
        cache: { read: 0, write: 0 },
      }
      const mockCtx = createMockCtx({
        data: [createMockMessage("assistant", "anthropic", highUsageTokens)],
      })
      const hook = createContextWindowMonitorHook(mockCtx)
      const sessionID = "session-full-flow"

      // Step 1: First call triggers reminder
      const input = createToolInput("Read", sessionID)
      const output1 = createToolOutput()
      await hook["tool.execute.after"](input, output1)
      expect(output1.output).toContain("SYSTEM REMINDER")

      // Step 2: Second call blocked
      const output2 = createToolOutput()
      await hook["tool.execute.after"](input, output2)
      expect(output2.output).toBe("test output")

      // Step 3: Delete session
      await hook.event({
        event: { type: "session.deleted", properties: { info: { id: sessionID } } },
      })

      // Step 4: Can remind again
      const output3 = createToolOutput()
      await hook["tool.execute.after"](input, output3)
      expect(output3.output).toContain("SYSTEM REMINDER")
    })

    test("multiple sessions independent lifecycle", async () => {
      // #given: High usage
      const highUsageTokens: MockTokens = {
        input: 160000,
        output: 1000,
        reasoning: 0,
        cache: { read: 0, write: 0 },
      }
      const mockCtx = createMockCtx({
        data: [createMockMessage("assistant", "anthropic", highUsageTokens)],
      })
      const hook = createContextWindowMonitorHook(mockCtx)

      // #when: Both sessions get reminded
      const inputA = createToolInput("Read", "session-A")
      const outputA = createToolOutput()
      await hook["tool.execute.after"](inputA, outputA)

      const inputB = createToolInput("Read", "session-B")
      const outputB = createToolOutput()
      await hook["tool.execute.after"](inputB, outputB)

      // Delete only session A
      await hook.event({
        event: { type: "session.deleted", properties: { info: { id: "session-A" } } },
      })

      // #then: A can be reminded again, B still blocked
      const outputA2 = createToolOutput()
      await hook["tool.execute.after"](inputA, outputA2)
      expect(outputA2.output).toContain("SYSTEM REMINDER")

      const outputB2 = createToolOutput()
      await hook["tool.execute.after"](inputB, outputB2)
      expect(outputB2.output).toBe("test output")
    })
  })
  // #endregion

  // #region boundary value tests
  describe("boundary value tests", () => {
    test("exactly at 70% threshold triggers reminder", async () => {
      // #given: Exactly 70% of 200K = 140K tokens
      const tokens70Percent: MockTokens = {
        input: 140000,
        output: 0,
        reasoning: 0,
        cache: { read: 0, write: 0 },
      }
      const mockCtx = createMockCtx({
        data: [createMockMessage("assistant", "anthropic", tokens70Percent)],
      })
      const hook = createContextWindowMonitorHook(mockCtx)
      const input = createToolInput("Read")
      const output = createToolOutput()

      // #when
      await hook["tool.execute.after"](input, output)

      // #then: Should trigger (at threshold)
      expect(output.output).toContain("SYSTEM REMINDER")
    })

    test("just below 70% threshold does not trigger", async () => {
      // #given: 139,999 tokens (just under 70%)
      const tokensJustUnder: MockTokens = {
        input: 139999,
        output: 0,
        reasoning: 0,
        cache: { read: 0, write: 0 },
      }
      const mockCtx = createMockCtx({
        data: [createMockMessage("assistant", "anthropic", tokensJustUnder)],
      })
      const hook = createContextWindowMonitorHook(mockCtx)
      const input = createToolInput("Read")
      const output = createToolOutput()

      // #when
      await hook["tool.execute.after"](input, output)

      // #then: Should not trigger
      expect(output.output).toBe("test output")
    })

    test("cache.read contributes to threshold calculation", async () => {
      // #given: 100K input + 40K cache.read = 140K (exactly 70%)
      const tokensWithCache: MockTokens = {
        input: 100000,
        output: 0,
        reasoning: 0,
        cache: { read: 40000, write: 0 },
      }
      const mockCtx = createMockCtx({
        data: [createMockMessage("assistant", "anthropic", tokensWithCache)],
      })
      const hook = createContextWindowMonitorHook(mockCtx)
      const input = createToolInput("Read")
      const output = createToolOutput()

      // #when
      await hook["tool.execute.after"](input, output)

      // #then: Should trigger (cache.read adds to total)
      expect(output.output).toContain("SYSTEM REMINDER")
    })
  })
  // #endregion

  // #region different sessions
  describe("different sessions", () => {
    test("tracks sessions independently", async () => {
      // #given: High usage tokens
      const highUsageTokens: MockTokens = {
        input: 160000,
        output: 1000,
        reasoning: 0,
        cache: { read: 0, write: 0 },
      }
      const mockCtx = createMockCtx({
        data: [createMockMessage("assistant", "anthropic", highUsageTokens)],
      })
      const hook = createContextWindowMonitorHook(mockCtx)

      // #when: Call for different sessions
      const inputA = createToolInput("Read", "session-A")
      const outputA = createToolOutput()
      await hook["tool.execute.after"](inputA, outputA)

      const inputB = createToolInput("Read", "session-B")
      const outputB = createToolOutput()
      await hook["tool.execute.after"](inputB, outputB)

      // #then: Both should get reminder (independent sessions)
      expect(outputA.output).toContain("SYSTEM REMINDER")
      expect(outputB.output).toContain("SYSTEM REMINDER")
    })
  })
  // #endregion
})
