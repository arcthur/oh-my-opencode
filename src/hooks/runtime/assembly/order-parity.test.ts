import { describe, expect, test } from "bun:test"
import { EVENT_TOTAL_ORDER } from "../pipeline-order"
import {
  buildChatMessageNodes,
  buildUserPromptSubmitNodes,
  buildToolExecuteBeforeNodes,
  buildToolExecuteAfterNodes,
  buildEventNodes,
  buildExperimentalChatTransformNodes,
  buildExperimentalSessionCompactingNodes,
  type RuntimeAssemblyContext,
} from "./index"
import type { HookEventType, HookNodeId } from "../types"

function assertOrderedSubset(event: HookEventType, ids: HookNodeId[]): void {
  const totalOrder = EVENT_TOTAL_ORDER[event]
  let cursor = -1
  for (const id of ids) {
    const index = totalOrder.indexOf(id)
    expect(index, `Missing ${id} in EVENT_TOTAL_ORDER[${event}]`).toBeGreaterThan(-1)
    expect(index, `Out of order node ${id} for ${event}`).toBeGreaterThan(cursor)
    cursor = index
  }
}

function createTestContext(): RuntimeAssemblyContext {
  return {
    pluginConfig: {},
    directory: "/test",
    firstMessageVariantGate: {
      shouldOverride: () => false,
      markApplied: () => {},
      markSessionCreated: () => {},
      clear: () => {},
    },
    resolveAgentVariant: () => undefined,
    applyAgentVariant: () => {},
    contextCollector: {
      beginTurn: () => {},
      register: () => {},
    },
    updateSessionAgent: () => {},
    sessionStateCoordinator: {
      onSessionCreated: () => {},
      onSessionDeleted: () => {},
      onSessionCompacted: () => {},
    },
    setMainSession: () => {},
    getMainSessionID: () => undefined,
    resetMessageCursor: () => {},
    swarmRuntime: {
      unbindSession: () => {},
      unregisterWorker: () => {},
      unregisterCoordinator: () => {},
    },
    skillMcpManager: {
      disconnectSession: async () => {},
    },
    lspManager: {
      cleanupTempDirectoryClients: async () => {},
    },
    continuationControl: {
      beginEvent: () => {},
      flushEvent: async () => {},
    },
  }
}

describe("runtime assembly order parity", () => {
  test("chat.message builder follows EVENT_TOTAL_ORDER", () => {
    const context = createTestContext()
    const nodes = buildChatMessageNodes(
      context,
      { sessionID: "s", agent: "a", messageID: "m" },
      { parts: [], message: {} }
    )
    assertOrderedSubset("chat.message", nodes.map((node) => node.id))
  })

  test("user.prompt.submit builder follows EVENT_TOTAL_ORDER", () => {
    const context = createTestContext()
    const nodes = buildUserPromptSubmitNodes(context, {
      sessionID: "s",
      message: { role: "user", content: "hello" },
    })
    assertOrderedSubset("user.prompt.submit", nodes.map((node) => node.id))
  })

  test("tool.execute.before builder follows EVENT_TOTAL_ORDER", () => {
    const context = createTestContext()
    const nodes = buildToolExecuteBeforeNodes(
      context,
      { tool: "Read", sessionID: "s", callID: "c" },
      { args: {} }
    )
    assertOrderedSubset("tool.execute.before", nodes.map((node) => node.id))
  })

  test("tool.execute.after builder follows EVENT_TOTAL_ORDER", () => {
    const context = createTestContext()
    const nodes = buildToolExecuteAfterNodes(
      context,
      { tool: "Read", sessionID: "s", callID: "c" },
      { title: "", output: "", metadata: {} }
    )
    assertOrderedSubset("tool.execute.after", nodes.map((node) => node.id))
  })

  test("event builder follows EVENT_TOTAL_ORDER", () => {
    const context = createTestContext()
    const nodes = buildEventNodes(context, { event: { type: "session.created", properties: {} } })
    assertOrderedSubset("event", nodes.map((node) => node.id))
  })

  test("experimental.chat.messages.transform builder follows EVENT_TOTAL_ORDER", () => {
    const context = createTestContext()
    const nodes = buildExperimentalChatTransformNodes(
      context,
      {},
      { messages: [] }
    )
    assertOrderedSubset(
      "experimental.chat.messages.transform",
      nodes.map((node) => node.id)
    )
  })

  test("experimental.session.compacting builder follows EVENT_TOTAL_ORDER", () => {
    const context = createTestContext()
    const nodes = buildExperimentalSessionCompactingNodes(
      context,
      { sessionID: "s" },
      { context: [] }
    )
    assertOrderedSubset(
      "experimental.session.compacting",
      nodes.map((node) => node.id)
    )
  })
})
