import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { randomUUID } from "node:crypto"
import { existsSync, mkdirSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import type { OhMyOpenCodeConfig } from "../../../config"
import { createTaskNode, transitionTaskNode } from "../../../features/task-system"
import { createWorkStateManager } from "../../../features/work-state"
import { injectCompactionContext } from "./compaction-context"

describe("compaction-context", () => {
  let workspace: string
  let taskStorage: string
  let taskConfig: Partial<Pick<OhMyOpenCodeConfig, "sisyphus">>

  beforeEach(() => {
    workspace = join(tmpdir(), `compaction-context-${randomUUID()}`)
    taskStorage = join(workspace, "task-graph")
    mkdirSync(taskStorage, { recursive: true })
    taskConfig = {
      sisyphus: {
        tasks: {
          enabled: true,
          storage_path: taskStorage,
        },
      },
    }
  })

  afterEach(() => {
    if (existsSync(workspace)) {
      rmSync(workspace, { recursive: true, force: true })
    }
  })

  test("injects task snapshot when active tasks exist", () => {
    // #given
    const sessionID = "ses_compact_1"
    const openTask = createTaskNode(
      {
        scope: "session",
        container_id: sessionID,
        title: "Implement dynamic pruning fallback",
        priority: 2,
      },
      taskConfig
    )
    const inProgressTask = createTaskNode(
      {
        scope: "session",
        container_id: sessionID,
        title: "Verify recovery continuation behavior",
        priority: 5,
      },
      taskConfig
    )
    transitionTaskNode(
      {
        scope: "session",
        container_id: sessionID,
        id: inProgressTask.id,
        expected_revision: inProgressTask.revision,
        next_state: "in_progress",
      },
      taskConfig
    )
    const completedTask = createTaskNode(
      {
        scope: "session",
        container_id: sessionID,
        title: "Completed baseline migration",
      },
      taskConfig
    )
    transitionTaskNode(
      {
        scope: "session",
        container_id: sessionID,
        id: completedTask.id,
        expected_revision: completedTask.revision,
        next_state: "completed",
      },
      taskConfig
    )

    const output = { context: [] as string[] }

    // #when
    injectCompactionContext(output, {
      sessionID,
      directory: workspace,
      taskConfig,
    })

    // #then
    expect(output.context.length).toBe(2)
    const snapshot = output.context[1]
    expect(snapshot).toContain("[TaskGraph Snapshot]")
    expect(snapshot).toContain("selector: source=session")
    expect(snapshot).toContain("total=3")
    expect(snapshot).toContain("incomplete=2")
    expect(snapshot).toContain(openTask.id)
    expect(snapshot).toContain(inProgressTask.id)
    expect(snapshot).not.toContain(completedTask.id)
  })

  test("keeps static compaction prompt only when no tasks exist", () => {
    // #given
    const output = { context: [] as string[] }

    // #when
    injectCompactionContext(output, {
      sessionID: "ses_empty",
      directory: workspace,
      taskConfig,
    })

    // #then
    expect(output.context.length).toBe(1)
    expect(output.context[0]).toContain("When summarizing this session")
  })

  test("prefers plan-scoped selector from work-state over session scope", () => {
    // #given
    const sessionID = "ses_plan"
    const planID = "plan_alpha"
    createWorkStateManager(workspace).initializePlan(planID, sessionID)

    const planTask = createTaskNode(
      {
        scope: "plan",
        container_id: planID,
        title: "Execute plan-level task",
      },
      taskConfig
    )
    const sessionTask = createTaskNode(
      {
        scope: "session",
        container_id: sessionID,
        title: "Session-only fallback task",
      },
      taskConfig
    )

    const output = { context: [] as string[] }

    // #when
    injectCompactionContext(output, {
      sessionID,
      directory: workspace,
      taskConfig,
    })

    // #then
    expect(output.context.length).toBe(2)
    const snapshot = output.context[1]
    expect(snapshot).toContain(`source=plan, scope=plan, container_id=${planID}`)
    expect(snapshot).toContain(planTask.id)
    expect(snapshot).not.toContain(sessionTask.id)
  })
})
