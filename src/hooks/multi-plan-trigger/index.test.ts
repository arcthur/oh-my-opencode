import { describe, test, expect, beforeEach } from "bun:test"
import {
  createMultiPlanTriggerHook,
  clearAllInjectedSessions,
  clearInjectedSession,
} from "./index"
import type { MultiPlanPipelineConfig } from "../../config/schema"

describe("createMultiPlanTriggerHook", () => {
  beforeEach(() => {
    // Clear session tracking before each test
    clearAllInjectedSessions()
  })

  // #region inactive cases
  test("returns empty object when no model provided", () => {
    const hook = createMultiPlanTriggerHook({ model: undefined })
    expect(hook).toEqual({})
  })

  test("returns empty object when model is a single string", () => {
    const hook = createMultiPlanTriggerHook({ model: "anthropic/claude-opus-4-5" })
    expect(hook).toEqual({})
  })

  test("returns empty object when less than 2 models in array", () => {
    const hook = createMultiPlanTriggerHook({ model: ["anthropic/claude-opus-4-5"] })
    expect(hook).toEqual({})
  })
  // #endregion

  // #region active case
  test("returns chat.message handler with 2+ models", () => {
    const hook = createMultiPlanTriggerHook({
      model: ["anthropic/claude-opus-4-5", "openai/gpt-5.2"],
    })
    expect(hook["chat.message"]).toBeDefined()
    expect(typeof hook["chat.message"]).toBe("function")
  })
  // #endregion

  // #region injection behavior
  test("injects capability context into message", async () => {
    const hook = createMultiPlanTriggerHook({
      model: ["anthropic/claude-opus-4-5", "openai/gpt-5.2"],
    })
    const output = { parts: [{ type: "text", text: "Original message" }] }

    await hook["chat.message"]!({ sessionID: "session-1" }, output)

    expect(output.parts[0].text).toContain("<multi-plan-capability>")
    expect(output.parts[0].text).toContain("multi_plan")
    expect(output.parts[0].text).toContain("debate: true")
  })

  test("only injects once per session (deduplication)", async () => {
    const hook = createMultiPlanTriggerHook({
      model: ["anthropic/claude-opus-4-5", "openai/gpt-5.2"],
      pipelineConfig: {
        // Disable routing injection so this test remains a pure capability-dedup check.
        auto_complexity_detection: false,
        smart_skip_interview: false,
        deep_verification: true,
        adhd_detection: true,
      } satisfies MultiPlanPipelineConfig,
    })

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
    const hook = createMultiPlanTriggerHook({
      model: ["anthropic/claude-opus-4-5", "openai/gpt-5.2"],
    })

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
    const hook = createMultiPlanTriggerHook({
      model: ["anthropic/claude-opus-4-5", "openai/gpt-5.2"],
      pipelineConfig: {
        // Disable routing injection so we only test capability re-injection.
        auto_complexity_detection: false,
        smart_skip_interview: false,
        deep_verification: true,
        adhd_detection: true,
      } satisfies MultiPlanPipelineConfig,
    })

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
    const hook = createMultiPlanTriggerHook({
      model: ["anthropic/claude-opus-4-5", "openai/gpt-5.2"],
    })
    const output = { parts: [{ type: "image", url: "test.png" }] }

    // Should not throw
    await hook["chat.message"]!({ sessionID: "session-1" }, output)
    expect(output.parts[0]).toEqual({ type: "image", url: "test.png" })
  })

  test("includes model names in capability context", async () => {
    const hook = createMultiPlanTriggerHook({
      model: ["anthropic/claude-opus-4-5", "openai/gpt-5.2"],
    })
    const output = { parts: [{ type: "text", text: "Test" }] }

    await hook["chat.message"]!({ sessionID: "session-1" }, output)

    // Names are auto-derived from model strings
    expect(output.parts[0].text).toContain("claude-opus-4-5")
    expect(output.parts[0].text).toContain("gpt-5.2")
  })
  // #endregion

  // #region routing injection (pipeline unified landing)
  test("injects per-message routing recommendation when pipeline config enables detectors", async () => {
    const hook = createMultiPlanTriggerHook({
      model: ["anthropic/claude-opus-4-5", "openai/gpt-5.2"],
      pipelineConfig: {
        auto_complexity_detection: true,
        smart_skip_interview: true,
        deep_verification: true,
        adhd_detection: true,
      } satisfies MultiPlanPipelineConfig,
    })

    const output = {
      parts: [{ type: "text", text: "Add a new feature for user authentication with OAuth2" }],
    }

    await hook["chat.message"]!({ sessionID: "session-route-1" }, output)

    expect(output.parts[0].text).toContain("<multi-plan-routing>")
    expect(output.parts[0].text?.toLowerCase()).toContain("complex")
    expect(output.parts[0].text?.toLowerCase()).toContain("multi_model")
  })

  test("does not inject routing recommendation when pipeline config disables detectors", async () => {
    const hook = createMultiPlanTriggerHook({
      model: ["anthropic/claude-opus-4-5", "openai/gpt-5.2"],
      pipelineConfig: {
        auto_complexity_detection: false,
        smart_skip_interview: false,
        deep_verification: true,
        adhd_detection: true,
      } satisfies MultiPlanPipelineConfig,
    })

    const output = { parts: [{ type: "text", text: "Fix typo in README.md" }] }

    await hook["chat.message"]!({ sessionID: "session-route-2" }, output)

    expect(output.parts[0].text).not.toContain("<multi-plan-routing>")
  })
  // #endregion

  // #region session lifecycle events
  test("session.deleted clears injection tracking", async () => {
    const hook = createMultiPlanTriggerHook({
      model: ["anthropic/claude-opus-4-5", "openai/gpt-5.2"],
      pipelineConfig: {
        // Disable routing injection so we only test capability lifecycle cleanup.
        auto_complexity_detection: false,
        smart_skip_interview: false,
        deep_verification: true,
        adhd_detection: true,
      } satisfies MultiPlanPipelineConfig,
    })

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
    const hook = createMultiPlanTriggerHook({
      model: ["anthropic/claude-opus-4-5", "openai/gpt-5.2"],
    })

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
