import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import type { OhMyOpenCodeConfig } from "../../config/schema"
import { TASK_ERROR_CODES, TaskSystemError } from "./domain"
import {
  createTaskNode,
  listTaskNodes,
  transitionTaskNode,
  updateTaskNode,
} from "./service"

describe("task-system/service", () => {
  let workspace: string
  let config: Partial<OhMyOpenCodeConfig>

  beforeEach(() => {
    workspace = join(tmpdir(), `task-system-service-${Date.now()}`)
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

  test("creates tasks with open state and revision 1", () => {
    // #given / #when
    const task = createTaskNode(
      {
        scope: "session",
        container_id: "ses_alpha",
        title: "Implement API",
      },
      config
    )

    // #then
    expect(task.state).toBe("open")
    expect(task.revision).toBe(1)
    expect(task.scope).toBe("session")
  })

  test("updates structural fields and increments revision", () => {
    // #given
    const task = createTaskNode(
      {
        scope: "session",
        container_id: "ses_beta",
        title: "Original",
      },
      config
    )

    // #when
    const updated = updateTaskNode(
      {
        scope: "session",
        container_id: "ses_beta",
        id: task.id,
        expected_revision: 1,
        title: "Updated",
        metadata: {
          a: 1,
        },
      },
      config
    )

    // #then
    expect(updated.title).toBe("Updated")
    expect(updated.revision).toBe(2)
    expect(updated.metadata).toEqual({ a: 1 })
  })

  test("prevents transition to completed while blocked", () => {
    // #given
    const blocker = createTaskNode(
      {
        scope: "session",
        container_id: "ses_gamma",
        title: "Blocker",
      },
      config
    )
    const blocked = createTaskNode(
      {
        scope: "session",
        container_id: "ses_gamma",
        title: "Blocked",
        depends_on: [blocker.id],
      },
      config
    )

    // #when / #then
    expect(() =>
      transitionTaskNode(
        {
          scope: "session",
          container_id: "ses_gamma",
          id: blocked.id,
          expected_revision: 1,
          next_state: "completed",
        },
        config
      )
    ).toThrowError(TaskSystemError)

    try {
      transitionTaskNode(
        {
          scope: "session",
          container_id: "ses_gamma",
          id: blocked.id,
          expected_revision: 1,
          next_state: "completed",
        },
        config
      )
      expect.unreachable("expected transition to fail")
    } catch (err) {
      const error = err as TaskSystemError
      expect(error.code).toBe(TASK_ERROR_CODES.transition_blocked)
    }
  })

  test("rejects dependency cycle during update", () => {
    // #given
    const taskA = createTaskNode(
      {
        scope: "session",
        container_id: "ses_delta",
        title: "A",
      },
      config
    )
    const taskB = createTaskNode(
      {
        scope: "session",
        container_id: "ses_delta",
        title: "B",
        depends_on: [taskA.id],
      },
      config
    )

    // #when / #then
    try {
      updateTaskNode(
        {
          scope: "session",
          container_id: "ses_delta",
          id: taskA.id,
          expected_revision: 1,
          add_depends_on: [taskB.id],
        },
        config
      )
      expect.unreachable("expected dependency cycle error")
    } catch (err) {
      const error = err as TaskSystemError
      expect(error.code).toBe(TASK_ERROR_CODES.dependency_cycle)
    }
  })

  test("list returns readiness summary", () => {
    // #given
    const blocker = createTaskNode(
      {
        scope: "session",
        container_id: "ses_eta",
        title: "Blocker",
      },
      config
    )
    createTaskNode(
      {
        scope: "session",
        container_id: "ses_eta",
        title: "Blocked",
        depends_on: [blocker.id],
      },
      config
    )

    // #when
    const list = listTaskNodes({
      scope: "session",
      container_id: "ses_eta",
      include_completed: true,
    }, config)

    // #then
    const blocked = list.find((item) => item.title === "Blocked")
    expect(blocked?.readiness).toBe("blocked")
    expect(blocked?.blocked_by_unresolved).toEqual([blocker.id])
  })
})
