import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test"
import { existsSync, mkdirSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import type { RunContext, ChildSession, SessionStatus } from "./types"
import type { OhMyOpenCodeConfig } from "../../config"
import { createTaskNode, transitionTaskNode } from "../../features/task-system"
import { ORCHESTRATOR_PROJECT_ROOT_ENV } from "../../features/orchestrator-tasks/storage"

let taskStorage: string
let originalProjectRootEnv: string | undefined
let hadProjectRootEnv = false

const createMockContext = (overrides: {
  directory?: string
  taskConfig?: Partial<OhMyOpenCodeConfig>
  childrenBySession?: Record<string, ChildSession[]>
  statuses?: Record<string, SessionStatus>
  mainSessionMessages?: Array<{
    info?: { id?: string; role?: string; finish?: string }
    parts?: Array<{ type?: string; text?: string }>
  }>
} = {}): RunContext => {
  const {
    directory = "/test",
    childrenBySession = { "test-session": [] },
    statuses = {},
    taskConfig = {
      orchestrator: {
        tasks: {
          enabled: true,
          storage_path: taskStorage,
        },
      },
    },
    mainSessionMessages = [
      {
        info: { id: "msg-1", role: "user" },
        parts: [{ type: "text", text: "Do work" }],
      },
      {
        info: { id: "msg-2", role: "assistant", finish: "end_turn" },
        parts: [{ type: "text", text: "Work complete" }],
      },
    ],
  } = overrides

  return {
    client: {
      session: {
        children: mock((opts: { path: { id: string } }) =>
          Promise.resolve({ data: childrenBySession[opts.path.id] ?? [] })
        ),
        status: mock(() => Promise.resolve({ data: statuses })),
        messages: mock(() => Promise.resolve({ data: mainSessionMessages })),
      },
    } as unknown as RunContext["client"],
    sessionID: "test-session",
    directory,
    abortController: new AbortController(),
    taskConfig,
  }
}

describe("checkCompletionConditions", () => {
  beforeEach(() => {
    taskStorage = join(tmpdir(), `cli-completion-task-storage-${Date.now()}`)
    mkdirSync(taskStorage, { recursive: true })
    hadProjectRootEnv = Object.prototype.hasOwnProperty.call(
      process.env,
      ORCHESTRATOR_PROJECT_ROOT_ENV
    )
    originalProjectRootEnv = process.env[ORCHESTRATOR_PROJECT_ROOT_ENV]
    delete process.env[ORCHESTRATOR_PROJECT_ROOT_ENV]
  })

  afterEach(() => {
    if (existsSync(taskStorage)) {
      rmSync(taskStorage, { recursive: true, force: true })
    }

    if (hadProjectRootEnv && originalProjectRootEnv !== undefined) {
      process.env[ORCHESTRATOR_PROJECT_ROOT_ENV] = originalProjectRootEnv
    } else {
      delete process.env[ORCHESTRATOR_PROJECT_ROOT_ENV]
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

  it("returns false when main session has no terminal assistant output", async () => {
    // given
    spyOn(console, "log").mockImplementation(() => {})
    const ctx = createMockContext({
      mainSessionMessages: [
        {
          info: { id: "msg-1", role: "user" },
          parts: [{ type: "text", text: "Need output" }],
        },
        {
          info: { id: "msg-2", role: "assistant", finish: "tool-calls" },
          parts: [],
        },
      ],
    })
    const { checkCompletionConditions } = await import("./completion")

    // when
    const result = await checkCompletionConditions(ctx)

    // then
    expect(result).toBe(false)
  })

  it("returns true when terminal assistant output exists but message ids are missing", async () => {
    // given
    spyOn(console, "log").mockImplementation(() => {})
    const ctx = createMockContext({
      mainSessionMessages: [
        {
          info: { role: "user" },
          parts: [{ type: "text", text: "Need output" }],
        },
        {
          info: { role: "assistant", finish: "end_turn" },
          parts: [{ type: "text", text: "Done" }],
        },
      ],
    })
    const { checkCompletionConditions } = await import("./completion")

    // when
    const result = await checkCompletionConditions(ctx)

    // then
    expect(result).toBe(true)
  })

  it("returns false when message ids are missing and last user is newer than last assistant", async () => {
    // given
    spyOn(console, "log").mockImplementation(() => {})
    const ctx = createMockContext({
      mainSessionMessages: [
        {
          info: { role: "assistant", finish: "end_turn" },
          parts: [{ type: "text", text: "Old output" }],
        },
        {
          info: { role: "user" },
          parts: [{ type: "text", text: "New request" }],
        },
      ],
    })
    const { checkCompletionConditions } = await import("./completion")

    // when
    const result = await checkCompletionConditions(ctx)

    // then
    expect(result).toBe(false)
  })

  it("resolves relative task storage path from ctx.directory", async () => {
    // given
    spyOn(console, "log").mockImplementation(() => {})
    const projectRoot = join(tmpdir(), `cli-completion-project-root-${Date.now()}`)
    const wrongRoot = join(tmpdir(), `cli-completion-wrong-root-${Date.now()}`)
    try {
      mkdirSync(projectRoot, { recursive: true })
      mkdirSync(wrongRoot, { recursive: true })
      process.env[ORCHESTRATOR_PROJECT_ROOT_ENV] = wrongRoot

      const relativeStoragePath = ".orchestrator/tasks"
      const absoluteStoragePath = join(projectRoot, relativeStoragePath)
      mkdirSync(absoluteStoragePath, { recursive: true })

      const ctx = createMockContext({
        directory: projectRoot,
        taskConfig: {
          orchestrator: {
            tasks: {
              enabled: true,
              storage_path: relativeStoragePath,
            },
          },
        },
      })

      createTaskNode(
        {
          scope: "session",
          container_id: ctx.sessionID,
          title: "WIP",
        },
        {
          orchestrator: {
            tasks: {
              enabled: true,
              storage_path: absoluteStoragePath,
            },
          },
        }
      )
      const { checkCompletionConditions } = await import("./completion")

      // when
      const result = await checkCompletionConditions(ctx)

      // then
      expect(result).toBe(false)
    } finally {
      rmSync(projectRoot, { recursive: true, force: true })
      rmSync(wrongRoot, { recursive: true, force: true })
    }
  })
})
