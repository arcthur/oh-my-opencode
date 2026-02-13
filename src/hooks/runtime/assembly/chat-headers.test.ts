import { afterEach, describe, expect, test } from "bun:test"
import {
  _resetForTesting as resetSessionStateForTesting,
  markSubagentSession,
} from "../../../features/claude-code-session-state"
import { appendHeaderToken, buildChatHeadersNodes } from "./chat-headers"

afterEach(() => {
  resetSessionStateForTesting()
})

describe("chat.headers runtime assembly", () => {
  test("appendHeaderToken appends token once and preserves existing order", () => {
    // #given
    const existing = "foo, bar"

    // #when
    const first = appendHeaderToken(existing, "baz")
    const second = appendHeaderToken(first, "bar")

    // #then
    expect(first).toBe("foo, bar, baz")
    expect(second).toBe("foo, bar, baz")
  })

  test("builds copilot anthropic beta node for claude copilot model", async () => {
    // #given
    const output = { headers: { "anthropic-beta": "existing-token" } }
    const input = {
      sessionID: "session-1",
      agent: "sisyphus",
      model: {
        providerID: "github-copilot",
        modelID: "claude-sonnet-4",
        api: { npm: "@ai-sdk/github-copilot" },
      },
      provider: {},
      message: {},
    }

    // #when
    const nodes = buildChatHeadersNodes(input, output)
    await nodes[0]?.invoke()

    // #then
    expect(nodes.map((node) => node.id)).toContain("internal:copilot-anthropic-beta:chat.headers")
    expect(output.headers["anthropic-beta"]).toBe(
      "existing-token, interleaved-thinking-2025-05-14"
    )
  })

  test("builds subagent initiator node when copilot request comes from subagent session", async () => {
    // #given
    markSubagentSession("sub-1", "main-1")
    const output = { headers: {} as Record<string, string> }
    const input = {
      sessionID: "sub-1",
      agent: "sisyphus-junior",
      model: {
        providerID: "github-copilot",
        modelID: "claude-opus-4.1",
        api: { npm: "@ai-sdk/anthropic" },
      },
      provider: {},
      message: {},
    }

    // #when
    const nodes = buildChatHeadersNodes(input, output)
    const initiatorNode = nodes.find(
      (node) => node.id === "internal:copilot-subagent-initiator:chat.headers"
    )
    await initiatorNode?.invoke()

    // #then
    expect(initiatorNode).toBeDefined()
    expect(output.headers["x-initiator"]).toBe("agent")
  })
})
