import { describe, it, expect } from "bun:test"
import { buildSkillFromContent } from "./skill-builder"

describe("buildSkillFromContent", () => {
  it("builds skill from valid content", async () => {
    const content = `---
name: my-skill
description: A test skill
model: sonnet
---
Skill body content.`

    const result = await buildSkillFromContent({
      content,
      skillPath: "/path/to/skill.md",
      resolvedPath: "/path/to",
      defaultName: "default-name",
      scope: "opencode",
    })

    expect(result).not.toBeNull()
    expect(result!.skill.name).toBe("my-skill")
    expect(result!.skill.definition.description).toBe("(opencode - Skill) A test skill")
    expect(result!.templateContent).toContain("Skill body content.")
  })

  it("uses defaultName when name not in frontmatter", async () => {
    const content = `---
description: A skill without name
---
Body.`

    const result = await buildSkillFromContent({
      content,
      skillPath: "/path/to/skill.md",
      resolvedPath: "/path/to",
      defaultName: "fallback-name",
      scope: "project",
    })

    expect(result).not.toBeNull()
    expect(result!.skill.name).toBe("fallback-name")
  })

  it("handles malformed YAML when strictParsing is false (default)", async () => {
    const content = `---
name: bad-yaml
mcp: [invalid yaml
---
Body.`

    const result = await buildSkillFromContent({
      content,
      skillPath: "/path/to/skill.md",
      resolvedPath: "/path/to",
      defaultName: "fallback-name",
      scope: "user",
    })

    expect(result).not.toBeNull()
    expect(result!.skill.name).toBe("fallback-name")
  })

  it("returns null for malformed YAML when strictParsing is true", async () => {
    const content = `---
name: bad-yaml
mcp: [invalid yaml
---
Body.`

    const result = await buildSkillFromContent({
      content,
      skillPath: "/path/to/skill.md",
      resolvedPath: "/path/to",
      defaultName: "fallback-name",
      scope: "user",
      strictParsing: true,
    })

    expect(result).toBeNull()
  })

  it("applies correct model source for opencode scope", async () => {
    const content = `---
name: test
model: sonnet
---
Body.`

    const result = await buildSkillFromContent({
      content,
      skillPath: "/path/to/skill.md",
      resolvedPath: "/path/to",
      defaultName: "test",
      scope: "opencode",
    })

    expect(result).not.toBeNull()
    expect(result!.skill.definition.model).toBe("sonnet")
  })

  it("applies correct model source for opencode-project scope", async () => {
    const content = `---
name: test
model: opus
---
Body.`

    const result = await buildSkillFromContent({
      content,
      skillPath: "/path/to/skill.md",
      resolvedPath: "/path/to",
      defaultName: "test",
      scope: "opencode-project",
    })

    expect(result).not.toBeNull()
    expect(result!.skill.definition.model).toBe("opus")
  })

  it("parses allowed-tools field", async () => {
    const content = `---
name: test
allowed-tools: Read Edit Bash
---
Body.`

    const result = await buildSkillFromContent({
      content,
      skillPath: "/path/to/skill.md",
      resolvedPath: "/path/to",
      defaultName: "test",
      scope: "user",
    })

    expect(result).not.toBeNull()
    expect(result!.skill.allowedTools).toEqual(["Read", "Edit", "Bash"])
  })
})
