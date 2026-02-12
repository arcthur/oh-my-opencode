import { describe, expect, it } from "bun:test"
import { readFileSync } from "fs"
import { resolve } from "path"
import { BuiltinAgentNameSchema } from "../../../src/config/schema"

describe("docs/reference agents coverage", () => {
  it("documents all built-in agent names", () => {
    // #given built-in agent names from schema
    const repoRoot = resolve(import.meta.dirname, "../../..")
    const agentNames = [...BuiltinAgentNameSchema.options]
    const markdownPath = resolve(repoRoot, "docs/reference/agents.md")
    const markdown = readFileSync(markdownPath, "utf-8")

    // #when checking for agent name mentions
    const missing = agentNames.filter((name) => !markdown.includes(`\`${name}\``))

    // #then every built-in agent should be documented at least once
    expect(missing, `Missing built-in agents in docs/reference/agents.md: ${missing.join(", ")}`).toEqual([])
  })
})
