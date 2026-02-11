import { describe, expect, test } from "bun:test"
import { createSessionStateRepairHook } from "./index"

describe("session-state-repair", () => {
  test("tool_result_missing falls back to revert when tool_result injection fails", async () => {
    // #given
    const sessionID = "session-1"
    const failedMessageID = "msg-1"

    let abortCalls = 0
    let promptCalls = 0
    let revertCalls = 0
    let revertArgs: unknown = null

    const failedMsg = {
      info: {
        id: failedMessageID,
        role: "assistant",
        sessionID,
      },
      parts: [
        {
          type: "tool_use",
          id: "call_1",
          name: "write",
          input: {},
        },
      ],
    }

    const ctx = {
      directory: "/tmp/test",
      client: {
        tui: {
          showToast: async () => ({}),
        },
        session: {
          abort: async () => {
            abortCalls++
            return {}
          },
          messages: async () => ({ data: [failedMsg] }),
          prompt: async () => {
            promptCalls++
            throw new Error("unsupported parts")
          },
          revert: async (args: unknown) => {
            revertCalls++
            revertArgs = args
            return {}
          },
        },
      },
    } as never

    const hook = createSessionStateRepairHook(ctx)

    // #when
    const recovered = await hook.handleSessionRecovery({
      id: failedMessageID,
      role: "assistant",
      sessionID,
      error: { message: "tool_use block requires corresponding tool_result" },
    })

    // #then
    expect(recovered).toBe(true)
    expect(abortCalls).toBe(1)
    expect(promptCalls).toBe(1)
    expect(revertCalls).toBe(1)
    expect(revertArgs).toEqual({
      path: { id: sessionID },
      query: { directory: "/tmp/test" },
      body: { messageID: failedMessageID },
    })
  })

  test("assistant_prefill_unsupported does not report recovery success and skips prompt/revert", async () => {
    // #given
    const sessionID = "session-prefill"
    const failedMessageID = "msg-prefill"

    let abortCalls = 0
    let promptCalls = 0
    let revertCalls = 0

    const failedMsg = {
      info: {
        id: failedMessageID,
        role: "assistant",
        sessionID,
      },
      parts: [
        {
          type: "text",
          text: "partial output",
        },
      ],
    }

    const ctx = {
      directory: "/tmp/test",
      client: {
        tui: {
          showToast: async () => ({}),
        },
        session: {
          abort: async () => {
            abortCalls++
            return {}
          },
          messages: async () => ({ data: [failedMsg] }),
          prompt: async () => {
            promptCalls++
            return {}
          },
          revert: async () => {
            revertCalls++
            return {}
          },
        },
      },
    } as never

    const hook = createSessionStateRepairHook(ctx)

    // #when
    const recovered = await hook.handleSessionRecovery({
      id: failedMessageID,
      role: "assistant",
      sessionID,
      error: {
        message:
          "This model does not support assistant message prefill. The conversation must end with a user message.",
      },
    })

    // #then
    expect(recovered).toBe(false)
    expect(abortCalls).toBe(1)
    expect(promptCalls).toBe(0)
    expect(revertCalls).toBe(0)
  })
})
