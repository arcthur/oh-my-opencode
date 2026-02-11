import { describe, expect, it, beforeEach, mock, spyOn } from "bun:test"
import type {
  AutoSlashCommandHookInput,
  AutoSlashCommandHookOutput,
} from "./types"
import { AUTO_SLASH_COMMAND_TAG_OPEN } from "./constants"
import type { LoadedSkill } from "../../features/opencode-skill-loader"
import { clearSessionAgent, getSessionAgent } from "../../features/claude-code-session-state"

// Import real shared module to avoid mock leaking to other test files
import * as shared from "../../shared"

// Spy on log instead of mocking the entire module
const logMock = spyOn(shared, "log").mockImplementation(() => {})



const { createAutoSlashCommandHook } = await import("./index")

function createMockInput(sessionID: string, messageID?: string): AutoSlashCommandHookInput {
  return {
    sessionID,
    messageID: messageID ?? `msg-${Date.now()}-${Math.random()}`,
    agent: "test-agent",
    model: { providerID: "anthropic", modelID: "claude-sonnet-4-5" },
  }
}

function createMockOutput(text: string): AutoSlashCommandHookOutput {
  return {
    message: {
      agent: "test-agent",
      model: { providerID: "anthropic", modelID: "claude-sonnet-4-5" },
      path: { cwd: "/test", root: "/test" },
      tools: {},
    },
    parts: [{ type: "text", text }],
  }
}

function createMockSkill(name: string, description = ""): LoadedSkill {
  return {
    name,
    path: `/test/skills/${name}/SKILL.md`,
    resolvedPath: `/test/skills/${name}`,
    definition: {
      name,
      description: description || `Test skill ${name}`,
      template: "Test template",
    },
    scope: "opencode-project",
  }
}

describe("createAutoSlashCommandHook", () => {
  beforeEach(() => {
    logMock.mockClear()
  })

  describe("slash command replacement", () => {
    it("should replace builtin command template", async () => {
      // given a builtin slash command
      const hook = createAutoSlashCommandHook()
      const sessionID = `test-session-builtin-${Date.now()}`
      const input = createMockInput(sessionID)
      const output = createMockOutput("/stop-continuation")

      // when hook is called
      await hook["chat.message"](input, output)

      // then should inject tagged template
      expect(output.parts[0].text).toContain(AUTO_SLASH_COMMAND_TAG_OPEN)
      expect(output.parts[0].text).toContain("# /stop-continuation Command")
    })

    it("should switch session agent to prometheus for /brainstorm", async () => {
      // given a brainstorm slash command
      const hook = createAutoSlashCommandHook()
      const sessionID = `test-session-brainstorm-agent-${Date.now()}`
      const input = createMockInput(sessionID)
      const output = createMockOutput("/brainstorm auth workflow")

      // when hook is called
      await hook["chat.message"](input, output)

      // then should inject template and update session agent
      expect(output.parts[0].text).toContain(AUTO_SLASH_COMMAND_TAG_OPEN)
      expect(output.parts[0].text).toContain("# /brainstorm Command")
      expect(getSessionAgent(sessionID)).toBe("prometheus")

      clearSessionAgent(sessionID)
    })

    it("should not modify message when command not found", async () => {
      // given a slash command that doesn't exist
      const hook = createAutoSlashCommandHook()
      const sessionID = `test-session-notfound-${Date.now()}`
      const input = createMockInput(sessionID)
      const output = createMockOutput("/nonexistent-command args")
      const originalText = output.parts[0].text

      // when hook is called
      await hook["chat.message"](input, output)

      // then should NOT modify the message (feature inactive when command not found)
      expect(output.parts[0].text).toBe(originalText)
    })

    it("should not modify message for unknown command (feature inactive)", async () => {
      // given unknown slash command
      const hook = createAutoSlashCommandHook()
      const sessionID = `test-session-tags-${Date.now()}`
      const input = createMockInput(sessionID)
      const output = createMockOutput("/some-command")
      const originalText = output.parts[0].text

      // when hook is called
      await hook["chat.message"](input, output)

      // then should NOT modify (command not found = feature inactive)
      expect(output.parts[0].text).toBe(originalText)
    })

    it("should not modify for unknown command (no prepending)", async () => {
      // given unknown slash command
      const hook = createAutoSlashCommandHook()
      const sessionID = `test-session-replace-${Date.now()}`
      const input = createMockInput(sessionID)
      const output = createMockOutput("/test-cmd some args")
      const originalText = output.parts[0].text

      // when hook is called
      await hook["chat.message"](input, output)

      // then should not modify (feature inactive for unknown commands)
      expect(output.parts[0].text).toBe(originalText)
    })
  })

  describe("no slash command", () => {
    it("should do nothing for regular text", async () => {
      // given regular text without slash
      const hook = createAutoSlashCommandHook()
      const sessionID = `test-session-regular-${Date.now()}`
      const input = createMockInput(sessionID)
      const output = createMockOutput("Just regular text")
      const originalText = output.parts[0].text

      // when hook is called
      await hook["chat.message"](input, output)

      // then should not modify
      expect(output.parts[0].text).toBe(originalText)
    })

    it("should do nothing for slash in middle of text", async () => {
      // given slash in middle
      const hook = createAutoSlashCommandHook()
      const sessionID = `test-session-middle-${Date.now()}`
      const input = createMockInput(sessionID)
      const output = createMockOutput("Please run /commit later")
      const originalText = output.parts[0].text

      // when hook is called
      await hook["chat.message"](input, output)

      // then should not detect (not at start)
      expect(output.parts[0].text).toBe(originalText)
    })
  })

  describe("excluded commands", () => {
    it("should NOT trigger for ralph-loop command", async () => {
      // given ralph-loop command
      const hook = createAutoSlashCommandHook()
      const sessionID = `test-session-ralph-${Date.now()}`
      const input = createMockInput(sessionID)
      const output = createMockOutput("/ralph-loop do something")
      const originalText = output.parts[0].text

      // when hook is called
      await hook["chat.message"](input, output)

      // then should not modify (excluded command)
      expect(output.parts[0].text).toBe(originalText)
    })

    it("should NOT trigger for cancel-ralph command", async () => {
      // given cancel-ralph command
      const hook = createAutoSlashCommandHook()
      const sessionID = `test-session-cancel-${Date.now()}`
      const input = createMockInput(sessionID)
      const output = createMockOutput("/cancel-ralph")
      const originalText = output.parts[0].text

      // when hook is called
      await hook["chat.message"](input, output)

      // then should not modify
      expect(output.parts[0].text).toBe(originalText)
    })

    it("should NOT resolve skill names as slash commands even when skills are provided", async () => {
      // given a skill-like slash token
      const hook = createAutoSlashCommandHook({
        skills: [createMockSkill("playwright", "Browser automation via Playwright MCP")],
      })
      const sessionID = `test-session-skill-split-${Date.now()}`
      const input = createMockInput(sessionID)
      const output = createMockOutput("/playwright")
      const originalText = output.parts[0].text

      // when hook is called
      await hook["chat.message"](input, output)

      // then should not modify (skill is not a slash command)
      expect(output.parts[0].text).toBe(originalText)
      expect(output.parts[0].text).not.toContain(AUTO_SLASH_COMMAND_TAG_OPEN)
    })
  })

  describe("already processed", () => {
    it("should skip if auto-slash-command tags already present", async () => {
      // given text with existing tags
      const hook = createAutoSlashCommandHook()
      const sessionID = `test-session-existing-${Date.now()}`
      const input = createMockInput(sessionID)
      const output = createMockOutput(
        "<auto-slash-command>/commit</auto-slash-command>"
      )
      const originalText = output.parts[0].text

      // when hook is called
      await hook["chat.message"](input, output)

      // then should not modify
      expect(output.parts[0].text).toBe(originalText)
    })
  })

  describe("code blocks", () => {
    it("should NOT detect command inside code block", async () => {
      // given command inside code block
      const hook = createAutoSlashCommandHook()
      const sessionID = `test-session-codeblock-${Date.now()}`
      const input = createMockInput(sessionID)
      const output = createMockOutput("```\n/commit\n```")
      const originalText = output.parts[0].text

      // when hook is called
      await hook["chat.message"](input, output)

      // then should not detect
      expect(output.parts[0].text).toBe(originalText)
    })
  })

  describe("edge cases", () => {
    it("should handle empty text", async () => {
      // given empty text
      const hook = createAutoSlashCommandHook()
      const sessionID = `test-session-empty-${Date.now()}`
      const input = createMockInput(sessionID)
      const output = createMockOutput("")

      // when hook is called
      // then should not throw
      await expect(hook["chat.message"](input, output)).resolves.toBeUndefined()
    })

    it("should handle just slash", async () => {
      // given just slash
      const hook = createAutoSlashCommandHook()
      const sessionID = `test-session-slash-only-${Date.now()}`
      const input = createMockInput(sessionID)
      const output = createMockOutput("/")
      const originalText = output.parts[0].text

      // when hook is called
      await hook["chat.message"](input, output)

      // then should not modify
      expect(output.parts[0].text).toBe(originalText)
    })

    it("should handle command with special characters in args (not found = no modification)", async () => {
      // given command with special characters that doesn't exist
      const hook = createAutoSlashCommandHook()
      const sessionID = `test-session-special-${Date.now()}`
      const input = createMockInput(sessionID)
      const output = createMockOutput('/execute "test & stuff <tag>"')
      const originalText = output.parts[0].text

      // when hook is called
      await hook["chat.message"](input, output)

      // then should not modify (command not found = feature inactive)
      expect(output.parts[0].text).toBe(originalText)
    })

    it("should handle multiple text parts (unknown command = no modification)", async () => {
      // given multiple text parts with unknown command
      const hook = createAutoSlashCommandHook()
      const sessionID = `test-session-multi-${Date.now()}`
      const input = createMockInput(sessionID)
      const output: AutoSlashCommandHookOutput = {
        message: {},
        parts: [
          { type: "text", text: "/truly-nonexistent-xyz-cmd " },
          { type: "text", text: "some args" },
        ],
      }
      const originalText = output.parts[0].text

      // when hook is called
      await hook["chat.message"](input, output)

      // then should not modify (command not found = feature inactive)
      expect(output.parts[0].text).toBe(originalText)
    })
  })

  describe("command.execute.before hook", () => {
    it("should inject tagged content for builtin command", async () => {
      // given
      const hook = createAutoSlashCommandHook()
      const sessionID = `test-session-command-before-${Date.now()}`
      const input = { command: "stop-continuation", sessionID, arguments: "" }
      const output = { parts: [{ type: "text", text: "/stop-continuation" }] }

      // when
      await hook["command.execute.before"]?.(input, output)

      // then
      expect(output.parts[0].text).toContain(AUTO_SLASH_COMMAND_TAG_OPEN)
      expect(output.parts[0].text).toContain("# /stop-continuation Command")
    })

    it("should switch session agent to prometheus for brainstorm command", async () => {
      // given
      const hook = createAutoSlashCommandHook()
      const sessionID = `test-session-command-before-brainstorm-${Date.now()}`
      const input = { command: "brainstorm", sessionID, arguments: "auth workflow" }
      const output = { parts: [{ type: "text", text: "/brainstorm auth workflow" }] }

      // when
      await hook["command.execute.before"]?.(input, output)

      // then
      expect(output.parts[0].text).toContain(AUTO_SLASH_COMMAND_TAG_OPEN)
      expect(output.parts[0].text).toContain("# /brainstorm Command")
      expect(getSessionAgent(sessionID)).toBe("prometheus")

      clearSessionAgent(sessionID)
    })

    it("should respect disabled builtin commands and skip injection", async () => {
      // given
      const hook = createAutoSlashCommandHook({
        disabledBuiltinCommands: ["stop-continuation"],
      })
      const sessionID = `test-session-command-before-disabled-${Date.now()}`
      const input = { command: "stop-continuation", sessionID, arguments: "" }
      const output = { parts: [{ type: "text", text: "/stop-continuation" }] }
      const originalText = output.parts[0].text

      // when
      await hook["command.execute.before"]?.(input, output)

      // then
      expect(output.parts[0].text).toBe(originalText)
      expect(output.parts[0].text).not.toContain(AUTO_SLASH_COMMAND_TAG_OPEN)
    })
  })
})
