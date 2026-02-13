import { afterEach, beforeEach, describe, it, expect, mock, spyOn } from "bun:test"
import { existsSync, mkdirSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import type { RunContext, Todo, ChildSession, SessionStatus } from "./types"
import type { OhMyOpenCodeConfig } from "../../config"
import { createEventState } from "./events"
import { pollForCompletion } from "./poll-for-completion"

let taskStorage: string

const createMockContext = (overrides: {
  directory?: string
  taskConfig?: Partial<OhMyOpenCodeConfig>
  todo?: Todo[]
  childrenBySession?: Record<string, ChildSession[]>
  statuses?: Record<string, SessionStatus>
  mainSessionMessages?: Array<{
    info?: { id?: string; role?: string; finish?: string }
    parts?: Array<{ type?: string; text?: string }>
  }>
} = {}): RunContext => {
  const {
    directory = "/test",
    todo = [],
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
        parts: [{ type: "text", text: "Done" }],
      },
    ],
  } = overrides

  return {
    client: {
      session: {
        todo: mock(() => Promise.resolve({ data: todo })),
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

describe("pollForCompletion", () => {
  beforeEach(() => {
    taskStorage = join(tmpdir(), `cli-poll-for-completion-task-storage-${Date.now()}`)
    mkdirSync(taskStorage, { recursive: true })
  })

  afterEach(() => {
    if (existsSync(taskStorage)) {
      rmSync(taskStorage, { recursive: true, force: true })
    }
  })

  it("requires consecutive stability checks before exiting - not immediate", async () => {
    //#given - 0 todos, 0 children, session idle, meaningful work done
    spyOn(console, "log").mockImplementation(() => {})
    spyOn(console, "error").mockImplementation(() => {})
    const ctx = createMockContext()
    const eventState = createEventState()
    eventState.mainSessionIdle = true
    eventState.hasReceivedMeaningfulWork = true
    const abortController = new AbortController()

    //#when
    const result = await pollForCompletion(ctx, eventState, abortController, {
      pollIntervalMs: 10,
      requiredConsecutive: 3,
      minStabilizationMs: 0,
    })

    //#then - exits with 0 but only after 3 consecutive checks
    expect(result).toBe(0)
    const statusCallCount = (ctx.client.session.status as ReturnType<typeof mock>).mock.calls.length
    expect(statusCallCount).toBeGreaterThanOrEqual(3)
  })

  it("does not check completion during stabilization period after first meaningful work", async () => {
    //#given - session idle, meaningful work done, but stabilization period not elapsed
    spyOn(console, "log").mockImplementation(() => {})
    spyOn(console, "error").mockImplementation(() => {})
    const ctx = createMockContext()
    const eventState = createEventState()
    eventState.mainSessionIdle = true
    eventState.hasReceivedMeaningfulWork = true
    const abortController = new AbortController()

    //#when - abort before stabilization period elapses
    setTimeout(() => abortController.abort(), 50)
    const result = await pollForCompletion(ctx, eventState, abortController, {
      pollIntervalMs: 10,
      requiredConsecutive: 3,
      minStabilizationMs: 60,
    })

    //#then - should abort without checking completion
    expect(result).toBe(130)
    const statusCallCount = (ctx.client.session.status as ReturnType<typeof mock>).mock.calls.length
    expect(statusCallCount).toBe(0)
  })

  it("does not exit when currentTool is set - resets consecutive counter", async () => {
    //#given
    spyOn(console, "log").mockImplementation(() => {})
    spyOn(console, "error").mockImplementation(() => {})
    const ctx = createMockContext()
    const eventState = createEventState()
    eventState.mainSessionIdle = true
    eventState.hasReceivedMeaningfulWork = true
    eventState.currentTool = "task"
    const abortController = new AbortController()

    //#when - abort after enough time to verify it didn't exit
    setTimeout(() => abortController.abort(), 100)
    const result = await pollForCompletion(ctx, eventState, abortController, {
      pollIntervalMs: 10,
      requiredConsecutive: 3,
      minStabilizationMs: 0,
    })

    //#then - should be aborted, not completed (tool blocked exit)
    expect(result).toBe(130)
    const statusCallCount = (ctx.client.session.status as ReturnType<typeof mock>).mock.calls.length
    expect(statusCallCount).toBe(0)
  })

  it("resets consecutive counter when session becomes busy between checks", async () => {
    //#given
    spyOn(console, "log").mockImplementation(() => {})
    spyOn(console, "error").mockImplementation(() => {})
    const ctx = createMockContext()
    const eventState = createEventState()
    eventState.mainSessionIdle = true
    eventState.hasReceivedMeaningfulWork = true
    const abortController = new AbortController()
    let statusCallCount = 0
    let busyInserted = false

    ;(ctx.client.session as any).status = mock(async () => {
      statusCallCount++
      if (statusCallCount === 1 && !busyInserted) {
        busyInserted = true
        eventState.mainSessionIdle = false
        setTimeout(() => { eventState.mainSessionIdle = true }, 15)
      }
      return { data: {} }
    })
    ;(ctx.client.session as any).children = mock(() =>
      Promise.resolve({ data: [] })
    )

    //#when
    const startMs = Date.now()
    const result = await pollForCompletion(ctx, eventState, abortController, {
      pollIntervalMs: 10,
      requiredConsecutive: 3,
      minStabilizationMs: 0,
    })
    const elapsedMs = Date.now() - startMs

    //#then - took longer than 3 polls because busy interrupted the streak
    expect(result).toBe(0)
    expect(elapsedMs).toBeGreaterThan(30)
  })

  it("returns 1 on session error", async () => {
    //#given
    spyOn(console, "log").mockImplementation(() => {})
    spyOn(console, "error").mockImplementation(() => {})
    const ctx = createMockContext()
    const eventState = createEventState()
    eventState.mainSessionIdle = true
    eventState.mainSessionError = true
    eventState.lastError = "Test error"
    const abortController = new AbortController()

    //#when
    const result = await pollForCompletion(ctx, eventState, abortController, {
      pollIntervalMs: 10,
      requiredConsecutive: 3,
      minStabilizationMs: 0,
    })

    //#then
    expect(result).toBe(1)
  })

  it("returns 1 on session error even when not idle", async () => {
    //#given — error must not be masked by idle/tool gates
    spyOn(console, "log").mockImplementation(() => {})
    spyOn(console, "error").mockImplementation(() => {})
    const ctx = createMockContext()
    const eventState = createEventState()
    eventState.mainSessionIdle = false
    eventState.mainSessionError = true
    eventState.lastError = "Fatal error while busy"
    const abortController = new AbortController()

    //#when
    const result = await pollForCompletion(ctx, eventState, abortController, {
      pollIntervalMs: 10,
      requiredConsecutive: 3,
    })

    //#then
    expect(result).toBe(1)
  })

  it("recovers from transient session error within grace window", async () => {
    //#given
    spyOn(console, "log").mockImplementation(() => {})
    spyOn(console, "error").mockImplementation(() => {})
    const ctx = createMockContext()
    const eventState = createEventState()
    eventState.mainSessionIdle = true
    eventState.hasReceivedMeaningfulWork = true
    eventState.mainSessionError = true
    eventState.lastError = "Transient upstream failure"
    const abortController = new AbortController()

    setTimeout(() => {
      eventState.mainSessionError = false
      eventState.lastError = null
    }, 15)

    //#when
    const result = await pollForCompletion(ctx, eventState, abortController, {
      pollIntervalMs: 10,
      requiredConsecutive: 2,
      minStabilizationMs: 0,
    })

    //#then
    expect(result).toBe(0)
  })

  it("returns 130 when aborted", async () => {
    //#given
    spyOn(console, "log").mockImplementation(() => {})
    spyOn(console, "error").mockImplementation(() => {})
    const ctx = createMockContext()
    const eventState = createEventState()
    const abortController = new AbortController()

    //#when
    setTimeout(() => abortController.abort(), 50)
    const result = await pollForCompletion(ctx, eventState, abortController, {
      pollIntervalMs: 10,
      requiredConsecutive: 3,
      minStabilizationMs: 0,
    })

    //#then
    expect(result).toBe(130)
  })

  it("does not check completion when hasReceivedMeaningfulWork is false", async () => {
    //#given
    spyOn(console, "log").mockImplementation(() => {})
    spyOn(console, "error").mockImplementation(() => {})
    const ctx = createMockContext()
    const eventState = createEventState()
    eventState.mainSessionIdle = true
    eventState.hasReceivedMeaningfulWork = false
    const abortController = new AbortController()

    //#when
    setTimeout(() => abortController.abort(), 100)
    const result = await pollForCompletion(ctx, eventState, abortController, {
      pollIntervalMs: 10,
      requiredConsecutive: 3,
      minStabilizationMs: 0,
    })

    //#then
    expect(result).toBe(130)
    const statusCallCount = (ctx.client.session.status as ReturnType<typeof mock>).mock.calls.length
    expect(statusCallCount).toBe(0)
  })

  it("simulates race condition: brief idle with 0 todos does not cause immediate exit", async () => {
    //#given - simulate orchestrator outputting text, session goes idle briefly, then tool fires
    spyOn(console, "log").mockImplementation(() => {})
    spyOn(console, "error").mockImplementation(() => {})
    const ctx = createMockContext()
    const eventState = createEventState()
    eventState.mainSessionIdle = true
    eventState.hasReceivedMeaningfulWork = true
    const abortController = new AbortController()
    setTimeout(() => {
      eventState.currentTool = "task"
    }, 15)

    //#when - abort after tool stays in-flight
    setTimeout(() => abortController.abort(), 200)
    const result = await pollForCompletion(ctx, eventState, abortController, {
      pollIntervalMs: 10,
      requiredConsecutive: 3,
      minStabilizationMs: 0,
    })

    //#then - should NOT have exited with 0 (tool blocked it, then aborted)
    expect(result).toBe(130)
  })
})
