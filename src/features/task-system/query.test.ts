import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import type { OhMyOpenCodeConfig } from "../../config/schema"
import { createTaskNode, transitionTaskNode } from "./service"
import { countIncompleteTasks, hasIncompleteTasks, listReadyTasks } from "./query"

describe("task-system/query", () => {
  let workspace: string
  let config: Partial<OhMyOpenCodeConfig>

  beforeEach(() => {
    workspace = join(tmpdir(), `task-system-query-${Date.now()}`)
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

  test("listReadyTasks excludes blocked tasks", () => {
    // #given
    const blocker = createTaskNode(
      {
        scope: "session",
        container_id: "ses_q1",
        title: "Blocker",
      },
      config
    )

    createTaskNode(
      {
        scope: "session",
        container_id: "ses_q1",
        title: "Blocked",
        depends_on: [blocker.id],
      },
      config
    )

    // #when
    const ready = listReadyTasks({ scope: "session", container_id: "ses_q1" }, config)

    // #then
    expect(ready.map((task) => task.title)).toEqual(["Blocker"])
  })

  test("countIncompleteTasks becomes zero after completion", () => {
    // #given
    const task = createTaskNode(
      {
        scope: "session",
        container_id: "ses_q2",
        title: "Do work",
      },
      config
    )

    // #when
    const before = countIncompleteTasks({ scope: "session", container_id: "ses_q2" }, config)
    const inProgress = transitionTaskNode(
      {
        scope: "session",
        container_id: "ses_q2",
        id: task.id,
        expected_revision: 1,
        next_state: "in_progress",
      },
      config
    )
    transitionTaskNode(
      {
        scope: "session",
        container_id: "ses_q2",
        id: task.id,
        expected_revision: inProgress.revision,
        next_state: "completed",
      },
      config
    )
    const after = countIncompleteTasks({ scope: "session", container_id: "ses_q2" }, config)

    // #then
    expect(before).toBe(1)
    expect(after).toBe(0)
    expect(hasIncompleteTasks({ scope: "session", container_id: "ses_q2" }, config)).toBe(false)
  })
})
