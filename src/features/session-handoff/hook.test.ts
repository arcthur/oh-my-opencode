import { describe, expect, mock, test, beforeEach } from "bun:test"

mock.module("./storage", () => ({
  generateHandoffId: () => "ho_test_0",
  cleanupExpired: mock(() => 0),
  shouldRunCleanup: mock(() => false),
  findHandoffBySessionId: mock(() => null),
  saveHandoff: mock(() => {}),
  loadIndex: mock(() => ({ version: 1, handoffs: [], lastCleanup: Date.now() })),
  saveIndex: mock(() => {}),
  findHandoffsForProject: mock(() => []),
  findRecentHandoffs: mock(() => []),
  loadHandoff: mock(() => null),
  deleteHandoff: mock(() => false),
  getRecentSessionHandoffs: mock(() => []),
  saveEmbeddings: mock(() => {}),
}))

mock.module("./injector", () => ({
  generateInjectionContent: () => "handoff-context",
  resolveSessionReference: () => null,
}))

const { createSessionHandoffHook } = require("./hook")
const { DEFAULT_HANDOFF_CONFIG } = require("./types")

describe("session-handoff hook", () => {
  beforeEach(() => {
    const storage = require("./storage")
    storage.findHandoffsForProject.mockReset()
    storage.findRecentHandoffs.mockReset()
    storage.loadIndex.mockReset()
    storage.loadHandoff.mockReset()
    storage.deleteHandoff.mockReset()
  })

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

  test("handles /handoff list via chat.message (no handoffs)", async () => {
    const storage = require("./storage")
    storage.findHandoffsForProject.mockReturnValueOnce([])

    // #given
    const hook = createSessionHandoffHook({
      config: { ...DEFAULT_HANDOFF_CONFIG, auto_extract: false },
      cwd: "/project",
      callLLM: async () => "{}",
    })

    const output = { parts: [{ type: "text", text: "/handoff" }] }

    // #when
    await hook["chat.message"]?.({ sessionID: "session-1" }, output)

    // #then
    expect(storage.findHandoffsForProject).toHaveBeenCalledWith("/project")
    expect(output.parts[0]?.text).toContain("No handoffs found")
    expect(output.parts[0]?.text).toContain("<session-handoff-result>")
  })

  test("handles /handoff list via chat.message (with handoffs)", async () => {
    const storage = require("./storage")
    storage.findHandoffsForProject.mockReturnValueOnce([
      {
        id: "ho_1706500000_abc",
        sourceSessionId: "session-0",
        projectPath: "/project",
        originalGoal: "Test goal",
        createdAt: Date.now() - 60_000,
        expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
        outcome: "completed",
        decisionCount: 2,
        artifactCount: 3,
      },
    ])

    // #given
    const hook = createSessionHandoffHook({
      config: { ...DEFAULT_HANDOFF_CONFIG, auto_extract: false },
      cwd: "/project",
      callLLM: async () => "{}",
    })

    const output = { parts: [{ type: "text", text: "/handoff list" }] }

    // #when
    await hook["chat.message"]?.({ sessionID: "session-1" }, output)

    // #then
    expect(storage.findHandoffsForProject).toHaveBeenCalledWith("/project")
    expect(output.parts[0]?.text).toContain("## Session Handoffs")
    expect(output.parts[0]?.text).toContain("Test goal")
    expect(output.parts[0]?.text).toContain("2d/3a")
  })
})
