import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import { existsSync, mkdirSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import type { OhMyOpenCodeConfig } from "../../config/schema"
import { listTaskIds, readTask } from "./task-pool/pool"
import { parsePrometheusPlanTodos, syncPlanTodosToTaskPool } from "./plan-sync"

describe("sisyphus-swarm/plan-sync", () => {
  let testDir: string
  let config: Partial<OhMyOpenCodeConfig>

  beforeEach(() => {
    testDir = join(tmpdir(), `swarm-plan-sync-test-${Date.now()}`)
    mkdirSync(testDir, { recursive: true })
    config = {
      sisyphus: {
        tasks: {
          enabled: true,
          storage_path: testDir,
          claude_code_compat: false,
        },
      },
    }
  })

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true })
    }
  })

  test("parsePrometheusPlanTodos extracts todo blocks and context packs", () => {
    // #given
    const markdown = `# Demo

## TODOs

- [ ] 1. Setup repo

  **What to do**:
  - Do A

  **Context Packs (REQUIRED)**:
  - Context Packs: global, tooling

- [x] 2. Ship it

  **Context Packs (REQUIRED)**:
  - Context Packs: global
`

    // #when
    const todos = parsePrometheusPlanTodos(markdown)

    // #then
    expect(todos).toHaveLength(2)
    expect(todos[0]?.todoNumber).toBe(1)
    expect(todos[0]?.title).toBe("Setup repo")
    expect(todos[0]?.isComplete).toBe(false)
    expect(todos[0]?.contextPackIds).toEqual(["global", "tooling"])

    expect(todos[1]?.todoNumber).toBe(2)
    expect(todos[1]?.title).toBe("Ship it")
    expect(todos[1]?.isComplete).toBe(true)
    expect(todos[1]?.contextPackIds).toEqual(["global"])
  })

  test("syncPlanTodosToTaskPool creates one task per pending todo (idempotent)", () => {
    // #given
    const planId = "demo-plan"
    const listId = planId
    const planMarkdown = `# Demo

## TODOs

- [ ] 1. Setup repo

  **Context Packs (REQUIRED)**:
  - Context Packs: global, tooling

- [x] 2. Already done
`

    const manifestMarkdown = `
[CONTEXT_MANIFEST]
{
  "schemaVersion": 2,
  "planId": "demo-plan",
  "generatedAt": "2026-02-05T00:00:00Z",
  "packs": [
    {
      "id": "global",
      "title": "Global guardrails",
      "items": [
        { "kind": "doc", "ref": "docs/guide/orchestration.md", "why": "Execution workflow + SSOT" }
      ]
    },
    {
      "id": "tooling",
      "title": "Tooling conventions",
      "items": [
        { "kind": "code", "ref": "src/tools/delegate-task/tools.ts", "why": "Delegation interface" }
      ]
    }
  ]
}
[/CONTEXT_MANIFEST]
`.trim()

    // #when - first sync
    const first = syncPlanTodosToTaskPool({
      config,
      listId,
      planId,
      planMarkdown,
      manifestMarkdown,
    })

    // #then
    expect(first.created).toHaveLength(1)
    const taskIds1 = listTaskIds(listId, config)
    expect(taskIds1).toHaveLength(1)

    const createdTask = readTask(listId, taskIds1[0]!, config)
    expect(createdTask?.metadata?.planTaskKey).toBe("demo-plan#1")
    expect(createdTask?.description).toContain("## CONTEXT PACKS (auto-injected)")
    expect(createdTask?.description).toContain("### pack: global")
    expect(createdTask?.description).toContain("### pack: tooling")

    // #when - second sync (idempotent)
    const second = syncPlanTodosToTaskPool({
      config,
      listId,
      planId,
      planMarkdown,
      manifestMarkdown,
    })

    // #then
    expect(second.created).toHaveLength(0)
    const taskIds2 = listTaskIds(listId, config)
    expect(taskIds2).toHaveLength(1)
  })
})
