import { describe, expect, it } from "bun:test"
import { readFileSync } from "fs"
import { resolve } from "path"
import { BuiltinSkillNameSchema } from "../../src/config/schema"

describe("docs/guide features coverage", () => {
  it("mentions all built-in skills", () => {
    // #given built-in skill names from schema
    const skillNames = [...BuiltinSkillNameSchema.options]
    const markdownPath = resolve(import.meta.dirname, "features.md")
    const markdown = readFileSync(markdownPath, "utf-8")

    // #when checking for skill name mentions
    const missing = skillNames.filter((name) => {
      return !markdown.includes(`**${name}**`) && !markdown.includes(`\`${name}\``)
    })

    // #then every built-in skill should be documented at least once
    expect(missing, `Missing built-in skills in docs/guide/features.md: ${missing.join(", ")}`).toEqual([])
  })
})

