import { describe, test, expect, mock, beforeEach, spyOn } from "bun:test"
import { createCompactionContextInjector, type SummarizeContext } from "./index"
import * as hookMessageInjector from "../../features/hook-message-injector"
import * as logger from "../../shared/logger"

describe("createCompactionContextInjector", () => {
  let injectHookMessageSpy: ReturnType<typeof spyOn>
  let logSpy: ReturnType<typeof spyOn>

  beforeEach(() => {
    injectHookMessageSpy = spyOn(
      hookMessageInjector,
      "injectHookMessage"
    ).mockImplementation(() => true)
    logSpy = spyOn(logger, "log").mockImplementation(() => {})

    // Clear mock call history
    injectHookMessageSpy.mockClear()
    logSpy.mockClear()
  })

  function createSummarizeContext(overrides?: Partial<SummarizeContext>): SummarizeContext {
    return {
      sessionID: "session-123",
      providerID: "anthropic",
      modelID: "claude-sonnet-4-20250514",
      usageRatio: 0.85,
      directory: "/test/project",
      ...overrides,
    }
  }

  test("returns async function", () => {
    // given: Factory function called
    const injector = createCompactionContextInjector()

    // then: Should return a function
    expect(typeof injector).toBe("function")
  })

  test("calls injectHookMessage with correct params", async () => {
    // given: Injector and context
    const injector = createCompactionContextInjector()
    const ctx = createSummarizeContext()

    // when: Call injector
    await injector(ctx)

    // then: injectHookMessage should be called with correct params
    expect(injectHookMessageSpy).toHaveBeenCalledTimes(1)
    const [sessionID, prompt, options] = injectHookMessageSpy.mock.calls[0] as [
      string,
      string,
      { agent: string; model: { providerID: string; modelID: string }; path: { cwd: string } }
    ]

    expect(sessionID).toBe("session-123")
    expect(prompt).toContain("COMPACTION CONTEXT")
    expect(prompt).toContain("User Requests (As-Is)")
    expect(prompt).toContain("Final Goal")
    expect(prompt).toContain("Files Modified")
    expect(prompt).toContain("Key Decisions & Rationale")
    expect(prompt).toContain("Current Working State")
    expect(prompt).toContain("Remaining Tasks")
    expect(prompt).toContain("MUST NOT Do")
    expect(options.agent).toBe("general")
    expect(options.model.providerID).toBe("anthropic")
    expect(options.model.modelID).toBe("claude-sonnet-4-20250514")
    expect(options.path.cwd).toBe("/test/project")
  })

  test("logs success when injection succeeds", async () => {
    // given: injectHookMessage returns true
    injectHookMessageSpy.mockImplementation(() => true)
    const injector = createCompactionContextInjector()
    const ctx = createSummarizeContext()

    // when: Call injector
    await injector(ctx)

    // then: Should log success
    const successLogCall = (logSpy.mock.calls as Array<[string, ...unknown[]]>).find(
      (call) => call[0] === "[compaction-context-injector] context injected"
    )
    expect(successLogCall).toBeDefined()
  })

  test("logs failure when injection fails", async () => {
    // given: injectHookMessage returns false
    injectHookMessageSpy.mockImplementation(() => false)
    const injector = createCompactionContextInjector()
    const ctx = createSummarizeContext()

    // when: Call injector
    await injector(ctx)

    // then: Should log failure
    const failureLogCall = (logSpy.mock.calls as Array<[string, ...unknown[]]>).find(
      (call) => call[0] === "[compaction-context-injector] injection failed"
    )
    expect(failureLogCall).toBeDefined()
  })

  test("logs initial injection attempt", async () => {
    // given: Injector
    const injector = createCompactionContextInjector()
    const ctx = createSummarizeContext()

    // when: Call injector
    await injector(ctx)

    // then: Should log injection attempt
    const attemptLogCall = (logSpy.mock.calls as Array<[string, ...unknown[]]>).find(
      (call) => call[0] === "[compaction-context-injector] injecting context"
    )
    expect(attemptLogCall).toBeDefined()
  })

  test("prompt includes all required sections", async () => {
    // given: Injector
    const injector = createCompactionContextInjector()
    const ctx = createSummarizeContext()

    // when: Call injector
    await injector(ctx)

    // then: Prompt should include all required sections
    const prompt = injectHookMessageSpy.mock.calls[0][1] as string

    // All 9 sections from the template
    expect(prompt).toContain("## 1. User Requests (As-Is)")
    expect(prompt).toContain("## 2. Final Goal")
    expect(prompt).toContain("## 3. Files Modified")
    expect(prompt).toContain("## 4. Key Decisions & Rationale")
    expect(prompt).toContain("## 5. Current Working State")
    expect(prompt).toContain("## 6. Environment & Tool Outputs Still Needed")
    expect(prompt).toContain("## 7. Remaining Tasks")
    expect(prompt).toContain("## 8. MUST NOT Do")
    expect(prompt).toContain("## 9. Important Context")
  })

  test("prompt contains critical preservation message", async () => {
    // given: Injector
    const injector = createCompactionContextInjector()
    const ctx = createSummarizeContext()

    // when: Call injector
    await injector(ctx)

    // then: Prompt should contain critical message about preservation
    const prompt = injectHookMessageSpy.mock.calls[0][1] as string
    expect(prompt).toContain("CRITICAL for maintaining continuity")
    expect(prompt).toContain("information loss")
  })
})
