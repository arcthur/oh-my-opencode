import { describe, expect, test } from "bun:test"
import {
  buildChatMessageNodes,
  buildEventNodes,
  buildExperimentalSessionCompactingNodes,
  buildToolExecuteBeforeNodes,
  buildToolExecuteAfterNodes,
  type RuntimeAssemblyContext,
} from "./index"

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
    taskResumeInfo: {
      "tool.execute.after": async () => {},
    },
  }
}

describe("runtime assembly internal nodes", () => {
  test("chat.message contains session tracking internal node", () => {
    const context = createTestContext()
    const nodes = buildChatMessageNodes(
      context,
      { sessionID: "s", agent: "a", messageID: "m" },
      { parts: [], message: {} }
    )

    expect(nodes.some((node) => node.id === "internal:session-agent-tracking:chat.message")).toBe(true)
  })

  test("event contains core-session-state internal node", () => {
    const context = createTestContext()
    const nodes = buildEventNodes(context, { event: { type: "session.created", properties: {} } })

    expect(nodes.some((node) => node.id === "internal:core-session-state:event")).toBe(true)
  })

  test("event core-session-state persists governance snapshot on session.idle", async () => {
    const context = createTestContext()
    const calls: string[] = []
    context.persistGovernanceTraceSnapshot = (sessionID: string) => {
      calls.push(sessionID)
      return true
    }
    const nodes = buildEventNodes(context, {
      event: { type: "session.idle", properties: { sessionID: "idle-1" } },
    })
    const coreNode = nodes.find((node) => node.id === "internal:core-session-state:event")
    expect(coreNode).toBeDefined()

    await coreNode?.invoke()

    expect(calls).toEqual(["idle-1"])
  })

  test("tool.execute.before contains task-tools-sanitizer internal node", () => {
    const context = createTestContext()
    const nodes = buildToolExecuteBeforeNodes(
      context,
      { tool: "Read", sessionID: "s", callID: "c" },
      { args: {} }
    )

    expect(nodes.some((node) => node.id === "internal:task-tools-sanitizer:tool.execute.before")).toBe(true)
  })

  test("tool.execute.after contains task-resume-info internal node", () => {
    const context = createTestContext()
    const nodes = buildToolExecuteAfterNodes(
      context,
      { tool: "Read", sessionID: "s", callID: "c" },
      { title: "", output: "", metadata: {} }
    )

    expect(nodes.some((node) => node.id === "internal:task-resume-info:tool.execute.after")).toBe(true)
  })

  test("experimental.session.compacting contains policy observe/enforce internal nodes", () => {
    const context = createTestContext()
    const nodes = buildExperimentalSessionCompactingNodes(
      context,
      { sessionID: "s" },
      { context: [] }
    )

    expect(
      nodes.some((node) => node.id === "internal:policy-observe:experimental.session.compacting")
    ).toBe(true)
    expect(
      nodes.some((node) => node.id === "internal:policy-enforce:experimental.session.compacting")
    ).toBe(true)
  })
})
