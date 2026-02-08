import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import type { OhMyOpenCodeConfig } from "../../config/schema"
import { readAllTaskNodes } from "./storage"
import { syncPlanTasksToTaskGraph } from "./plan-sync"

describe("task-system/plan-sync", () => {
  let workspace: string
  let config: Partial<OhMyOpenCodeConfig>

  beforeEach(() => {
    workspace = join(tmpdir(), `task-system-plan-sync-${Date.now()}-${Math.random().toString(16).slice(2)}`)
    mkdirSync(workspace, { recursive: true })
    config = {
      sisyphus: {
        tasks: {
          enabled: true,
          storage_path: workspace,
        },
      },
    }
  })

  afterEach(() => {
    if (existsSync(workspace)) {
      rmSync(workspace, { recursive: true, force: true })
    }
  })

  test("creates one task per plan task and sets dependencies", () => {
    // #given
    const planId = "demo"
    const markdown = `# Plan: demo

## Tasks

- 1. Setup repo
- 2. Implement feature
  Depends On: 1
`

    // #when
    const first = syncPlanTasksToTaskGraph({
      config,
      scope: "plan",
      container_id: planId,
      planId,
      planMarkdown: markdown,
    })

    // #then
    expect(first.created).toHaveLength(2)
    expect(first.skipped).toHaveLength(0)

    const nodes = readAllTaskNodes("plan", planId, config)
    const byKey = new Map<string, (typeof nodes)[number]>()
    for (const node of nodes) {
      const key = node.metadata?.planTaskKey
      if (typeof key === "string") byKey.set(key, node)
    }

    const task1 = byKey.get(`${planId}#1`)
    const task2 = byKey.get(`${planId}#2`)
    expect(task1).toBeTruthy()
    expect(task2).toBeTruthy()
    expect(task2?.depends_on).toEqual([task1!.id])
  })

  test("is idempotent (skips already imported tasks)", () => {
    // #given
    const planId = "demo"
    const markdown = `# Plan: demo

## Tasks

- 1. Setup repo
- 2. Implement feature
`
    syncPlanTasksToTaskGraph({
      config,
      scope: "plan",
      container_id: planId,
      planId,
      planMarkdown: markdown,
    })

    // #when
    const second = syncPlanTasksToTaskGraph({
      config,
      scope: "plan",
      container_id: planId,
      planId,
      planMarkdown: markdown,
    })

    // #then
    expect(second.created).toEqual([])
    expect(second.skipped).toHaveLength(2)
    expect(second.skipped.map((s) => s.reason)).toEqual(["already_exists", "already_exists"])
  })
})

