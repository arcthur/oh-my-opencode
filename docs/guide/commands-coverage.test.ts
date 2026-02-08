import { describe, expect, it } from "bun:test"
import { readFileSync } from "fs"
import { resolve } from "path"
import { BuiltinCommandNameSchema } from "../../src/config/schema"

describe("docs/guide command coverage", () => {
  it("documents all built-in slash commands", () => {
    // #given built-in command names from schema
    const commandNames = [...BuiltinCommandNameSchema.options]
    const markdownPath = resolve(import.meta.dirname, "features.md")
    const markdown = readFileSync(markdownPath, "utf-8")

    // #when checking for /<command> mentions
    const missing = commandNames.filter((name) => !markdown.includes(`/${name}`))

    // #then every built-in command should be documented at least once
    expect(missing, `Missing built-in commands in docs/guide/features.md: ${missing.join(", ")}`).toEqual([])
  })
})

