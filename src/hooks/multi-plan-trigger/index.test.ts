import { describe, test, expect, beforeEach } from "bun:test"
import {
  createMultiPlanTriggerHook,
  clearAllInjectedSessions,
  clearInjectedSession,
} from "./index"
import type { PlanningAgentConfig } from "../../config/schema"

describe("createMultiPlanTriggerHook", () => {
  beforeEach(() => {
    // Clear session tracking before each test
    clearAllInjectedSessions()
  })

  // #region inactive cases
  test("returns empty object when no config provided", () => {
    const hook = createMultiPlanTriggerHook({ config: undefined })
    expect(hook).toEqual({})
  })

  test("returns empty object when config is a single model string", () => {
    const config: PlanningAgentConfig = { model: "anthropic/claude-opus-4-5" }
    const hook = createMultiPlanTriggerHook({ config })
    expect(hook).toEqual({})
  })

  test("returns empty object when less than 2 models in array", () => {
    const config: PlanningAgentConfig = {
      model: ["anthropic/claude-opus-4-5"],
    }

    const hook = createMultiPlanTriggerHook({ config })
    expect(hook).toEqual({})
  })
  // #endregion

  // #region active case
  test("returns chat.message handler with 2+ models", () => {
    const config: PlanningAgentConfig = {
      model: ["anthropic/claude-opus-4-5", "openai/gpt-5.2"],
    }

    const hook = createMultiPlanTriggerHook({ config })
    expect(hook["chat.message"]).toBeDefined()
    expect(typeof hook["chat.message"]).toBe("function")
  })
  // #endregion

  // #region injection behavior
  test("injects capability context into message", async () => {
    const config: PlanningAgentConfig = {
      model: ["anthropic/claude-opus-4-5", "openai/gpt-5.2"],
    }

    const hook = createMultiPlanTriggerHook({ config })
    const output = { parts: [{ type: "text", text: "Original message" }] }

    await hook["chat.message"]!({ sessionID: "session-1" }, output)

    expect(output.parts[0].text).toContain("<multi-plan-capability>")
    expect(output.parts[0].text).toContain("multi_plan")
  })

  test("only injects once per session (deduplication)", async () => {
    const config: PlanningAgentConfig = {
      model: ["anthropic/claude-opus-4-5", "openai/gpt-5.2"],
    }

    const hook = createMultiPlanTriggerHook({ config })

    // First message
    const output1 = { parts: [{ type: "text", text: "First message" }] }
    await hook["chat.message"]!({ sessionID: "session-1" }, output1)
    const firstLength = output1.parts[0].text!.length

    // Second message - should NOT inject again
    const output2 = { parts: [{ type: "text", text: "Second message" }] }
    await hook["chat.message"]!({ sessionID: "session-1" }, output2)

    expect(output2.parts[0].text).toBe("Second message")
    expect(output2.parts[0].text!.length).toBeLessThan(firstLength)
  })

  test("injects separately for different sessions", async () => {
    const config: PlanningAgentConfig = {
      model: ["anthropic/claude-opus-4-5", "openai/gpt-5.2"],
    }

    const hook = createMultiPlanTriggerHook({ config })

    // Session 1
    const output1 = { parts: [{ type: "text", text: "Session 1 message" }] }
    await hook["chat.message"]!({ sessionID: "session-1" }, output1)

    // Session 2 - should also get injection
    const output2 = { parts: [{ type: "text", text: "Session 2 message" }] }
    await hook["chat.message"]!({ sessionID: "session-2" }, output2)

    expect(output1.parts[0].text).toContain("<multi-plan-capability>")
    expect(output2.parts[0].text).toContain("<multi-plan-capability>")
  })
  // #endregion

  // #region clearInjectedSession
  test("clearInjectedSession allows re-injection", async () => {
    const config: PlanningAgentConfig = {
      model: ["anthropic/claude-opus-4-5", "openai/gpt-5.2"],
    }

    const hook = createMultiPlanTriggerHook({ config })

    // First injection
    const output1 = { parts: [{ type: "text", text: "First" }] }
    await hook["chat.message"]!({ sessionID: "session-1" }, output1)
    expect(output1.parts[0].text).toContain("<multi-plan-capability>")

    // Second message - no injection
    const output2 = { parts: [{ type: "text", text: "Second" }] }
    await hook["chat.message"]!({ sessionID: "session-1" }, output2)
    expect(output2.parts[0].text).toBe("Second")

    // Clear and retry
    clearInjectedSession("session-1")
    const output3 = { parts: [{ type: "text", text: "Third" }] }
    await hook["chat.message"]!({ sessionID: "session-1" }, output3)
    expect(output3.parts[0].text).toContain("<multi-plan-capability>")
  })
  // #endregion

  // #region edge cases
  test("handles missing text part gracefully", async () => {
    const config: PlanningAgentConfig = {
      model: ["anthropic/claude-opus-4-5", "openai/gpt-5.2"],
    }

    const hook = createMultiPlanTriggerHook({ config })
    const output = { parts: [{ type: "image", url: "test.png" }] }

    // Should not throw
    await hook["chat.message"]!({ sessionID: "session-1" }, output)
    expect(output.parts[0]).toEqual({ type: "image", url: "test.png" })
  })

  test("includes model names in capability context", async () => {
    const config: PlanningAgentConfig = {
      model: ["anthropic/claude-opus-4-5", "openai/gpt-5.2"],
    }

    const hook = createMultiPlanTriggerHook({ config })
    const output = { parts: [{ type: "text", text: "Test" }] }

    await hook["chat.message"]!({ sessionID: "session-1" }, output)

    // Names are auto-derived from model strings
    expect(output.parts[0].text).toContain("claude-opus-4-5")
    expect(output.parts[0].text).toContain("gpt-5.2")
  })
  // #endregion

  // #region session lifecycle events
  test("session.deleted clears injection tracking", async () => {
    const config: PlanningAgentConfig = {
      model: ["anthropic/claude-opus-4-5", "openai/gpt-5.2"],
    }

    const hook = createMultiPlanTriggerHook({ config })

    // First injection
    const output1 = { parts: [{ type: "text", text: "First" }] }
    await hook["chat.message"]!({ sessionID: "session-del-1" }, output1)
    expect(output1.parts[0].text).toContain("<multi-plan-capability>")

    // Second message - no injection (already injected)
    const output2 = { parts: [{ type: "text", text: "Second" }] }
    await hook["chat.message"]!({ sessionID: "session-del-1" }, output2)
    expect(output2.parts[0].text).toBe("Second")

    // Session deleted event
    await hook.event!({
      event: {
        type: "session.deleted",
        properties: { info: { id: "session-del-1" } },
      },
    })

    // Now should re-inject
    const output3 = { parts: [{ type: "text", text: "Third" }] }
    await hook["chat.message"]!({ sessionID: "session-del-1" }, output3)
    expect(output3.parts[0].text).toContain("<multi-plan-capability>")
  })

  test("session.compacted allows re-injection", async () => {
    const config: PlanningAgentConfig = {
      model: ["anthropic/claude-opus-4-5", "openai/gpt-5.2"],
    }

    const hook = createMultiPlanTriggerHook({ config })

    // First injection
    const output1 = { parts: [{ type: "text", text: "First" }] }
    await hook["chat.message"]!({ sessionID: "session-compact-1" }, output1)
    expect(output1.parts[0].text).toContain("<multi-plan-capability>")

    // Session compacted event (context was compressed)
    await hook.event!({
      event: {
        type: "session.compacted",
        properties: { sessionID: "session-compact-1" },
      },
    })

    // Now should re-inject (context was lost during compaction)
    const output2 = { parts: [{ type: "text", text: "After compaction" }] }
    await hook["chat.message"]!({ sessionID: "session-compact-1" }, output2)
    expect(output2.parts[0].text).toContain("<multi-plan-capability>")
  })
  // #endregion
})
