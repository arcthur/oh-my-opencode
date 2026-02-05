import { describe, expect, test } from "bun:test"
import type { BackgroundTask } from "./types"
import type { OpencodeClient } from "./constants"
import { TaskStateManager } from "./state"
import type { ConcurrencyManager } from "./concurrency"
import { notifyParentSession } from "./result-handler"

describe("notifyParentSession - aborted parent", () => {
  test("should skip notification when parent session is aborted", async () => {
    // #given
    let promptCalled = false
    const client = {
      session: {
        prompt: async () => {
          promptCalled = true
          return {}
        },
        messages: async () => {
          const error = new Error("User aborted")
          error.name = "MessageAbortedError"
          throw error
        },
      },
    } as unknown as OpencodeClient

    const state = new TaskStateManager()
    const task: BackgroundTask = {
      id: "task-aborted-parent",
      sessionID: "session-child",
      parentSessionID: "session-parent",
      parentMessageID: "msg-parent",
      description: "task aborted parent",
      prompt: "test",
      agent: "explore",
      status: "completed",
      startedAt: new Date(),
      completedAt: new Date(),
    }

    state.pendingByParent.set("session-parent", new Set([task.id, "task-remaining"]))

    // #when
    await notifyParentSession(task, {
      client,
      state,
      concurrencyManager: {} as unknown as ConcurrencyManager,
    })

    // #then
    expect(promptCalled).toBe(false)
  })

  test("should swallow aborted error from prompt", async () => {
    // #given
    let promptCalled = false
    const client = {
      session: {
        prompt: async () => {
          promptCalled = true
          const error = new Error("User aborted")
          error.name = "MessageAbortedError"
          throw error
        },
        messages: async () => ({ data: [] }),
      },
    } as unknown as OpencodeClient

    const state = new TaskStateManager()
    const task: BackgroundTask = {
      id: "task-aborted-prompt",
      sessionID: "session-child",
      parentSessionID: "session-parent",
      parentMessageID: "msg-parent",
      description: "task aborted prompt",
      prompt: "test",
      agent: "explore",
      status: "completed",
      startedAt: new Date(),
      completedAt: new Date(),
    }

    state.pendingByParent.set("session-parent", new Set([task.id]))

    // #when
    await notifyParentSession(task, {
      client,
      state,
      concurrencyManager: {} as unknown as ConcurrencyManager,
    })

    // #then
    expect(promptCalled).toBe(true)
  })
})

