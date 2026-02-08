import { describe, expect, it } from "bun:test"
import { readFileSync } from "fs"
import { resolve } from "path"
import { BuiltinSkillNameSchema } from "../../src/config/schema"

describe("docs/reference skills coverage", () => {
  it("documents all built-in skill names", () => {
    // #given built-in skill names from schema
    const skillNames = [...BuiltinSkillNameSchema.options]
    const markdownPath = resolve(import.meta.dirname, "skills.md")
    const markdown = readFileSync(markdownPath, "utf-8")

    // #when checking for built-in skill mentions
    const missing = skillNames.filter((name) => !markdown.includes(`\`${name}\``))

    // #then every built-in skill should be documented at least once
    expect(missing, `Missing built-in skills in docs/reference/skills.md: ${missing.join(", ")}`).toEqual([])
  })
})

