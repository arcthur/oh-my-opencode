import { describe, test, expect, beforeEach, mock } from "bun:test"
import { createCategorySkillReminderHook } from "./index"

// Mock session state
const mockSessionAgents = new Map<string, string>()

mock.module("../../features/claude-code-session-state", () => ({
  getSessionAgent: (sessionID: string) => mockSessionAgents.get(sessionID),
}))

// Re-import after mocking
const { createCategorySkillReminderHook: createHook } = await import("./index")

function createMockCtx() {
  return {
    directory: "/test",
    client: {
      session: {
        messages: mock(() => Promise.resolve({ data: [] })),
      },
    },
  } as any
}

describe("category-skill-reminder hook", () => {
  beforeEach(() => {
    mockSessionAgents.clear()
  })

  describe("tool.execute.before", () => {
    test("injects reminder for orchestrator using work tools", async () => {
      // given
      mockSessionAgents.set("session-1", "sisyphus")
      const hook = createHook(createMockCtx())
      const output = { args: {}, message: "" }

      // when
      await hook["tool.execute.before"](
        { tool: "edit", sessionID: "session-1" },
        output
      )

      // then
      expect(output.message).toContain("Category + Skill System Available")
      expect(output.message).toContain("delegate_task")
    })

    test("injects reminder for atlas orchestrator", async () => {
      // given
      mockSessionAgents.set("session-2", "atlas")
      const hook = createHook(createMockCtx())
      const output = { args: {}, message: "" }

      // when
      await hook["tool.execute.before"](
        { tool: "write", sessionID: "session-2" },
        output
      )

      // then
      expect(output.message).toContain("Category + Skill System Available")
    })

    test("does NOT inject reminder for sisyphus-junior (executor)", async () => {
      // given
      mockSessionAgents.set("session-3", "sisyphus-junior")
      const hook = createHook(createMockCtx())
      const output = { args: {}, message: "" }

      // when
      await hook["tool.execute.before"](
        { tool: "edit", sessionID: "session-3" },
        output
      )

      // then
      expect(output.message).toBe("")
    })

    test("does NOT inject reminder for non-orchestrator agents", async () => {
      // given
      mockSessionAgents.set("session-4", "explore")
      const hook = createHook(createMockCtx())
      const output = { args: {}, message: "" }

      // when
      await hook["tool.execute.before"](
        { tool: "read", sessionID: "session-4" },
        output
      )

      // then
      expect(output.message).toBe("")
    })

    test("does NOT inject reminder for non-work tools", async () => {
      // given
      mockSessionAgents.set("session-5", "sisyphus")
      const hook = createHook(createMockCtx())
      const output = { args: {}, message: "" }

      // when
      await hook["tool.execute.before"](
        { tool: "delegate_task", sessionID: "session-5" },
        output
      )

      // then
      expect(output.message).toBe("")
    })

    test("only reminds once per session", async () => {
      // given
      mockSessionAgents.set("session-6", "sisyphus")
      const hook = createHook(createMockCtx())

      // when - first call
      const output1 = { message: "" }
      await hook["tool.execute.before"](
        { tool: "edit", sessionID: "session-6" },
        output1
      )

      // when - second call
      const output2 = { message: "" }
      await hook["tool.execute.before"](
        { tool: "write", sessionID: "session-6" },
        output2
      )

      // then
      expect(output1.message).toContain("Category + Skill System Available")
      expect(output2.message).toBe("") // No second reminder
    })

    test("reminds different sessions independently", async () => {
      // given
      mockSessionAgents.set("session-7a", "sisyphus")
      mockSessionAgents.set("session-7b", "atlas")
      const hook = createHook(createMockCtx())

      // when
      const output1 = { message: "" }
      await hook["tool.execute.before"](
        { tool: "edit", sessionID: "session-7a" },
        output1
      )

      const output2 = { message: "" }
      await hook["tool.execute.before"](
        { tool: "edit", sessionID: "session-7b" },
        output2
      )

      // then
      expect(output1.message).toContain("Category + Skill System Available")
      expect(output2.message).toContain("Category + Skill System Available")
    })

    test("handles missing sessionID gracefully", async () => {
      // given
      const hook = createHook(createMockCtx())
      const output = { args: {}, message: "" }

      // when
      await hook["tool.execute.before"](
        { tool: "edit" },
        output
      )

      // then
      expect(output.message).toBe("")
    })

    test("handles unknown session gracefully", async () => {
      // given - no session agent registered
      const hook = createHook(createMockCtx())
      const output = { args: {}, message: "" }

      // when
      await hook["tool.execute.before"](
        { tool: "edit", sessionID: "unknown-session" },
        output
      )

      // then
      expect(output.message).toBe("")
    })

    test("triggers on all delegatable work tools", async () => {
      // given
      const workTools = ["edit", "write", "bash", "read", "grep", "glob", "multi_edit"]

      for (const tool of workTools) {
        mockSessionAgents.set(`session-${tool}`, "sisyphus")
        const hook = createHook(createMockCtx())
        const output = { args: {}, message: "" }

        // when
        await hook["tool.execute.before"](
          { tool, sessionID: `session-${tool}` },
          output
        )

        // then
        expect(output.message).toContain("Category + Skill System Available")
      }
    })
  })

  describe("event handler", () => {
    test("cleans up reminder state on session.deleted", async () => {
      // given
      mockSessionAgents.set("session-cleanup", "sisyphus")
      const hook = createHook(createMockCtx())

      // First, trigger a reminder
      const output1 = { message: "" }
      await hook["tool.execute.before"](
        { tool: "edit", sessionID: "session-cleanup" },
        output1
      )
      expect(output1.message).toContain("Category + Skill System Available")

      // when - session deleted
      await hook.event({ type: "session.deleted", session: { id: "session-cleanup" } })

      // Re-register the agent (simulating a new session with same ID)
      mockSessionAgents.set("session-cleanup", "sisyphus")

      // then - should remind again after cleanup
      const output2 = { message: "" }
      await hook["tool.execute.before"](
        { tool: "edit", sessionID: "session-cleanup" },
        output2
      )
      expect(output2.message).toContain("Category + Skill System Available")
    })
  })
})
