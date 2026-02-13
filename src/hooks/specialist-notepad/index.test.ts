import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { createSpecialistNotepadHook, NOTEPAD_DIRECTIVE } from "./index"
import {
  _resetForTesting,
  clearSessionAgent,
  updateSessionAgent,
} from "../../features/claude-code-session-state"

function createMockCtx() {
  return {
    directory: "/test",
    client: {},
  } as any
}

describe("specialist-notepad hook", () => {
  beforeEach(() => {
    _resetForTesting()
  })

  afterEach(() => {
    _resetForTesting()
  })

  describe("tool.execute.before", () => {
    test("injects notepad directive when orchestrator delegates to specialist", async () => {
      // given
      const sessionID = "session-1"
      updateSessionAgent(sessionID, "orchestrator")
      const hook = createSpecialistNotepadHook(createMockCtx())
      const output = {
        args: {
          subagent_type: "specialist",
          prompt: "Implement the feature",
        },
      }

      // when
      await hook["tool.execute.before"](
        { tool: "delegate_task", sessionID },
        output
      )

      // then
      expect(output.args.prompt).toContain("<Work_Context>")
      expect(output.args.prompt).toContain("NOTEPAD PATH")
      expect(output.args.prompt).toContain("Implement the feature")

      clearSessionAgent(sessionID)
    })

    test("injects notepad directive when orchestrator delegates to specialist", async () => {
      // given
      const sessionID = "session-2"
      updateSessionAgent(sessionID, "orchestrator")
      const hook = createSpecialistNotepadHook(createMockCtx())
      const output = {
        args: {
          subagent_type: "specialist",
          prompt: "Execute task",
        },
      }

      // when
      await hook["tool.execute.before"](
        { tool: "delegate_task", sessionID },
        output
      )

      // then
      expect(output.args.prompt).toContain("<Work_Context>")

      clearSessionAgent(sessionID)
    })

    test("injects notepad directive for category-based delegation (spawns specialist)", async () => {
      // given
      const sessionID = "session-3"
      updateSessionAgent(sessionID, "orchestrator")
      const hook = createSpecialistNotepadHook(createMockCtx())
      const output = {
        args: {
          category: "visual-engineering",
          prompt: "Build the component",
        },
      }

      // when
      await hook["tool.execute.before"](
        { tool: "delegate_task", sessionID },
        output
      )

      // then
      expect(output.args.prompt).toContain("<Work_Context>")
      expect(output.args.prompt).toContain("Build the component")

      clearSessionAgent(sessionID)
    })

    test("does NOT inject when target is not specialist", async () => {
      // given
      const sessionID = "session-4"
      updateSessionAgent(sessionID, "orchestrator")
      const hook = createSpecialistNotepadHook(createMockCtx())
      const output = {
        args: {
          subagent_type: "advisor",
          prompt: "Analyze the architecture",
        },
      }

      // when
      await hook["tool.execute.before"](
        { tool: "delegate_task", sessionID },
        output
      )

      // then
      expect(output.args.prompt).toBe("Analyze the architecture")
      expect(output.args.prompt).not.toContain("<Work_Context>")

      clearSessionAgent(sessionID)
    })

    test("does NOT inject when caller is not an orchestrator", async () => {
      // given
      const sessionID = "session-5"
      updateSessionAgent(sessionID, "specialist")
      const hook = createSpecialistNotepadHook(createMockCtx())
      const output = {
        args: {
          subagent_type: "specialist",
          prompt: "Some task",
        },
      }

      // when
      await hook["tool.execute.before"](
        { tool: "delegate_task", sessionID },
        output
      )

      // then
      expect(output.args.prompt).toBe("Some task")

      clearSessionAgent(sessionID)
    })

    test("does NOT inject for non-delegate_task tools", async () => {
      // given
      const sessionID = "session-6"
      updateSessionAgent(sessionID, "orchestrator")
      const hook = createSpecialistNotepadHook(createMockCtx())
      const output = {
        args: {
          prompt: "Some prompt",
        },
      }

      // when
      await hook["tool.execute.before"](
        { tool: "edit", sessionID },
        output
      )

      // then
      expect(output.args.prompt).toBe("Some prompt")

      clearSessionAgent(sessionID)
    })

    test("avoids double-injection if prompt already has Work_Context", async () => {
      // given
      const sessionID = "session-7"
      updateSessionAgent(sessionID, "orchestrator")
      const hook = createSpecialistNotepadHook(createMockCtx())
      const existingPrompt = "<Work_Context>Already has context</Work_Context>\nDo the work"
      const output = {
        args: {
          subagent_type: "specialist",
          prompt: existingPrompt,
        },
      }

      // when
      await hook["tool.execute.before"](
        { tool: "delegate_task", sessionID },
        output
      )

      // then - should not double-inject
      expect(output.args.prompt).toBe(existingPrompt)

      clearSessionAgent(sessionID)
    })

    test("handles missing sessionID gracefully", async () => {
      // given
      const hook = createSpecialistNotepadHook(createMockCtx())
      const output = {
        args: {
          subagent_type: "specialist",
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
      const sessionID = "session-8"
      updateSessionAgent(sessionID, "orchestrator")
      const hook = createSpecialistNotepadHook(createMockCtx())
      const output = {
        args: {
          category: "quick",
          prompt: "",
        },
      }

      // when
      await hook["tool.execute.before"](
        { tool: "delegate_task", sessionID },
        output
      )

      // then
      expect(output.args.prompt).toBe("")

      clearSessionAgent(sessionID)
    })

    test("handles undefined prompt", async () => {
      // given
      const sessionID = "session-9"
      updateSessionAgent(sessionID, "orchestrator")
      const hook = createSpecialistNotepadHook(createMockCtx())
      const output = {
        args: {
          subagent_type: "specialist",
        },
      }

      // when
      await hook["tool.execute.before"](
        { tool: "delegate_task", sessionID },
        output
      )

      // then
      expect(output.args.prompt).toBeUndefined()

      clearSessionAgent(sessionID)
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
      const sessionID = "session-10"
      updateSessionAgent(sessionID, "orchestrator")
      const hook = createSpecialistNotepadHook(createMockCtx())
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
        { tool: "delegate_task", sessionID },
        output
      )

      // then
      expect(output.args.prompt).toContain("<Work_Context>")
      expect(output.args.category).toBe("visual-engineering")
      expect(output.args.load_skills).toEqual(["frontend-ui-ux"])
      expect(output.args.run_in_background).toBe(true)

      clearSessionAgent(sessionID)
    })
  })
})
