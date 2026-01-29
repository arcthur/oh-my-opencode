import { describe, expect, mock, test } from "bun:test"

mock.module("./storage", () => ({
  generateHandoffId: () => "ho_test_0",
  cleanupExpired: () => 0,
  shouldRunCleanup: () => false,
  findHandoffBySessionId: () => null,
  saveHandoff: () => {},
  findHandoffsForProject: () => [],
  loadHandoff: () => null,
  getRecentSessionHandoffs: () => [],
}))

mock.module("./injector", () => ({
  generateInjectionContent: () => "handoff-context",
  resolveSessionReference: () => null,
}))

const { createSessionHandoffHook } = require("./hook")
const { DEFAULT_HANDOFF_CONFIG } = require("./types")

describe("session-handoff hook", () => {
  test("re-injects handoff context after session.compacted", async () => {
    //#given
    const register = mock(() => {})
    const hook = createSessionHandoffHook({
      config: { ...DEFAULT_HANDOFF_CONFIG, auto_extract: false },
      cwd: "/project",
      callLLM: async () => "{}",
      collector: { register },
    })

    const sessionID = "session-1"

    //#when - first prompt triggers injection
    await hook["user.prompt.submit"]?.({
      sessionID,
      parts: [{ type: "text", text: "hello" }],
    })

    //#then
    expect(register).toHaveBeenCalledTimes(1)

    //#when - second prompt does not re-inject
    await hook["user.prompt.submit"]?.({
      sessionID,
      parts: [{ type: "text", text: "hello again" }],
    })

    //#then
    expect(register).toHaveBeenCalledTimes(1)

    //#when - compaction resets injection tracking
    await hook.event?.({ event: { type: "session.compacted", properties: { sessionID } } })
    await hook["user.prompt.submit"]?.({
      sessionID,
      parts: [{ type: "text", text: "after compact" }],
    })

    //#then - re-injected
    expect(register).toHaveBeenCalledTimes(2)
    const lastCall = register.mock.calls[1]
    expect(lastCall?.[0]).toBe(sessionID)
    expect((lastCall?.[1] as { id?: string }).id).toBe("session-handoff-context")
  })
})
