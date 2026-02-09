import { describe, it, expect } from "bun:test"
import { wrapCommandTemplate, wrapSkillTemplate } from "./template-wrapper"

describe("wrapCommandTemplate", () => {
  it("wraps body in command-instruction tags", () => {
    const body = "Do something useful"
    const result = wrapCommandTemplate(body)

    expect(result).toContain("<command-instruction>")
    expect(result).toContain("</command-instruction>")
    expect(result).toContain("Do something useful")
  })

  it("includes user-request section with $ARGUMENTS placeholder", () => {
    const result = wrapCommandTemplate("test")

    expect(result).toContain("<user-request>")
    expect(result).toContain("$ARGUMENTS")
    expect(result).toContain("</user-request>")
  })

  it("trims body content", () => {
    const body = "  \n  Content with whitespace  \n  "
    const result = wrapCommandTemplate(body)

    expect(result).toContain("Content with whitespace")
    expect(result).not.toContain("  \n  Content")
  })

  it("produces correct structure", () => {
    const result = wrapCommandTemplate("My command")

    expect(result).toBe(`<command-instruction>
My command
</command-instruction>

<user-request>
$ARGUMENTS
</user-request>`)
  })
})

describe("wrapSkillTemplate", () => {
  it("wraps body in skill-instruction tags", () => {
    const body = "Do something skillful"
    const result = wrapSkillTemplate(body, "/path/to/skill")

    expect(result).toContain("<skill-instruction>")
    expect(result).toContain("</skill-instruction>")
    expect(result).toContain("Do something skillful")
  })

  it("includes base directory information", () => {
    const result = wrapSkillTemplate("test", "/home/user/skills/my-skill")

    expect(result).toContain("Base directory for this skill: /home/user/skills/my-skill/")
    expect(result).toContain("File references (@path) in this skill are relative to this directory.")
  })

  it("includes user-request section with $ARGUMENTS placeholder", () => {
    const result = wrapSkillTemplate("test", "/path")

    expect(result).toContain("<user-request>")
    expect(result).toContain("$ARGUMENTS")
    expect(result).toContain("</user-request>")
  })

  it("trims body content", () => {
    const body = "  \n  Skill content  \n  "
    const result = wrapSkillTemplate(body, "/path")

    expect(result).toContain("Skill content")
  })

  it("produces correct structure", () => {
    const result = wrapSkillTemplate("My skill", "/skills/test")

    expect(result).toBe(`<skill-instruction>
Base directory for this skill: /skills/test/
File references (@path) in this skill are relative to this directory.

My skill
</skill-instruction>

<user-request>
$ARGUMENTS
</user-request>`)
  })

  it("resolves @path references to absolute paths", () => {
    const result = wrapSkillTemplate("Use @scripts/run.ts and @data/config.json", "/skills/test")

    expect(result).toContain("Use /skills/test/scripts/run.ts and /skills/test/data/config.json")
  })
})
