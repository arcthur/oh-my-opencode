import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import {
  discoverProjectClaudeSkills,
  discoverSkills,
} from "../../../src/features/opencode-skill-loader/loader"

type SkillDiscoveryContext = {
  cwd: string
  homeDir: string
  claudeConfigDir: string
  opencodeConfigDir: string
}

describe("skill loader MCP parsing", () => {
  let testDir: string
  let context: SkillDiscoveryContext

  function getOpencodeProjectSkillsDir(): string {
    return join(testDir, ".opencode", "skills")
  }

  function getOpencodeGlobalSkillsDir(): string {
    return join(context.opencodeConfigDir, "skills")
  }

  function getProjectClaudeSkillsDir(): string {
    return join(testDir, ".claude", "skills")
  }

  function getProjectAgentsSkillsDir(): string {
    return join(testDir, ".agents", "skills")
  }

  function getUserClaudeSkillsDir(): string {
    return join(context.claudeConfigDir, "skills")
  }

  function getUserAgentsSkillsDir(): string {
    return join(context.homeDir, ".agents", "skills")
  }

  function createSkill(dir: string, name: string, content: string, mcpJson?: object): string {
    const skillDir = join(dir, name)
    mkdirSync(skillDir, { recursive: true })
    writeFileSync(join(skillDir, "SKILL.md"), content)
    if (mcpJson) {
      writeFileSync(join(skillDir, "mcp.json"), JSON.stringify(mcpJson, null, 2))
    }
    return skillDir
  }

  function createProjectOpencodeSkill(name: string, content: string, mcpJson?: object): string {
    return createSkill(getOpencodeProjectSkillsDir(), name, content, mcpJson)
  }

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), "skill-loader-test-"))
    context = {
      cwd: testDir,
      homeDir: join(testDir, "home"),
      claudeConfigDir: join(testDir, "claude-user"),
      opencodeConfigDir: join(testDir, "opencode-global"),
    }

    mkdirSync(context.homeDir, { recursive: true })
    mkdirSync(context.claudeConfigDir, { recursive: true })
    mkdirSync(context.opencodeConfigDir, { recursive: true })
  })

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true })
  })

  describe("parseSkillMcpConfig", () => {
    it("parses skill with nested MCP config", async () => {
      // given
      const skillContent = `---
name: test-skill
description: A test skill with MCP
mcp:
  sqlite:
    command: uvx
    args:
      - mcp-server-sqlite
      - --db-path
      - ./data.db
  memory:
    command: npx
    args: [-y, "@anthropic-ai/mcp-server-memory"]
---
This is the skill body.
`
      createProjectOpencodeSkill("test-mcp-skill", skillContent)

      // when
      const skills = await discoverSkills({ includeClaudeCodePaths: false, ...context })
      const skill = skills.find((s) => s.name === "test-skill")

      // then
      expect(skill).toBeDefined()
      expect(skill?.mcpConfig).toBeDefined()
      expect(skill?.mcpConfig?.sqlite).toBeDefined()
      expect(skill?.mcpConfig?.sqlite?.command).toBe("uvx")
      expect(skill?.mcpConfig?.sqlite?.args).toEqual([
        "mcp-server-sqlite",
        "--db-path",
        "./data.db",
      ])
      expect(skill?.mcpConfig?.memory).toBeDefined()
      expect(skill?.mcpConfig?.memory?.command).toBe("npx")
    })

    it("returns undefined mcpConfig for skill without MCP", async () => {
      // given
      const skillContent = `---
name: simple-skill
description: A simple skill without MCP
---
This is a simple skill.
`
      createProjectOpencodeSkill("simple-skill", skillContent)

      // when
      const skills = await discoverSkills({ includeClaudeCodePaths: false, ...context })
      const skill = skills.find((s) => s.name === "simple-skill")

      // then
      expect(skill).toBeDefined()
      expect(skill?.mcpConfig).toBeUndefined()
    })

    it("preserves env var placeholders without expansion", async () => {
      // given
      const skillContent = `---
name: env-skill
mcp:
  api-server:
    command: node
    args: [server.js]
    env:
      API_KEY: "\${API_KEY}"
      DB_PATH: "\${HOME}/data.db"
---
Skill with env vars.
`
      createProjectOpencodeSkill("env-skill", skillContent)

      // when
      const skills = await discoverSkills({ includeClaudeCodePaths: false, ...context })
      const skill = skills.find((s) => s.name === "env-skill")

      // then
      expect(skill?.mcpConfig?.["api-server"]?.env?.API_KEY).toBe("${API_KEY}")
      expect(skill?.mcpConfig?.["api-server"]?.env?.DB_PATH).toBe("${HOME}/data.db")
    })

    it("handles malformed YAML gracefully", async () => {
      // given
      const skillContent = `---
name: bad-yaml
mcp: [this is not valid yaml for mcp
---
Skill body.
`
      createProjectOpencodeSkill("bad-yaml-skill", skillContent)

      // when
      const skills = await discoverSkills({ includeClaudeCodePaths: false, ...context })
      const skill = skills.find((s) => s.name === "bad-yaml-skill")

      // then
      expect(skill).toBeDefined()
      expect(skill?.mcpConfig).toBeUndefined()
    })
  })

  describe("mcp.json file loading (AmpCode compat)", () => {
    it("loads MCP config from mcp.json with mcpServers format", async () => {
      // given
      const skillContent = `---
name: ampcode-skill
description: Skill with mcp.json
---
Skill body.
`
      const mcpJson = {
        mcpServers: {
          playwright: {
            command: "npx",
            args: ["@playwright/mcp@latest"],
          },
        },
      }
      createProjectOpencodeSkill("ampcode-skill", skillContent, mcpJson)

      // when
      const skills = await discoverSkills({ includeClaudeCodePaths: false, ...context })
      const skill = skills.find((s) => s.name === "ampcode-skill")

      // then
      expect(skill).toBeDefined()
      expect(skill?.mcpConfig).toBeDefined()
      expect(skill?.mcpConfig?.playwright).toBeDefined()
      expect(skill?.mcpConfig?.playwright?.command).toBe("npx")
      expect(skill?.mcpConfig?.playwright?.args).toEqual(["@playwright/mcp@latest"])
    })

    it("mcp.json takes priority over YAML frontmatter", async () => {
      // given
      const skillContent = `---
name: priority-skill
mcp:
  from-yaml:
    command: yaml-cmd
    args: [yaml-arg]
---
Skill body.
`
      const mcpJson = {
        mcpServers: {
          "from-json": {
            command: "json-cmd",
            args: ["json-arg"],
          },
        },
      }
      createProjectOpencodeSkill("priority-skill", skillContent, mcpJson)

      // when
      const skills = await discoverSkills({ includeClaudeCodePaths: false, ...context })
      const skill = skills.find((s) => s.name === "priority-skill")

      // then
      expect(skill?.mcpConfig?.["from-json"]).toBeDefined()
      expect(skill?.mcpConfig?.["from-yaml"]).toBeUndefined()
    })

    it("supports direct format without mcpServers wrapper", async () => {
      // given
      const skillContent = `---
name: direct-format
---
Skill body.
`
      const mcpJson = {
        sqlite: {
          command: "uvx",
          args: ["mcp-server-sqlite"],
        },
      }
      createProjectOpencodeSkill("direct-format", skillContent, mcpJson)

      // when
      const skills = await discoverSkills({ includeClaudeCodePaths: false, ...context })
      const skill = skills.find((s) => s.name === "direct-format")

      // then
      expect(skill?.mcpConfig?.sqlite).toBeDefined()
      expect(skill?.mcpConfig?.sqlite?.command).toBe("uvx")
    })
  })

  describe("allowed-tools parsing", () => {
    it("parses space-separated allowed-tools string", async () => {
      // given
      const skillContent = `---
name: space-separated-tools
description: Skill with space-separated allowed-tools
allowed-tools: Read Write Edit Bash
---
Skill body.
`
      createProjectOpencodeSkill("space-separated-tools", skillContent)

      // when
      const skills = await discoverSkills({ includeClaudeCodePaths: false, ...context })
      const skill = skills.find((s) => s.name === "space-separated-tools")

      // then
      expect(skill).toBeDefined()
      expect(skill?.allowedTools).toEqual(["Read", "Write", "Edit", "Bash"])
    })

    it("parses YAML inline array allowed-tools", async () => {
      // given
      const skillContent = `---
name: yaml-inline-array
description: Skill with YAML inline array allowed-tools
allowed-tools: [Read, Write, Edit, Bash]
---
Skill body.
`
      createProjectOpencodeSkill("yaml-inline-array", skillContent)

      // when
      const skills = await discoverSkills({ includeClaudeCodePaths: false, ...context })
      const skill = skills.find((s) => s.name === "yaml-inline-array")

      // then
      expect(skill).toBeDefined()
      expect(skill?.allowedTools).toEqual(["Read", "Write", "Edit", "Bash"])
    })

    it("parses YAML multi-line array allowed-tools", async () => {
      // given
      const skillContent = `---
name: yaml-multiline-array
description: Skill with YAML multi-line array allowed-tools
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
---
Skill body.
`
      createProjectOpencodeSkill("yaml-multiline-array", skillContent)

      // when
      const skills = await discoverSkills({ includeClaudeCodePaths: false, ...context })
      const skill = skills.find((s) => s.name === "yaml-multiline-array")

      // then
      expect(skill).toBeDefined()
      expect(skill?.allowedTools).toEqual(["Read", "Write", "Edit", "Bash"])
    })

    it("returns undefined for skill without allowed-tools", async () => {
      // given
      const skillContent = `---
name: no-allowed-tools
description: Skill without allowed-tools field
---
Skill body.
`
      createProjectOpencodeSkill("no-allowed-tools", skillContent)

      // when
      const skills = await discoverSkills({ includeClaudeCodePaths: false, ...context })
      const skill = skills.find((s) => s.name === "no-allowed-tools")

      // then
      expect(skill).toBeDefined()
      expect(skill?.allowedTools).toBeUndefined()
    })
  })

  describe(".agents skills compatibility", () => {
    it("discovers project skills from both .claude/skills and .agents/skills", async () => {
      // given
      createSkill(
        getProjectClaudeSkillsDir(),
        "claude-project-skill",
        `---
name: claude-project-skill
description: Skill from .claude
---
Claude skill.
`
      )
      createSkill(
        getProjectAgentsSkillsDir(),
        "agents-project-skill",
        `---
name: agents-project-skill
description: Skill from .agents
---
Agents skill.
`
      )

      // when
      const skills = await discoverProjectClaudeSkills(context)

      // then
      expect(skills.find((s) => s.name === "claude-project-skill")).toBeDefined()
      expect(skills.find((s) => s.name === "agents-project-skill")).toBeDefined()
    })

    it("prefers .agents project skill when name collides with .claude project skill", async () => {
      // given
      createSkill(
        getProjectClaudeSkillsDir(),
        "shared-project-skill",
        `---
name: shared-project-skill
description: Shared skill from .claude
---
Claude project body.
`
      )
      createSkill(
        getProjectAgentsSkillsDir(),
        "shared-project-skill",
        `---
name: shared-project-skill
description: Shared skill from .agents
---
Agents project body.
`
      )

      // when
      const skills = await discoverProjectClaudeSkills(context)
      const duplicates = skills.filter((s) => s.name === "shared-project-skill")

      // then
      expect(duplicates).toHaveLength(1)
      expect(duplicates[0]?.definition.description).toContain(".agents")
    })
  })

  describe("deduplication", () => {
    it("deduplicates skills by name across scopes, keeping higher priority (opencode-project > opencode > project > user)", async () => {
      // given
      createSkill(
        getOpencodeProjectSkillsDir(),
        "duplicate-skill",
        `---
name: duplicate-skill
description: From opencode-project (highest priority)
---
opencode-project body.
`
      )
      createSkill(
        getOpencodeGlobalSkillsDir(),
        "duplicate-skill",
        `---
name: duplicate-skill
description: From opencode-global (middle priority)
---
opencode-global body.
`
      )
      createSkill(
        getProjectClaudeSkillsDir(),
        "duplicate-skill",
        `---
name: duplicate-skill
description: From claude project (lower priority)
---
claude project body.
`
      )
      createSkill(
        getUserClaudeSkillsDir(),
        "duplicate-skill",
        `---
name: duplicate-skill
description: From claude user (lowest priority)
---
claude user body.
`
      )
      createSkill(
        getUserAgentsSkillsDir(),
        "duplicate-skill",
        `---
name: duplicate-skill
description: From agents user (lower priority)
---
agents user body.
`
      )

      // when
      const skills = await discoverSkills(context)
      const duplicates = skills.filter((s) => s.name === "duplicate-skill")

      // then
      expect(duplicates).toHaveLength(1)
      expect(duplicates[0]?.scope).toBe("opencode-project")
      expect(duplicates[0]?.definition.description).toContain("opencode-project")
    })
  })

  describe("nested skills", () => {
    it("loads nested skills with prefixed names", async () => {
      // given
      const nestedSkillDir = join(getOpencodeProjectSkillsDir(), "superpowers", "brainstorming")
      mkdirSync(nestedSkillDir, { recursive: true })
      writeFileSync(
        join(nestedSkillDir, "SKILL.md"),
        `---
name: brainstorming
description: Nested brainstorming skill
---
Nested skill body.
`
      )

      // when
      const skills = await discoverSkills({ includeClaudeCodePaths: false, ...context })
      const nested = skills.find((s) => s.name === "superpowers/brainstorming")

      // then
      expect(nested).toBeDefined()
      expect(nested?.scope).toBe("opencode-project")
      expect(nested?.definition.description).toContain("Nested brainstorming skill")
    })
  })
})
