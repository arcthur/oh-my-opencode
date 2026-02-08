import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import type { OhMyOpenCodeConfig } from "../../config/schema"
import { createTaskGraphTools } from "./index"

describe("task-graph tools", () => {
  let workspace: string
  let config: Partial<OhMyOpenCodeConfig>

  beforeEach(() => {
    workspace = join(tmpdir(), `task-graph-tools-${Date.now()}`)
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

  test("task_create creates a session task and task_get returns summary", async () => {
    // #given
    const tools = createTaskGraphTools(config)

    // #when
    const createdRaw = await tools.task_create.execute(
      {
        title: "Implement task graph",
      },
      {
        sessionID: "ses_tool_1",
      }
    )
    const created = JSON.parse(createdRaw)

    const fetchedRaw = await tools.task_get.execute(
      {
        id: created.task.id,
      },
      {
        sessionID: "ses_tool_1",
      }
    )
    const fetched = JSON.parse(fetchedRaw)

    // #then
    expect(created.task.state).toBe("open")
    expect(fetched.task.id).toBe(created.task.id)
    expect(fetched.task.container_id).toBe("ses_tool_1")
  })

  test("task_update requires revision and increments revision", async () => {
    // #given
    const tools = createTaskGraphTools(config)
    const createdRaw = await tools.task_create.execute(
      {
        title: "Initial title",
      },
      {
        sessionID: "ses_tool_2",
      }
    )
    const created = JSON.parse(createdRaw)

    // #when
    const updatedRaw = await tools.task_update.execute(
      {
        id: created.task.id,
        expected_revision: created.task.revision,
        title: "Updated title",
      },
      {
        sessionID: "ses_tool_2",
      }
    )
    const updated = JSON.parse(updatedRaw)

    // #then
    expect(updated.task.title).toBe("Updated title")
    expect(updated.task.revision).toBe(created.task.revision + 1)
  })

  test("task_transition enforces state transitions and task_list ready_only filtering", async () => {
    // #given
    const tools = createTaskGraphTools(config)
    const blockerRaw = await tools.task_create.execute(
      { title: "Blocker" },
      { sessionID: "ses_tool_3" }
    )
    const blocker = JSON.parse(blockerRaw)

    await tools.task_create.execute(
      {
        title: "Blocked",
        depends_on: [blocker.task.id],
      },
      { sessionID: "ses_tool_3" }
    )

    // #when
    const readyBeforeRaw = await tools.task_list.execute(
      {
        ready_only: true,
      },
      { sessionID: "ses_tool_3" }
    )
    const readyBefore = JSON.parse(readyBeforeRaw)

    const blockerInProgressRaw = await tools.task_transition.execute(
      {
        id: blocker.task.id,
        expected_revision: blocker.task.revision,
        next_state: "in_progress",
      },
      { sessionID: "ses_tool_3" }
    )
    const blockerInProgress = JSON.parse(blockerInProgressRaw)

    await tools.task_transition.execute(
      {
        id: blocker.task.id,
        expected_revision: blockerInProgress.task.revision,
        next_state: "completed",
      },
      { sessionID: "ses_tool_3" }
    )

    const readyAfterRaw = await tools.task_list.execute(
      {
        ready_only: true,
      },
      { sessionID: "ses_tool_3" }
    )
    const readyAfter = JSON.parse(readyAfterRaw)

    // #then
    expect(readyBefore.tasks).toHaveLength(1)
    expect(readyBefore.tasks[0].title).toBe("Blocker")
    expect(readyAfter.tasks.some((task: { title: string }) => task.title === "Blocked")).toBe(true)
  })

  test("task_create requires container_id for non-session scopes", async () => {
    // #given
    const tools = createTaskGraphTools(config)

    // #when
    const raw = await tools.task_create.execute(
      {
        title: "Plan task",
        scope: "plan",
      },
      {
        sessionID: "ses_tool_4",
      }
    )
    const parsed = JSON.parse(raw)

    // #then
    expect(parsed.error).toBe("TASK_INVALID_INPUT")
    expect(String(parsed.message ?? "")).toContain("container_id")
  })
})
