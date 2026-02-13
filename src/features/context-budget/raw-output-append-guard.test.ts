import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const GUARDED_FILES = [
  "src/hooks/anti-slop-enforcer.ts",
  "src/hooks/comment-checker/index.ts",
  "src/hooks/context-window-governor/actions/warn.ts",
  "src/hooks/delegation-failure-guidance/index.ts",
  "src/hooks/delegation-nudge-agent-usage/index.ts",
  "src/hooks/edit-failure-guidance/index.ts",
  "src/hooks/interactive-bash-session/index.ts",
  "src/hooks/runtime-tracker/index.ts",
  "src/hooks/task-resume-info/index.ts",
  "src/hooks/claude-code-hooks/index.ts",
  "src/hooks/runtime/assembly/tool-execute-after.ts",
  "src/hooks/work-orchestrator/execution.ts",
]

describe("budget guard for output appends", () => {
  test("guarded hooks do not append output via raw string concatenation", () => {
    // #given
    const root = join(import.meta.dir, "../../../")

    // #when
    const offenders = GUARDED_FILES.filter((relativePath) => {
      const source = readFileSync(join(root, relativePath), "utf-8")
      return /output\.output\s*\+=/.test(source) || /output\.output\s*=\s*\(?.*output\.output.*\+/.test(source)
    })

    // #then
    expect(offenders).toEqual([])
  })

  test("compaction context writers do not push context directly", () => {
    // #given
    const root = join(import.meta.dir, "../../../")
    const files = [
      "src/hooks/claude-code-hooks/index.ts",
      "src/hooks/context-window-governor/actions/compaction-context.ts",
    ]

    // #when
    const offenders = files.filter((relativePath) => {
      const source = readFileSync(join(root, relativePath), "utf-8")
      return /output\.context\.push\(/.test(source)
    })

    // #then
    expect(offenders).toEqual([])
  })

  test("work orchestrator does not inline unbudgeted delegate output rewrite template", () => {
    // #given
    const root = join(import.meta.dir, "../../../")
    const source = readFileSync(join(root, "src/hooks/work-orchestrator/execution.ts"), "utf-8")

    // #then
    expect(source.includes("output.output = `\n## SUBAGENT WORK COMPLETED")).toBe(false)
  })

  test("prompt injectors do not assign output.args.prompt directly in guarded files", () => {
    // #given
    const root = join(import.meta.dir, "../../../")
    const files = [
      "src/hooks/work-orchestrator/execution.ts",
      "src/hooks/prometheus-md-only/index.ts",
      "src/hooks/sisyphus-junior-notepad/index.ts",
    ]

    // #when
    const offenders = files.filter((relativePath) => {
      const source = readFileSync(join(root, relativePath), "utf-8")
      return /output\.args\.prompt\s*=/.test(source) || /output\.args\.prompt\s*\+=/.test(source)
    })

    // #then
    expect(offenders).toEqual([])
  })
})
