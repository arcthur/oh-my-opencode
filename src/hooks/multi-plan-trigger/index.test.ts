import { describe, test, expect, beforeEach } from "bun:test"
import {
  createMultiPlanTriggerHook,
  clearAllInjectedSessions,
  clearInjectedSession,
} from "./index"
import type { MultiPlanConfig } from "../../config/schema"

describe("createMultiPlanTriggerHook", () => {
  beforeEach(() => {
    // Clear session tracking before each test
    clearAllInjectedSessions()
  })

  // #region disabled cases
  test("returns empty object when disabled", () => {
    const config: MultiPlanConfig = {
      enabled: false,
      models: [
        { name: "claude", model: "anthropic/claude-opus-4-5" },
        { name: "gpt", model: "openai/gpt-5.2" },
      ],
    }

    const hook = createMultiPlanTriggerHook({ config })
    expect(hook).toEqual({})
  })

  test("returns empty object when less than 2 models", () => {
    const config: MultiPlanConfig = {
      enabled: true,
      models: [{ name: "claude", model: "anthropic/claude-opus-4-5" }],
    }

    const hook = createMultiPlanTriggerHook({ config })
    expect(hook).toEqual({})
  })
  // #endregion

  // #region enabled case
  test("returns chat.message handler when enabled with 2+ models", () => {
    const config: MultiPlanConfig = {
      enabled: true,
      models: [
        { name: "claude", model: "anthropic/claude-opus-4-5" },
        { name: "gpt", model: "openai/gpt-5.2" },
      ],
    }

    const hook = createMultiPlanTriggerHook({ config })
    expect(hook["chat.message"]).toBeDefined()
    expect(typeof hook["chat.message"]).toBe("function")
  })
  // #endregion

  // #region injection behavior
  test("injects capability context into message", async () => {
    const config: MultiPlanConfig = {
      enabled: true,
      models: [
        { name: "claude", model: "anthropic/claude-opus-4-5" },
        { name: "gpt", model: "openai/gpt-5.2" },
      ],
    }

    const hook = createMultiPlanTriggerHook({ config })
    const output = { parts: [{ type: "text", text: "Original message" }] }

    await hook["chat.message"]!({ sessionID: "session-1" }, output)

    expect(output.parts[0].text).toContain("<multi-plan-capability>")
    expect(output.parts[0].text).toContain("multi_plan")
  })

  test("only injects once per session (deduplication)", async () => {
    const config: MultiPlanConfig = {
      enabled: true,
      models: [
        { name: "claude", model: "anthropic/claude-opus-4-5" },
        { name: "gpt", model: "openai/gpt-5.2" },
      ],
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
    const config: MultiPlanConfig = {
      enabled: true,
      models: [
        { name: "claude", model: "anthropic/claude-opus-4-5" },
        { name: "gpt", model: "openai/gpt-5.2" },
      ],
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
    const config: MultiPlanConfig = {
      enabled: true,
      models: [
        { name: "claude", model: "anthropic/claude-opus-4-5" },
        { name: "gpt", model: "openai/gpt-5.2" },
      ],
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
    const config: MultiPlanConfig = {
      enabled: true,
      models: [
        { name: "claude", model: "anthropic/claude-opus-4-5" },
        { name: "gpt", model: "openai/gpt-5.2" },
      ],
    }

    const hook = createMultiPlanTriggerHook({ config })
    const output = { parts: [{ type: "image", url: "test.png" }] }

    // Should not throw
    await hook["chat.message"]!({ sessionID: "session-1" }, output)
    expect(output.parts[0]).toEqual({ type: "image", url: "test.png" })
  })

  test("includes model names in capability context", async () => {
    const config: MultiPlanConfig = {
      enabled: true,
      models: [
        { name: "strategist", model: "anthropic/claude-opus-4-5" },
        { name: "pragmatist", model: "openai/gpt-5.2" },
      ],
    }

    const hook = createMultiPlanTriggerHook({ config })
    const output = { parts: [{ type: "text", text: "Test" }] }

    await hook["chat.message"]!({ sessionID: "session-1" }, output)

    expect(output.parts[0].text).toContain("strategist")
    expect(output.parts[0].text).toContain("pragmatist")
  })
  // #endregion
})
