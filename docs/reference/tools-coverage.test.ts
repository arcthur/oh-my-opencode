import { describe, expect, it } from "bun:test"
import { readFileSync } from "fs"
import { resolve } from "path"
import { builtinTools } from "../../src/tools"

describe("docs/reference tools coverage", () => {
  it("documents the full plugin tool registry surface", () => {
    // #given tool names registered by this plugin
    const toolNames = [
      ...Object.keys(builtinTools),
      "background_output",
      "background_cancel",
      "task_create",
      "task_get",
      "task_list",
      "task_update",
      "task_transition",
      "look_at",
      "delegate_task",
      "swarm",
      "skill",
      "skill_mcp",
      "slashcommand",
      "interactive_bash",
    ]

    const markdownPath = resolve(import.meta.dirname, "tools.md")
    const markdown = readFileSync(markdownPath, "utf-8")

    // #when checking for tool name mentions
    const missing = toolNames.filter((name) => !markdown.includes(name))

    // #then every tool should be documented at least once
    expect(missing, `Missing tools in docs/reference/tools.md: ${missing.join(", ")}`).toEqual([])
  })
})
