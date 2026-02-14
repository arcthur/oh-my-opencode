import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { OhMyOpenCodeConfig } from "../../../src/config/schema"
import { TASK_ERROR_CODES, TaskSystemError } from "../../../src/features/task-system/domain"
import {
  createTaskNode,
  listTaskNodes,
  transitionTaskNode,
  updateTaskNode,
} from "../../../src/features/task-system/service"

describe("task-system/service error contracts", () => {
  let workspace: string
  let config: Partial<OhMyOpenCodeConfig>

  beforeEach(() => {
    workspace = join(tmpdir(), `task-system-errors-${Date.now()}-${Math.random().toString(16).slice(2)}`)
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

  test("updateTaskNode returns revision_conflict for stale expected_revision", () => {
    // #given
    const task = createTaskNode(
      {
        scope: "session",
        container_id: "ses-revision",
        title: "Draft API contract",
      },
      config
    )
    const updated = updateTaskNode(
      {
        scope: "session",
        container_id: "ses-revision",
        id: task.id,
        expected_revision: 1,
        title: "Updated title",
      },
      config
    )
    expect(updated.revision).toBe(2)

    // #when / #then
    try {
      updateTaskNode(
        {
          scope: "session",
          container_id: "ses-revision",
          id: task.id,
          expected_revision: 1,
          description: "stale write attempt",
        },
        config
      )
      expect.unreachable("expected revision conflict")
    } catch (error) {
      const typed = error as TaskSystemError
      expect(typed.code).toBe(TASK_ERROR_CODES.revision_conflict)
      expect(typed.message).toContain("expected 1, got 2")
    }
  })

  test("createTaskNode returns dependency_not_found when dependency id is missing", () => {
    // #when / #then
    try {
      createTaskNode(
        {
          scope: "session",
          container_id: "ses-dependency",
          title: "Task with missing dependency",
          depends_on: ["missing-task-id"],
        },
        config
      )
      expect.unreachable("expected dependency_not_found")
    } catch (error) {
      const typed = error as TaskSystemError
      expect(typed.code).toBe(TASK_ERROR_CODES.dependency_not_found)
      expect(typed.details?.dependencyId).toBe("missing-task-id")
    }
  })

  test("listTaskNodes enforces include_completed/state/ready_only filters consistently", () => {
    // #given
    const blocker = createTaskNode(
      {
        scope: "session",
        container_id: "ses-list",
        title: "Dependency task",
      },
      config
    )
    createTaskNode(
      {
        scope: "session",
        container_id: "ses-list",
        title: "Blocked task",
        depends_on: [blocker.id],
      },
      config
    )
    const completed = createTaskNode(
      {
        scope: "session",
        container_id: "ses-list",
        title: "Completed task",
      },
      config
    )
    const inProgress = transitionTaskNode(
      {
        scope: "session",
        container_id: "ses-list",
        id: completed.id,
        expected_revision: completed.revision,
        next_state: "in_progress",
      },
      config
    )
    transitionTaskNode(
      {
        scope: "session",
        container_id: "ses-list",
        id: completed.id,
        expected_revision: inProgress.revision,
        next_state: "completed",
      },
      config
    )

    // #when
    const defaultList = listTaskNodes(
      {
        scope: "session",
        container_id: "ses-list",
      },
      config
    )
    const completedOnly = listTaskNodes(
      {
        scope: "session",
        container_id: "ses-list",
        include_completed: true,
        state: "completed",
      },
      config
    )
    const readyOnly = listTaskNodes(
      {
        scope: "session",
        container_id: "ses-list",
        ready_only: true,
      },
      config
    )

    // #then
    expect(defaultList.some((task) => task.state === "completed")).toBe(false)
    expect(completedOnly).toHaveLength(1)
    expect(completedOnly[0]?.title).toBe("Completed task")
    expect(readyOnly.map((task) => task.title)).toEqual(["Dependency task"])
  })
})
