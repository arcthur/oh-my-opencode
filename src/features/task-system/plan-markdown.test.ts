import { describe, expect, test } from "bun:test"
import { parsePlanTasksFromMarkdown } from "./plan-markdown"

describe("task-system/plan-markdown", () => {
  test("parses tasks with block metadata", () => {
    // #given
    const markdown = `# Plan: demo

## Tasks

- 1. Setup repo
  Context Packs: global, tooling

- 2. Implement feature
  Depends On: 1
  Context Packs:
  - global

## Notes
text
`

    // #when
    const tasks = parsePlanTasksFromMarkdown(markdown)

    // #then
    expect(tasks).toHaveLength(2)
    expect(tasks[0]?.task_number).toBe(1)
    expect(tasks[0]?.title).toBe("Setup repo")
    expect(tasks[0]?.depends_on_task_numbers).toEqual([])
    expect(tasks[0]?.context_pack_ids).toEqual(["global", "tooling"])
    expect(tasks[1]?.task_number).toBe(2)
    expect(tasks[1]?.title).toBe("Implement feature")
    expect(tasks[1]?.depends_on_task_numbers).toEqual([1])
    expect(tasks[1]?.context_pack_ids).toEqual(["global"])
  })

  test("returns empty when tasks section is absent", () => {
    // #given
    const markdown = `# Plan: demo

## Notes
- 1. Not a task section
`

    // #when / #then
    expect(parsePlanTasksFromMarkdown(markdown)).toEqual([])
  })
})

