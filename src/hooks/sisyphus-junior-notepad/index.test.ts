import { describe, test, expect, beforeEach, mock } from "bun:test"
import { createSisyphusJuniorNotepadHook, NOTEPAD_DIRECTIVE } from "./index"

// Mock session state
const mockSessionAgents = new Map<string, string>()

mock.module("../../features/claude-code-session-state", () => ({
  getSessionAgent: (sessionID: string) => mockSessionAgents.get(sessionID),
}))

// Re-import after mocking
const { createSisyphusJuniorNotepadHook: createHook } = await import("./index")

function createMockCtx() {
  return {
    directory: "/test",
    client: {},
  } as any
}

describe("sisyphus-junior-notepad hook", () => {
  beforeEach(() => {
    mockSessionAgents.clear()
  })

  describe("tool.execute.before", () => {
    test("injects notepad directive when sisyphus delegates to sisyphus-junior", async () => {
      // given
      mockSessionAgents.set("session-1", "sisyphus")
      const hook = createHook(createMockCtx())
      const output = {
        args: {
          subagent_type: "sisyphus-junior",
          prompt: "Implement the feature",
        },
      }

      // when
      await hook["tool.execute.before"](
        { tool: "delegate_task", sessionID: "session-1" },
        output
      )

      // then
      expect(output.args.prompt).toContain("<Work_Context>")
      expect(output.args.prompt).toContain("NOTEPAD PATH")
      expect(output.args.prompt).toContain("Implement the feature")
    })

    test("injects notepad directive when atlas delegates to sisyphus-junior", async () => {
      // given
      mockSessionAgents.set("session-2", "atlas")
      const hook = createHook(createMockCtx())
      const output = {
        args: {
          subagent_type: "sisyphus-junior",
          prompt: "Execute task",
        },
      }

      // when
      await hook["tool.execute.before"](
        { tool: "delegate_task", sessionID: "session-2" },
        output
      )

      // then
      expect(output.args.prompt).toContain("<Work_Context>")
    })

    test("injects notepad directive for category-based delegation (spawns sisyphus-junior)", async () => {
      // given
      mockSessionAgents.set("session-3", "sisyphus")
      const hook = createHook(createMockCtx())
      const output = {
        args: {
          category: "visual-engineering",
          prompt: "Build the component",
        },
      }

      // when
      await hook["tool.execute.before"](
        { tool: "delegate_task", sessionID: "session-3" },
        output
      )

      // then
      expect(output.args.prompt).toContain("<Work_Context>")
      expect(output.args.prompt).toContain("Build the component")
    })

    test("does NOT inject when target is not sisyphus-junior", async () => {
      // given
      mockSessionAgents.set("session-4", "sisyphus")
      const hook = createHook(createMockCtx())
      const output = {
        args: {
          subagent_type: "oracle",
          prompt: "Analyze the architecture",
        },
      }

      // when
      await hook["tool.execute.before"](
        { tool: "delegate_task", sessionID: "session-4" },
        output
      )

      // then
      expect(output.args.prompt).toBe("Analyze the architecture")
      expect(output.args.prompt).not.toContain("<Work_Context>")
    })

    test("does NOT inject when caller is not an orchestrator", async () => {
      // given
      mockSessionAgents.set("session-5", "sisyphus-junior")
      const hook = createHook(createMockCtx())
      const output = {
        args: {
          subagent_type: "sisyphus-junior",
          prompt: "Some task",
        },
      }

      // when
      await hook["tool.execute.before"](
        { tool: "delegate_task", sessionID: "session-5" },
        output
      )

      // then
      expect(output.args.prompt).toBe("Some task")
    })

    test("does NOT inject for non-delegate_task tools", async () => {
      // given
      mockSessionAgents.set("session-6", "sisyphus")
      const hook = createHook(createMockCtx())
      const output = {
        args: {
          prompt: "Some prompt",
        },
      }

      // when
      await hook["tool.execute.before"](
        { tool: "edit", sessionID: "session-6" },
        output
      )

      // then
      expect(output.args.prompt).toBe("Some prompt")
    })

    test("avoids double-injection if prompt already has Work_Context", async () => {
      // given
      mockSessionAgents.set("session-7", "sisyphus")
      const hook = createHook(createMockCtx())
      const existingPrompt = "<Work_Context>Already has context</Work_Context>\nDo the work"
      const output = {
        args: {
          subagent_type: "sisyphus-junior",
          prompt: existingPrompt,
        },
      }

      // when
      await hook["tool.execute.before"](
        { tool: "delegate_task", sessionID: "session-7" },
        output
      )

      // then - should not double-inject
      expect(output.args.prompt).toBe(existingPrompt)
    })

    test("handles missing sessionID gracefully", async () => {
      // given
      const hook = createHook(createMockCtx())
      const output = {
        args: {
          subagent_type: "sisyphus-junior",
          prompt: "Task",
        },
      }

      // when
      await hook["tool.execute.before"](
        { tool: "delegate_task" },
        output
      )

      // then
      expect(output.args.prompt).toBe("Task")
    })

    test("handles empty prompt", async () => {
      // given
      mockSessionAgents.set("session-8", "atlas")
      const hook = createHook(createMockCtx())
      const output = {
        args: {
          category: "quick",
          prompt: "",
        },
      }

      // when
      await hook["tool.execute.before"](
        { tool: "delegate_task", sessionID: "session-8" },
        output
      )

      // then
      expect(output.args.prompt).toContain("<Work_Context>")
    })

    test("handles undefined prompt", async () => {
      // given
      mockSessionAgents.set("session-9", "sisyphus")
      const hook = createHook(createMockCtx())
      const output = {
        args: {
          subagent_type: "sisyphus-junior",
        },
      }

      // when
      await hook["tool.execute.before"](
        { tool: "delegate_task", sessionID: "session-9" },
        output
      )

      // then
      expect(output.args.prompt).toContain("<Work_Context>")
    })

    test("notepad directive contains required elements", () => {
      // then - verify directive structure
      expect(NOTEPAD_DIRECTIVE).toContain("NOTEPAD PATH")
      expect(NOTEPAD_DIRECTIVE).toContain("learnings.md")
      expect(NOTEPAD_DIRECTIVE).toContain("issues.md")
      expect(NOTEPAD_DIRECTIVE).toContain("decisions.md")
      expect(NOTEPAD_DIRECTIVE).toContain("problems.md")
      expect(NOTEPAD_DIRECTIVE).toContain("PLAN PATH")
      expect(NOTEPAD_DIRECTIVE).toContain("NEVER MODIFY THE PLAN FILE")
      expect(NOTEPAD_DIRECTIVE).toContain("READ-ONLY")
    })

    test("preserves other args when injecting", async () => {
      // given
      mockSessionAgents.set("session-10", "sisyphus")
      const hook = createHook(createMockCtx())
      const output = {
        args: {
          category: "visual-engineering",
          prompt: "Do work",
          load_skills: ["frontend-ui-ux"],
          run_in_background: true,
        },
      }

      // when
      await hook["tool.execute.before"](
        { tool: "delegate_task", sessionID: "session-10" },
        output
      )

      // then
      expect(output.args.prompt).toContain("<Work_Context>")
      expect(output.args.category).toBe("visual-engineering")
      expect(output.args.load_skills).toEqual(["frontend-ui-ux"])
      expect(output.args.run_in_background).toBe(true)
    })
  })
})
