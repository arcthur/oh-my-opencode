import { describe, it, expect } from "bun:test"
import { createSlashcommandTool } from "./tools"
import type { CommandInfo } from "./types"
import type { LoadedSkill } from "../../features/opencode-skill-loader"

function createMockCommand(name: string, description = ""): CommandInfo {
  return {
    name,
    metadata: {
      name,
      description: description || `Test command ${name}`,
    },
    scope: "builtin",
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

describe("slashcommand tool - synchronous description", () => {
  it("includes command list immediately and excludes skills", () => {
    // given
    const commands = [createMockCommand("commit", "Create a git commit")]
    const skills = [createMockSkill("playwright", "Browser automation via Playwright MCP")]

    // when
    const tool = createSlashcommandTool({ commands, skills })

    // then
    expect(tool.description).toContain("<available_commands>")
    expect(tool.description).toContain("commit")
    expect(tool.description).not.toContain("playwright")
  })

  it("includes all pre-provided commands in description immediately", () => {
    // given
    const commands = [
      createMockCommand("commit", "Git commit"),
      createMockCommand("plan", "Create plan"),
    ]
    const skills = [
      createMockSkill("playwright", "Browser automation"),
      createMockSkill("frontend-ui-ux", "Frontend design"),
      createMockSkill("git-master", "Git operations"),
    ]

    // when
    const tool = createSlashcommandTool({ commands, skills })

    // then
    expect(tool.description).toContain("commit")
    expect(tool.description).toContain("plan")
    expect(tool.description).not.toContain("playwright")
    expect(tool.description).not.toContain("frontend-ui-ux")
    expect(tool.description).not.toContain("git-master")
  })

  it("shows prefix-only description when both commands and skills are empty", () => {
    // given / #when
    const tool = createSlashcommandTool({ commands: [], skills: [] })

    // then - even with no items, description should be built synchronously (not just prefix)
    expect(tool.description).toContain("Load or execute a slash command")
    expect(tool.description).not.toContain("Load a skill")
  })

  it("includes user_message parameter documentation in description", () => {
    // given
    const commands = [createMockCommand("publish", "Publish package")]
    const skills: LoadedSkill[] = []

    // when
    const tool = createSlashcommandTool({ commands, skills })

    // then
    expect(tool.description).toContain("user_message")
    expect(tool.description).toContain("command='publish' user_message='patch'")
  })
})

describe("slashcommand tool - command-only execution semantics", () => {
  it("executes a command by name", async () => {
    // given
    const commands = [createMockCommand("commit", "Create a git commit")]
    const skills = [createMockSkill("playwright", "Browser automation via Playwright MCP")]
    const tool = createSlashcommandTool({ commands, skills })

    // when
    const result = await tool.execute({ command: "commit" } as never, {} as never)

    // then
    expect(result).toContain("# /commit Command")
  })

  it("does not resolve skill names as slash commands", async () => {
    // given
    const commands = [createMockCommand("commit", "Create a git commit")]
    const skills = [createMockSkill("playwright", "Browser automation via Playwright MCP")]
    const tool = createSlashcommandTool({ commands, skills })

    // when
    const result = await tool.execute({ command: "playwright" } as never, {} as never)

    // then
    expect(result).toContain('Command "/playwright" not found.')
    expect(result).not.toContain("# /playwright Command")
  })

  it("respects disabledBuiltinCommands during lazy command discovery", async () => {
    // given
    const tool = createSlashcommandTool({
      disabledBuiltinCommands: ["stop-continuation"],
    })

    // when
    const result = await tool.execute({ command: "stop-continuation" } as never, {} as never)

    // then
    expect(result).toContain('Command "/stop-continuation" not found.')
    expect(result).not.toContain("# /stop-continuation Command")
  })
})
