import { describe, expect, it } from "bun:test"
import { readFileSync } from "fs"
import { resolve } from "path"
import { BuiltinCategoryNameSchema } from "../../../src/config/schema"

describe("docs/guide category coverage", () => {
  it("documents all built-in category names", () => {
    // #given built-in categories from schema
    const repoRoot = resolve(import.meta.dirname, "../../..")
    const categoryNames = [...BuiltinCategoryNameSchema.options]
    const markdownPath = resolve(repoRoot, "docs/guide/category-and-skills.md")
    const markdown = readFileSync(markdownPath, "utf-8")

    // #when checking for category name mentions
    const missing = categoryNames.filter((name) => !markdown.includes(`\`${name}\``))

    // #then every built-in category should be documented at least once
    expect(missing, `Missing built-in categories in docs/guide/category-and-skills.md: ${missing.join(", ")}`).toEqual([])
  })
})
