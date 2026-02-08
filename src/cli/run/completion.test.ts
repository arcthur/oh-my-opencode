import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test"
import { existsSync, mkdirSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import type { RunContext, ChildSession, SessionStatus } from "./types"
import type { OhMyOpenCodeConfig } from "../../config"
import { createTaskNode, transitionTaskNode } from "../../features/task-system"

let taskStorage: string

const createMockContext = (overrides: {
  childrenBySession?: Record<string, ChildSession[]>
  statuses?: Record<string, SessionStatus>
} = {}): RunContext => {
  const {
    childrenBySession = { "test-session": [] },
    statuses = {},
  } = overrides

  const taskConfig: Partial<OhMyOpenCodeConfig> = {
    sisyphus: {
      tasks: {
        enabled: true,
        storage_path: taskStorage,
      },
    },
  }

  return {
    client: {
      session: {
        children: mock((opts: { path: { id: string } }) =>
          Promise.resolve({ data: childrenBySession[opts.path.id] ?? [] })
        ),
        status: mock(() => Promise.resolve({ data: statuses })),
      },
    } as unknown as RunContext["client"],
    sessionID: "test-session",
    directory: "/test",
    abortController: new AbortController(),
    taskConfig,
  }
}

describe("checkCompletionConditions", () => {
  beforeEach(() => {
    taskStorage = join(tmpdir(), `cli-completion-task-storage-${Date.now()}`)
    mkdirSync(taskStorage, { recursive: true })
  })

  afterEach(() => {
    if (existsSync(taskStorage)) {
      rmSync(taskStorage, { recursive: true, force: true })
    }
  })

  it("returns true when no tasks and no children", async () => {
    // given
    spyOn(console, "log").mockImplementation(() => {})
    const ctx = createMockContext()
    const { checkCompletionConditions } = await import("./completion")

    // when
    const result = await checkCompletionConditions(ctx)

    // then
    expect(result).toBe(true)
  })

  it("returns false when incomplete tasks exist", async () => {
    // given
    spyOn(console, "log").mockImplementation(() => {})
    const ctx = createMockContext()
    createTaskNode(
      {
        scope: "session",
        container_id: ctx.sessionID,
        title: "WIP",
      },
      ctx.taskConfig ?? {}
    )
    const { checkCompletionConditions } = await import("./completion")

    // when
    const result = await checkCompletionConditions(ctx)

    // then
    expect(result).toBe(false)
  })

  it("returns true when all tasks are completed or cancelled", async () => {
    // given
    spyOn(console, "log").mockImplementation(() => {})
    const ctx = createMockContext()
    const done = createTaskNode(
      {
        scope: "session",
        container_id: ctx.sessionID,
        title: "Done",
      },
      ctx.taskConfig ?? {}
    )
    const skip = createTaskNode(
      {
        scope: "session",
        container_id: ctx.sessionID,
        title: "Skip",
      },
      ctx.taskConfig ?? {}
    )

    const doneInProgress = transitionTaskNode(
      {
        scope: "session",
        container_id: ctx.sessionID,
        id: done.id,
        expected_revision: done.revision,
        next_state: "in_progress",
      },
      ctx.taskConfig ?? {}
    )
    transitionTaskNode(
      {
        scope: "session",
        container_id: ctx.sessionID,
        id: done.id,
        expected_revision: doneInProgress.revision,
        next_state: "completed",
      },
      ctx.taskConfig ?? {}
    )
    transitionTaskNode(
      {
        scope: "session",
        container_id: ctx.sessionID,
        id: skip.id,
        expected_revision: skip.revision,
        next_state: "cancelled",
      },
      ctx.taskConfig ?? {}
    )

    const { checkCompletionConditions } = await import("./completion")

    // when
    const result = await checkCompletionConditions(ctx)

    // then
    expect(result).toBe(true)
  })

  it("returns false when child session is busy", async () => {
    // given
    spyOn(console, "log").mockImplementation(() => {})
    const ctx = createMockContext({
      childrenBySession: {
        "test-session": [{ id: "child-1" }],
        "child-1": [],
      },
      statuses: { "child-1": { type: "busy" } },
    })
    const { checkCompletionConditions } = await import("./completion")

    // when
    const result = await checkCompletionConditions(ctx)

    // then
    expect(result).toBe(false)
  })

  it("returns true when all descendants idle", async () => {
    // given
    spyOn(console, "log").mockImplementation(() => {})
    const ctx = createMockContext({
      childrenBySession: {
        "test-session": [{ id: "child-1" }],
        "child-1": [{ id: "grandchild-1" }],
        "grandchild-1": [{ id: "great-grandchild-1" }],
        "great-grandchild-1": [],
      },
      statuses: {
        "child-1": { type: "idle" },
        "grandchild-1": { type: "idle" },
        "great-grandchild-1": { type: "idle" },
      },
    })
    const { checkCompletionConditions } = await import("./completion")

    // when
    const result = await checkCompletionConditions(ctx)

    // then
    expect(result).toBe(true)
  })
})
