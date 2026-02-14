import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import {
  getTaskGraphDir,
  listTaskNodeIds,
  readTaskNode,
  withTaskGraphLock,
  writeTaskNode,
} from "../../../src/features/task-system/storage"
import type { TaskNode } from "../../../src/features/task-system/domain"
import type { OhMyOpenCodeConfig } from "../../../src/config/schema"

describe("task-system/storage", () => {
  let workspace: string
  let config: Partial<OhMyOpenCodeConfig>

  beforeEach(() => {
    workspace = join(tmpdir(), `task-system-storage-${Date.now()}`)
    mkdirSync(workspace, { recursive: true })
    config = {
      orchestrator: {
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

  test("writes and reads task nodes", () => {
    // #given
    const task: TaskNode = {
      id: "task_1",
      title: "Task 1",
      description: "desc",
      state: "open",
      scope: "session",
      container_id: "ses_1",
      priority: 1,
      depends_on: [],
      revision: 1,
      created_at: Date.now(),
      updated_at: Date.now(),
    }

    // #when
    writeTaskNode(task, config)
    const loaded = readTaskNode("session", "ses_1", "task_1", config)

    // #then
    expect(loaded?.id).toBe(task.id)
    expect(loaded?.title).toBe(task.title)
  })

  test("lists task ids in container", () => {
    // #given
    for (const id of ["task_a", "task_b"]) {
      writeTaskNode(
        {
          id,
          title: id,
          description: "",
          state: "open",
          scope: "session",
          container_id: "ses_2",
          priority: 0,
          depends_on: [],
          revision: 1,
          created_at: Date.now(),
          updated_at: Date.now(),
        },
        config
      )
    }

    // #when
    const ids = listTaskNodeIds("session", "ses_2", config)

    // #then
    expect(ids).toEqual(["task_a", "task_b"])
  })

  test("acquires graph lock for critical section", () => {
    // #given
    const graphDir = getTaskGraphDir("session", "ses_3", config)
    let counter = 0

    // #when
    withTaskGraphLock("session", "ses_3", config, () => {
      counter += 1
    })

    // #then
    expect(counter).toBe(1)
    expect(existsSync(graphDir)).toBe(true)
  })
})
