import { describe, expect, it } from "bun:test"
import { readFileSync } from "fs"
import { resolve } from "path"
import { HookNameSchema } from "../../../src/config/schema"

describe("docs/reference hooks coverage", () => {
  it("documents all hook names surfaced by HookNameSchema", () => {
    // #given hook names from schema
    const repoRoot = resolve(import.meta.dirname, "../../..")
    const hookNames = [...HookNameSchema.options]
    const markdownPath = resolve(repoRoot, "docs/reference/hooks.md")
    const markdown = readFileSync(markdownPath, "utf-8")

    // #when checking for hook name mentions
    const missing = hookNames.filter((name) => !markdown.includes(name))

    // #then every hook name should be documented at least once
    expect(missing, `Missing hook names in docs/reference/hooks.md: ${missing.join(", ")}`).toEqual([])
  })
})
