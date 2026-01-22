import { describe, test, expect } from "bun:test"
import { createSilentToolOutputHook } from "./index"

describe("silent-tool-output hook", () => {
  test("replaces Write output with metadata for non-planning files", async () => {
    // #given
    const hook = createSilentToolOutputHook({} as never, { silent_write: true })
    const output = { title: "Write", output: "Successfully wrote:\nhello\nworld", metadata: {} }

    // #when
    await hook["tool.execute.before"]?.(
      { tool: "Write", sessionID: "s1", callID: "c1" },
      { args: { path: "src/file.ts", content: "export {}" } }
    )
    await hook["tool.execute.after"]?.({ tool: "Write", sessionID: "s1", callID: "c1" }, output)

    // #then
    expect(output.output.startsWith("✓ src/file.ts written")).toBe(true)
    expect(output.output).toContain("bytes")
    expect(output.output).toContain("lines")
  })

  test("uses minimal output for planning file writes", async () => {
    // #given
    const hook = createSilentToolOutputHook({} as never, { silent_write: true })
    const output = { title: "Write", output: "ok", metadata: {} }

    // #when
    await hook["tool.execute.before"]?.(
      { tool: "Write", sessionID: "s2", callID: "c2" },
      { args: { path: "task_plan.md", content: "# Plan" } }
    )
    await hook["tool.execute.after"]?.({ tool: "Write", sessionID: "s2", callID: "c2" }, output)

    // #then
    expect(output.output).toBe("✓ task_plan.md updated")
  })

  test("optimizes Read output for planning files", async () => {
    // #given
    const hook = createSilentToolOutputHook({} as never, { optimize_planning_reads: true })
    const output = { title: "Read", output: "# Task Plan", metadata: {} }

    // #when
    await hook["tool.execute.before"]?.(
      { tool: "Read", sessionID: "s3", callID: "c3" },
      { args: { path: "task_plan.md" } }
    )
    await hook["tool.execute.after"]?.({ tool: "Read", sessionID: "s3", callID: "c3" }, output)

    // #then
    expect(output.output).toContain("task_plan.md loaded")
    expect(output.output).toContain("<task-plan-context>")
  })

  test("optimizes Read output for findings without task-plan-context hint", async () => {
    // #given
    const hook = createSilentToolOutputHook({} as never, { optimize_planning_reads: true })
    const output = { title: "Read", output: "# Findings", metadata: {} }

    // #when
    await hook["tool.execute.before"]?.(
      { tool: "Read", sessionID: "s3b", callID: "c3b" },
      { args: { path: "findings.md" } }
    )
    await hook["tool.execute.after"]?.({ tool: "Read", sessionID: "s3b", callID: "c3b" }, output)

    // #then
    expect(output.output).toContain("findings.md loaded")
    expect(output.output).not.toContain("<task-plan-context>")
  })

  test("does not optimize Read output for non-planning files", async () => {
    // #given
    const hook = createSilentToolOutputHook({} as never, { optimize_planning_reads: true })
    const output = { title: "Read", output: "original", metadata: {} }

    // #when
    await hook["tool.execute.before"]?.(
      { tool: "Read", sessionID: "s4", callID: "c4" },
      { args: { path: "src/file.ts" } }
    )
    await hook["tool.execute.after"]?.({ tool: "Read", sessionID: "s4", callID: "c4" }, output)

    // #then
    expect(output.output).toBe("original")
  })

  test("truncates long search outputs", async () => {
    // #given
    const hook = createSilentToolOutputHook({} as never, { optimize_search: true, search_max_lines: 20 })
    const output = {
      title: "Grep",
      output: Array.from({ length: 25 }, (_, i) => `line ${i}`).join("\n"),
      metadata: {},
    }

    // #when
    await hook["tool.execute.before"]?.(
      { tool: "Grep", sessionID: "s5", callID: "c5" },
      { args: { pattern: "x", path: "src" } }
    )
    await hook["tool.execute.after"]?.({ tool: "Grep", sessionID: "s5", callID: "c5" }, output)

    // #then
    expect(output.output).toContain("line 19")
    expect(output.output).not.toContain("line 20")
    expect(output.output).toContain("... and 5 more results")
  })
})

