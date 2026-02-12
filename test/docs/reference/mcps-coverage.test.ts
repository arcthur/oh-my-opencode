import { describe, expect, it } from "bun:test"
import { readFileSync } from "fs"
import { resolve } from "path"
import { McpNameSchema } from "../../../src/mcp/types"

describe("docs/reference MCP coverage", () => {
  it("documents all built-in MCP names", () => {
    // #given built-in MCP names from schema
    const repoRoot = resolve(import.meta.dirname, "../../..")
    const mcpNames = [...McpNameSchema.options]
    const markdownPath = resolve(repoRoot, "docs/reference/mcps.md")
    const markdown = readFileSync(markdownPath, "utf-8")

    // #when checking for MCP name mentions
    const missing = mcpNames.filter((name) => !markdown.includes(`\`${name}\``) && !markdown.includes(name))

    // #then every built-in MCP should be documented at least once
    expect(missing, `Missing built-in MCPs in docs/reference/mcps.md: ${missing.join(", ")}`).toEqual([])
  })
})
