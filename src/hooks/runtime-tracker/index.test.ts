import { describe, test, expect, mock, beforeEach } from "bun:test"
import type { PluginInput } from "@opencode-ai/plugin"
import { createRuntimeTrackerHook, DEFAULT_CONFIG } from "./index"

function createMockCtx(directory = "/test/project"): PluginInput {
  return {
    directory,
    client: {
      session: {
        messages: mock(() => Promise.resolve({ data: [] })),
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

describe("createRuntimeTrackerHook", () => {
  let mockCtx: PluginInput

  beforeEach(() => {
    mockCtx = createMockCtx()
  })

  // #region configuration
  describe("configuration", () => {
    test("disabled hook does not track anything", async () => {
      // #given: Disabled config
      const hook = createRuntimeTrackerHook(mockCtx, { enabled: false })

      // #when: Execute tool
      const input = createToolInput("Grep")
      const output = createToolOutput()

      await hook["tool.execute.before"](input, {})
      await hook["tool.execute.after"](input, output)

      // #then: Output should not be modified (no tracking)
      expect(output.output).toBe("test output")
    })
  })
  // #endregion

  // #region tool.execute.after
  describe("tool.execute.after", () => {
    test("calculates duration and updates stats", async () => {
      // #given: Hook with low threshold for testing
      const hook = createRuntimeTrackerHook(mockCtx, {
        threshold_ms: 1,
        inject_hints: false,
      })
      const input = createToolInput("Grep")
      const output = createToolOutput()

      // #when: Execute tool sequence
      await hook["tool.execute.before"](input, {})
      await hook["tool.execute.after"](input, output)

      // #then: Stats should be tracked (we can't directly inspect, but no error)
      expect(output.output).toBe("test output")
    })

    test("does not inject hint for fast tools", async () => {
      // #given: Hook with high threshold
      const hook = createRuntimeTrackerHook(mockCtx, {
        threshold_ms: 10000,
        inject_hints: true,
      })
      const input = createToolInput("Read")
      const output = createToolOutput()

      // #when: Execute fast tool
      await hook["tool.execute.before"](input, {})
      await hook["tool.execute.after"](input, output)

      // #then: Output should not contain runtime hint
      expect(output.output).toBe("test output")
      expect(output.output).not.toContain("[Runtime:")
    })

    test("injects hint for slow tools exceeding threshold", async () => {
      // #given: Hook with very low threshold (0ms = always slow)
      const hook = createRuntimeTrackerHook(mockCtx, {
        threshold_ms: 0,
        inject_hints: true,
        hint_cooldown_ms: 0, // No cooldown for testing
      })
      const input = createToolInput("Grep", "session-1", "call-1")
      const output = createToolOutput()

      // #when: Execute first call
      await hook["tool.execute.before"](input, {})
      await new Promise((r) => setTimeout(r, 5)) // Small delay
      await hook["tool.execute.after"](input, output)

      // #then: First call should have basic hint (callCount=1, no avg yet)
      expect(output.output).toContain("[Runtime:")
      expect(output.output).toContain("slow")
    })

    test("includes call count in hint message after multiple calls", async () => {
      // #given: Hook with low threshold
      const hook = createRuntimeTrackerHook(mockCtx, {
        threshold_ms: 0,
        inject_hints: true,
        hint_cooldown_ms: 0,
      })

      // #when: Execute same tool twice
      const input1 = createToolInput("Grep", "session-1", "call-1")
      const output1 = createToolOutput()
      await hook["tool.execute.before"](input1, {})
      await hook["tool.execute.after"](input1, output1)

      const input2 = createToolInput("Grep", "session-1", "call-2")
      const output2 = createToolOutput()
      await hook["tool.execute.before"](input2, {})
      await hook["tool.execute.after"](input2, output2)

      // #then: Second call should include call count and average
      expect(output2.output).toContain("2 calls")
      expect(output2.output).toContain("averaged")
    })

    // Note: hint_cooldown_ms behavior is covered by "complete flow" chain test

    test("does not inject hint when inject_hints is false", async () => {
      // #given: Hook with hints disabled
      const hook = createRuntimeTrackerHook(mockCtx, {
        threshold_ms: 0,
        inject_hints: false,
      })
      const input = createToolInput("Grep")
      const output = createToolOutput()

      // #when: Execute tool
      await hook["tool.execute.before"](input, {})
      await hook["tool.execute.after"](input, output)

      // #then: No hint injected
      expect(output.output).toBe("test output")
    })

    test("handles missing pending call gracefully", async () => {
      // #given: Hook without prior tool.execute.before
      const hook = createRuntimeTrackerHook(mockCtx)
      const input = createToolInput("Read")
      const output = createToolOutput()

      // #when: Call tool.execute.after directly
      await hook["tool.execute.after"](input, output)

      // #then: Should not throw, output unchanged
      expect(output.output).toBe("test output")
    })
  })
  // #endregion

  // #region event handling
  // Note: session.deleted and session.compacted behavior is covered by "complete flow" tests
  describe("event handling", () => {
    describe("session.compacted", () => {
      test("handles sessionID from info property", async () => {
        // #given: Hook with tracked session
        const hook = createRuntimeTrackerHook(mockCtx, {
          threshold_ms: 0,
          inject_hints: true,
          hint_cooldown_ms: 0,
        })
        const sessionID = "session-from-info"

        // Track some stats
        const input = createToolInput("Grep", sessionID, "call-1")
        const output = createToolOutput()
        await hook["tool.execute.before"](input, {})
        await hook["tool.execute.after"](input, output)

        // #when: Compact session with sessionID in info
        await hook.event({
          event: {
            type: "session.compacted",
            properties: { info: { id: sessionID } },
          },
        })

        // #then: Stats should be cleared
        const input2 = createToolInput("Grep", sessionID, "call-2")
        const output2 = createToolOutput()
        await hook["tool.execute.before"](input2, {})
        await hook["tool.execute.after"](input2, output2)

        expect(output2.output).not.toContain("2 calls")
      })
    })

    test("ignores unknown event types", async () => {
      // #given: Hook with tracked stats
      const hook = createRuntimeTrackerHook(mockCtx, {
        threshold_ms: 0,
        inject_hints: true,
        hint_cooldown_ms: 0,
      })
      const sessionID = "session-unknown-event"

      // Track some data first
      const input = createToolInput("Grep", sessionID, "call-1")
      const output = createToolOutput()
      await hook["tool.execute.before"](input, {})
      await hook["tool.execute.after"](input, output)

      // #when: Send unknown event
      await hook.event({
        event: {
          type: "session.unknown",
          properties: { sessionID },
        },
      })

      // #then: Stats should still be tracked (unknown event ignored)
      const input2 = createToolInput("Grep", sessionID, "call-2")
      const output2 = createToolOutput()
      await hook["tool.execute.before"](input2, {})
      await hook["tool.execute.after"](input2, output2)

      // Should have "2 calls" since stats weren't cleared
      expect(output2.output).toContain("2 calls")
    })
  })
  // #endregion

  // #region complex state transitions
  describe("complex state transitions", () => {
    test("complete flow: track → cooldown → session.deleted → re-track", async () => {
      // #given: Hook with cooldown
      const hook = createRuntimeTrackerHook(mockCtx, {
        threshold_ms: 0,
        inject_hints: true,
        hint_cooldown_ms: 60000, // 1 minute
      })
      const sessionID = "session-flow"

      // Step 1: First call - hint should appear
      const input1 = createToolInput("Grep", sessionID, "call-1")
      const output1 = createToolOutput()
      await hook["tool.execute.before"](input1, {})
      await hook["tool.execute.after"](input1, output1)
      expect(output1.output).toContain("[Runtime:")

      // Step 2: Second call - throttled by cooldown
      const input2 = createToolInput("Grep", sessionID, "call-2")
      const output2 = createToolOutput()
      await hook["tool.execute.before"](input2, {})
      await hook["tool.execute.after"](input2, output2)
      expect(output2.output).toBe("test output")

      // Step 3: Delete session
      await hook.event({
        event: { type: "session.deleted", properties: { info: { id: sessionID } } },
      })

      // Step 4: New call - hint should appear again (cooldown cleared)
      const input3 = createToolInput("Grep", sessionID, "call-3")
      const output3 = createToolOutput()
      await hook["tool.execute.before"](input3, {})
      await hook["tool.execute.after"](input3, output3)
      expect(output3.output).toContain("[Runtime:")
      expect(output3.output).toContain("slow") // Fresh start, not "X calls"
    })

    test("interleaved sessions maintain separate state", async () => {
      // #given: Hook
      const hook = createRuntimeTrackerHook(mockCtx, {
        threshold_ms: 0,
        inject_hints: true,
        hint_cooldown_ms: 0,
      })

      // #when: Interleave calls between sessions
      // A-1
      const inputA1 = createToolInput("Grep", "session-A", "a-1")
      await hook["tool.execute.before"](inputA1, {})

      // B-1 (interleaved)
      const inputB1 = createToolInput("Grep", "session-B", "b-1")
      await hook["tool.execute.before"](inputB1, {})

      // Complete A-1
      const outputA1 = createToolOutput()
      await hook["tool.execute.after"](inputA1, outputA1)

      // Complete B-1
      const outputB1 = createToolOutput()
      await hook["tool.execute.after"](inputB1, outputB1)

      // A-2
      const inputA2 = createToolInput("Grep", "session-A", "a-2")
      const outputA2 = createToolOutput()
      await hook["tool.execute.before"](inputA2, {})
      await hook["tool.execute.after"](inputA2, outputA2)

      // #then: A should show "2 calls", B stayed at 1
      expect(outputA2.output).toContain("2 calls")
      expect(outputB1.output).toContain("slow")
      expect(outputB1.output).not.toContain("2 calls")
    })

    test("session.compacted resets stats but allows immediate hint", async () => {
      // #given: Hook with tracked session
      const hook = createRuntimeTrackerHook(mockCtx, {
        threshold_ms: 0,
        inject_hints: true,
        hint_cooldown_ms: 0,
      })
      const sessionID = "session-compact"

      // Build up stats
      for (let i = 1; i <= 3; i++) {
        const input = createToolInput("Grep", sessionID, `call-${i}`)
        const output = createToolOutput()
        await hook["tool.execute.before"](input, {})
        await hook["tool.execute.after"](input, output)
      }

      // #when: Compact session
      await hook.event({
        event: { type: "session.compacted", properties: { sessionID } },
      })

      // #then: Next call should start fresh
      const input = createToolInput("Grep", sessionID, "call-post-compact")
      const output = createToolOutput()
      await hook["tool.execute.before"](input, {})
      await hook["tool.execute.after"](input, output)

      expect(output.output).toContain("slow")
      expect(output.output).not.toContain("4 calls")
    })
  })
  // #endregion

  // #region boundary value tests
  describe("boundary value tests", () => {
    test("exactly at threshold_ms boundary", async () => {
      // #given: Hook with specific threshold
      const hook = createRuntimeTrackerHook(mockCtx, {
        threshold_ms: 10, // 10ms threshold
        inject_hints: true,
        hint_cooldown_ms: 0,
      })

      // #when: Call that's fast (under 10ms)
      const input = createToolInput("Read")
      const output = createToolOutput()
      await hook["tool.execute.before"](input, {})
      // No artificial delay - should be under 10ms
      await hook["tool.execute.after"](input, output)

      // #then: Should not inject hint (fast call)
      expect(output.output).toBe("test output")
    })

    test("zero threshold_ms means always inject", async () => {
      // #given: Zero threshold
      const hook = createRuntimeTrackerHook(mockCtx, {
        threshold_ms: 0,
        inject_hints: true,
        hint_cooldown_ms: 0,
      })

      // #when: Any call
      const input = createToolInput("Read")
      const output = createToolOutput()
      await hook["tool.execute.before"](input, {})
      await hook["tool.execute.after"](input, output)

      // #then: Should always inject (0ms threshold = everything is slow)
      expect(output.output).toContain("[Runtime:")
    })

    test("max_recent at boundary (exactly full)", async () => {
      // #given: max_recent = 3
      const hook = createRuntimeTrackerHook(mockCtx, {
        threshold_ms: 0,
        inject_hints: true,
        hint_cooldown_ms: 0,
        max_recent: 3,
      })
      const sessionID = "session-max-recent"

      // #when: Make exactly 3 calls
      for (let i = 1; i <= 3; i++) {
        const input = createToolInput("Grep", sessionID, `call-${i}`)
        const output = createToolOutput()
        await hook["tool.execute.before"](input, {})
        await hook["tool.execute.after"](input, output)
      }

      // #then: Last output should show "3 calls"
      const input = createToolInput("Grep", sessionID, "call-4")
      const output = createToolOutput()
      await hook["tool.execute.before"](input, {})
      await hook["tool.execute.after"](input, output)

      expect(output.output).toContain("4 calls")
    })
  })
  // #endregion

  // #region stats rolling average
  describe("stats management", () => {
    test("maintains rolling average within max_recent limit", async () => {
      // #given: Hook with max_recent=3
      const hook = createRuntimeTrackerHook(mockCtx, {
        threshold_ms: 0,
        inject_hints: true,
        hint_cooldown_ms: 0,
        max_recent: 3,
      })
      const sessionID = "session-rolling"

      // #when: Make 5 calls
      for (let i = 0; i < 5; i++) {
        const input = createToolInput("Grep", sessionID, `call-${i}`)
        const output = createToolOutput()
        await hook["tool.execute.before"](input, {})
        await hook["tool.execute.after"](input, output)
      }

      // #then: Should show "5 calls" in output (all calls counted)
      const finalInput = createToolInput("Grep", sessionID, "call-final")
      const finalOutput = createToolOutput()
      await hook["tool.execute.before"](finalInput, {})
      await hook["tool.execute.after"](finalInput, finalOutput)

      expect(finalOutput.output).toContain("6 calls")
    })
  })
  // #endregion

  // #region format duration
  describe("duration formatting", () => {
    test("formats milliseconds correctly in output", async () => {
      // #given: Hook that will produce a hint
      const hook = createRuntimeTrackerHook(mockCtx, {
        threshold_ms: 0,
        inject_hints: true,
        hint_cooldown_ms: 0,
      })

      // #when: Execute tool
      const input = createToolInput("Read")
      const output = createToolOutput()
      await hook["tool.execute.before"](input, {})
      await hook["tool.execute.after"](input, output)

      // #then: Output should contain formatted duration (ms or s)
      // The format is either "Xms" or "X.Xs"
      expect(output.output).toMatch(/\d+ms|\d+\.\d+s/)
    })
  })
  // #endregion

  // #region multiple tools
  describe("multiple tools tracking", () => {
    test("tracks different tools separately", async () => {
      // #given: Hook
      const hook = createRuntimeTrackerHook(mockCtx, {
        threshold_ms: 0,
        inject_hints: true,
        hint_cooldown_ms: 0,
      })
      const sessionID = "session-multi"

      // #when: Execute different tools
      const input1 = createToolInput("Grep", sessionID, "call-1")
      const output1 = createToolOutput()
      await hook["tool.execute.before"](input1, {})
      await hook["tool.execute.after"](input1, output1)

      const input2 = createToolInput("Read", sessionID, "call-2")
      const output2 = createToolOutput()
      await hook["tool.execute.before"](input2, {})
      await hook["tool.execute.after"](input2, output2)

      // Execute Grep again
      const input3 = createToolInput("Grep", sessionID, "call-3")
      const output3 = createToolOutput()
      await hook["tool.execute.before"](input3, {})
      await hook["tool.execute.after"](input3, output3)

      // #then: Grep should show 2 calls, Read should have shown 1
      expect(output3.output).toContain("Grep")
      expect(output3.output).toContain("2 calls")
    })

    test("tracks tools per session independently", async () => {
      // #given: Hook
      const hook = createRuntimeTrackerHook(mockCtx, {
        threshold_ms: 0,
        inject_hints: true,
        hint_cooldown_ms: 0,
      })

      // #when: Execute same tool in different sessions
      const inputA = createToolInput("Grep", "session-A", "call-1")
      const outputA = createToolOutput()
      await hook["tool.execute.before"](inputA, {})
      await hook["tool.execute.after"](inputA, outputA)

      const inputB = createToolInput("Grep", "session-B", "call-1")
      const outputB = createToolOutput()
      await hook["tool.execute.before"](inputB, {})
      await hook["tool.execute.after"](inputB, outputB)

      // #then: Both should show "slow" (not "2 calls" since they're separate sessions)
      expect(outputA.output).toContain("slow")
      expect(outputB.output).toContain("slow")
      expect(outputA.output).not.toContain("2 calls")
      expect(outputB.output).not.toContain("2 calls")
    })
  })
  // #endregion
})
