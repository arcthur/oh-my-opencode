import { describe, expect, test } from "bun:test"
import type { BackgroundTask } from "./types"
import type { OpencodeClient } from "./constants"
import { TaskStateManager } from "./state"
import type { ConcurrencyManager } from "./concurrency"
import { notifyParentSession, validateSessionHasOutput } from "./result-handler"

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

  test("should use INTERRUPTED status label for interrupted task notifications", async () => {
    // #given
    let notificationText = ""
    const client = {
      session: {
        prompt: async (args: { body: { parts: Array<{ text?: string }> } }) => {
          notificationText = args.body.parts[0]?.text ?? ""
          return {}
        },
        messages: async () => ({ data: [] }),
      },
    } as unknown as OpencodeClient

    const state = new TaskStateManager()
    const task: BackgroundTask = {
      id: "task-interrupted",
      sessionID: "session-child",
      parentSessionID: "session-parent",
      parentMessageID: "msg-parent",
      description: "task interrupted",
      prompt: "test",
      agent: "explore",
      status: "interrupt",
      startedAt: new Date(),
      completedAt: new Date(),
      error: "prompt transport failure",
    }

    state.pendingByParent.set("session-parent", new Set([task.id, "task-remaining"]))

    // #when
    await notifyParentSession(task, {
      client,
      state,
      concurrencyManager: {} as unknown as ConcurrencyManager,
    })

    // #then
    expect(notificationText).toContain("[BACKGROUND TASK INTERRUPTED]")
  })

  test("should use ERROR status label for failed task notifications", async () => {
    // #given
    let notificationText = ""
    const client = {
      session: {
        prompt: async (args: { body: { parts: Array<{ text?: string }> } }) => {
          notificationText = args.body.parts[0]?.text ?? ""
          return {}
        },
        messages: async () => ({ data: [] }),
      },
    } as unknown as OpencodeClient

    const state = new TaskStateManager()
    const task: BackgroundTask = {
      id: "task-error",
      sessionID: "session-child",
      parentSessionID: "session-parent",
      parentMessageID: "msg-parent",
      description: "task error",
      prompt: "test",
      agent: "explore",
      status: "error",
      startedAt: new Date(),
      completedAt: new Date(),
      error: "failed to process",
    }

    state.pendingByParent.set("session-parent", new Set([task.id, "task-remaining"]))

    // #when
    await notifyParentSession(task, {
      client,
      state,
      concurrencyManager: {} as unknown as ConcurrencyManager,
    })

    // #then
    expect(notificationText).toContain("[BACKGROUND TASK ERROR]")
  })

  test("should fallback duration start to completedAt when startedAt is missing", async () => {
    // #given
    let notificationText = ""
    const client = {
      session: {
        prompt: async (args: { body: { parts: Array<{ text?: string }> } }) => {
          notificationText = args.body.parts[0]?.text ?? ""
          return {}
        },
        messages: async () => ({ data: [] }),
      },
    } as unknown as OpencodeClient

    const state = new TaskStateManager()
    const completedAt = new Date("2026-02-09T00:00:00.000Z")
    const task: BackgroundTask = {
      id: "task-duration-fallback",
      sessionID: "session-child",
      parentSessionID: "session-parent",
      parentMessageID: "msg-parent",
      description: "duration fallback",
      prompt: "test",
      agent: "explore",
      status: "error",
      completedAt,
      error: "failed before start",
    }

    state.pendingByParent.set("session-parent", new Set([task.id, "task-remaining"]))

    // #when
    await notifyParentSession(task, {
      client,
      state,
      concurrencyManager: {} as unknown as ConcurrencyManager,
    })

    // #then
    expect(notificationText).toContain("**Duration:** 0s")
  })
})

describe("validateSessionHasOutput", () => {
  test("handles direct array response from client.session.messages", async () => {
    // #given
    const client = {
      session: {
        messages: async () => [
          {
            info: { role: "assistant" },
            parts: [{ type: "text", text: "done" }],
          },
        ],
      },
    } as unknown as OpencodeClient

    // #when
    const result = await validateSessionHasOutput(client, "session-array-shape")

    // #then
    expect(result).toBe(true)
  })

  test("returns false for null-shaped response payload", async () => {
    // #given
    const client = {
      session: {
        messages: async () => null,
      },
    } as unknown as OpencodeClient

    // #when
    const result = await validateSessionHasOutput(client, "session-null-shape")

    // #then
    expect(result).toBe(false)
  })
})
