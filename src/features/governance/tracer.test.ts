import { describe, it, expect, beforeEach, afterEach } from "vitest"
import {
  ExecutionTracer,
  TracerManager,
  getTracerManager,
  resetTracerManager,
} from "./tracer"
import { SuspendException } from "./suspend-exception"
import type { TraceNode, TraceNodeStatus } from "./tracer-types"

describe("ExecutionTracer", () => {
  let tracer: ExecutionTracer

  beforeEach(() => {
    tracer = new ExecutionTracer("test-session")
  })

  describe("core tracing", () => {
    it("creates trace with session ID", () => {
      const trace = tracer.getTrace()

      expect(trace.sessionId).toBe("test-session")
      expect(trace.traceId).toBeDefined()
      expect(trace.startedAt).toBeDefined()
      expect(trace.nodes).toHaveLength(0)
      expect(trace.edges).toHaveLength(0)
    })

    it("starts and ends a node", () => {
      const nodeId = tracer.startNode({
        type: "hook",
        name: "test-hook",
        inputs: { key: "value" },
      })

      expect(nodeId).toBeDefined()

      const node = tracer.findNode(nodeId)
      expect(node).toBeDefined()
      expect(node?.status).toBe("running")
      expect(node?.name).toBe("test-hook")

      tracer.endNode(nodeId, {
        status: "completed",
        outputs: { result: "success" },
      })

      const updatedNode = tracer.findNode(nodeId)
      expect(updatedNode?.status).toBe("completed")
      expect(updatedNode?.timing.durationMs).toBeDefined()
    })

    it("creates edges between nodes", () => {
      const node1 = tracer.startNode({ type: "hook", name: "hook1" })
      tracer.endNode(node1, { status: "completed" })

      const node2 = tracer.startNode({ type: "tool", name: "tool1" })
      tracer.endNode(node2, { status: "completed" })

      tracer.addEdge({
        from: node1,
        to: node2,
        type: "data-flow",
        trigger: { type: "output" },
        dataKeys: ["result"],
      })

      const trace = tracer.getTrace()
      const dataFlowEdge = trace.edges.find((e) => e.type === "data-flow")

      expect(dataFlowEdge).toBeDefined()
      expect(dataFlowEdge?.from).toBe(node1)
      expect(dataFlowEdge?.to).toBe(node2)
    })

    it("tracks parent-child relationships via stack", () => {
      const parent = tracer.startNode({ type: "agent", name: "parent-agent" })
      const child = tracer.startNode({ type: "tool", name: "child-tool" })

      const childNode = tracer.findNode(child)
      expect(childNode?.parentId).toBe(parent)

      // There should be a control-flow edge
      const trace = tracer.getTrace()
      const controlEdge = trace.edges.find(
        (e) => e.from === parent && e.to === child && e.type === "control-flow"
      )
      expect(controlEdge).toBeDefined()
    })
  })

  describe("traceHook wrapper", () => {
    it("traces successful hook execution", async () => {
      const result = await tracer.traceHook("my-hook", { input: 1 }, async () => {
        return { output: 2 }
      })

      expect(result).toEqual({ output: 2 })

      const nodes = tracer.getNodes()
      expect(nodes).toHaveLength(1)
      expect(nodes[0].name).toBe("my-hook")
      expect(nodes[0].status).toBe("completed")
    })

    it("traces failed hook execution", async () => {
      await expect(
        tracer.traceHook("failing-hook", {}, async () => {
          throw new Error("Hook failed")
        })
      ).rejects.toThrow("Hook failed")

      const nodes = tracer.getNodes()
      expect(nodes[0].status).toBe("failed")
      expect(nodes[0].error?.message).toBe("Hook failed")
    })

    it("traces suspended hook execution", async () => {
      await expect(
        tracer.traceHook("suspending-hook", {}, async () => {
          throw new SuspendException({
            reason: "Needs approval",
            resumeToken: "token-123",
            previewData: { title: "Test", description: "Test", affectedItems: [] },
            availableActions: [],
            tool: "test",
            toolArgs: {},
            sessionId: "session",
            timestamp: Date.now(),
          })
        })
      ).rejects.toThrow(SuspendException)

      const nodes = tracer.getNodes()
      expect(nodes[0].status).toBe("suspended")
    })
  })

  describe("traceTool wrapper", () => {
    it("traces successful tool execution", async () => {
      const result = await tracer.traceTool("Bash", { command: "ls" }, async () => {
        return "file1\nfile2"
      })

      expect(result).toBe("file1\nfile2")

      const nodes = tracer.getNodes()
      expect(nodes).toHaveLength(1)
      expect(nodes[0].type).toBe("tool")
      expect(nodes[0].name).toBe("Bash")
    })
  })

  describe("metrics", () => {
    it("updates metrics as nodes are added", () => {
      tracer.startNode({ type: "hook", name: "hook1" })
      tracer.startNode({ type: "tool", name: "tool1" })

      const metrics = tracer.getMetrics()
      expect(metrics.nodeCount).toBe(2)
    })

    it("tracks failed and suspended counts", () => {
      const node1 = tracer.startNode({ type: "hook", name: "hook1" })
      tracer.endNode(node1, { status: "failed", error: { type: "Error", message: "fail", recoverable: false } })

      const node2 = tracer.startNode({ type: "tool", name: "tool1" })
      tracer.endNode(node2, { status: "suspended" })

      const node3 = tracer.startNode({ type: "hook", name: "hook2" })
      tracer.endNode(node3, { status: "completed" })

      const metrics = tracer.getMetrics()
      expect(metrics.failedNodes).toBe(1)
      expect(metrics.suspendedNodes).toBe(1)
    })
  })

  describe("compression", () => {
    it("merges consecutive low-impact nodes into governance blocks", () => {
      // Add many low-impact nodes
      for (let i = 0; i < 10; i++) {
        const id = tracer.startNode({ type: "hook", name: "logger" })
        tracer.endNode(id, { status: "completed" })
      }

      // Add a critical node
      const criticalId = tracer.startNode({ type: "decision", name: "critical-decision" })
      tracer.endNode(criticalId, { status: "completed" })

      const compressed = tracer.compress({ mergeThreshold: 5, alwaysCritical: ["decision"], lowImpactHooks: ["logger"], highImpactStateKeys: [] })

      expect(compressed.originalCount).toBe(11)
      expect(compressed.compressedCount).toBeLessThan(11)
      expect(compressed.ratio).toBeLessThan(1)
    })

    it("keeps critical nodes uncompressed", () => {
      const decisionId = tracer.startNode({ type: "decision", name: "my-decision" })
      tracer.endNode(decisionId, { status: "completed" })

      const checkpointId = tracer.startNode({ type: "checkpoint", name: "my-checkpoint" })
      tracer.endNode(checkpointId, { status: "completed" })

      const compressed = tracer.compress()

      // Both should remain as regular nodes
      const regularNodes = compressed.nodes.filter((n) => !("mergedCount" in n)) as TraceNode[]
      expect(regularNodes.some((n) => n.name === "my-decision")).toBe(true)
      expect(regularNodes.some((n) => n.name === "my-checkpoint")).toBe(true)
    })
  })

  describe("critical path extraction", () => {
    it("extracts only critical nodes", () => {
      // Add mix of nodes
      const hookId = tracer.startNode({ type: "hook", name: "logger" })
      tracer.endNode(hookId, { status: "completed" })

      const decisionId = tracer.startNode({ type: "decision", name: "choose-path" })
      tracer.endNode(decisionId, { status: "completed" })

      const toolId = tracer.startNode({ type: "tool", name: "Read" })
      tracer.endNode(toolId, { status: "completed" })

      const criticalPath = tracer.extractCriticalPath()

      expect(criticalPath.nodes.some((n) => n.name === "choose-path")).toBe(true)
      expect(criticalPath.criticality.size).toBeGreaterThan(0)
    })

    it("includes failed nodes in critical path", () => {
      const failedId = tracer.startNode({ type: "tool", name: "failing-tool" })
      tracer.endNode(failedId, {
        status: "failed",
        error: { type: "Error", message: "Something went wrong", recoverable: false },
      })

      const criticalPath = tracer.extractCriticalPath()

      expect(criticalPath.nodes.some((n) => n.name === "failing-tool")).toBe(true)
      const reason = criticalPath.criticality.get(failedId)
      expect(reason?.type).toBe("error")
    })
  })

  describe("visualization export", () => {
    it("exports for visualization", () => {
      const nodeId = tracer.startNode({ type: "hook", name: "test-hook" })
      tracer.endNode(nodeId, { status: "completed" })

      const viz = tracer.exportForVisualization()

      expect(viz.nodes).toHaveLength(1)
      expect(viz.nodes[0].label).toBe("test-hook")
      expect(viz.timeline).toHaveLength(1)
      expect(viz.metrics).toBeDefined()
    })

    it("exports Mermaid flowchart", () => {
      const hook = tracer.startNode({ type: "hook", name: "hook1" })
      tracer.endNode(hook, { status: "completed" })

      const tool = tracer.startNode({ type: "tool", name: "tool1" })
      tracer.endNode(tool, { status: "completed" })

      tracer.addEdge({
        from: hook,
        to: tool,
        type: "data-flow",
        trigger: { type: "output" },
      })

      const diagram = tracer.exportMermaidFlowchart()

      expect(diagram.type).toBe("flowchart")
      expect(diagram.syntax).toContain("flowchart TD")
      expect(diagram.syntax).toContain("hook1")
      expect(diagram.syntax).toContain("tool1")
    })

    it("exports Mermaid Gantt chart", () => {
      const node = tracer.startNode({ type: "hook", name: "timed-hook" })
      tracer.endNode(node, { status: "completed" })

      const diagram = tracer.exportMermaidGantt()

      expect(diagram.type).toBe("gantt")
      expect(diagram.syntax).toContain("gantt")
      expect(diagram.syntax).toContain("Execution Timeline")
      expect(diagram.syntax).toContain("timed-hook")
    })
  })

  describe("data sanitization", () => {
    it("redacts sensitive keys", () => {
      const nodeId = tracer.startNode({
        type: "hook",
        name: "auth-hook",
        inputs: {
          username: "user",
          password: "secret123",
          apiToken: "tok_abc",
        },
      })

      const node = tracer.findNode(nodeId)
      expect(node?.inputs.username).toBe("user")
      expect(node?.inputs.password).toBe("[REDACTED]")
      expect(node?.inputs.apiToken).toBe("[REDACTED]")
    })

    it("truncates long values", () => {
      const longValue = "x".repeat(2000)
      const nodeId = tracer.startNode({
        type: "hook",
        name: "data-hook",
        inputs: { data: longValue },
      })

      const node = tracer.findNode(nodeId)
      expect((node?.inputs.data as string).length).toBeLessThan(2000)
      expect(node?.inputs.data).toContain("[truncated]")
    })
  })

  describe("data-flow inference", () => {
    it("creates data-flow edge from state write/read", () => {
      const writer = tracer.startNode({ type: "hook", name: "writer-hook" })
      tracer.recordStateWrite(writer, "session", "task")
      tracer.endNode(writer, { status: "completed" })

      const reader = tracer.startNode({ type: "hook", name: "reader-hook" })
      const writerNodeId = tracer.recordStateRead(reader, "session", "task")
      tracer.endNode(reader, { status: "completed" })

      expect(writerNodeId).toBe(writer)

      const trace = tracer.getTrace()
      const dataFlowEdge = trace.edges.find(
        (e) => e.type === "data-flow" && e.from === writer && e.to === reader
      )

      expect(dataFlowEdge).toBeDefined()
      expect(dataFlowEdge?.trigger.type).toBe("state-dependency")
      expect(dataFlowEdge?.trigger.key).toBe("session:task")
    })

    it("does not create edge when reading own write", () => {
      const node = tracer.startNode({ type: "hook", name: "self-hook" })
      tracer.recordStateWrite(node, "session", "data")
      const writerNodeId = tracer.recordStateRead(node, "session", "data")
      tracer.endNode(node, { status: "completed" })

      expect(writerNodeId).toBeUndefined()

      const trace = tracer.getTrace()
      const dataFlowEdges = trace.edges.filter((e) => e.type === "data-flow")
      expect(dataFlowEdges).toHaveLength(0)
    })

    it("does not create edge when no prior write", () => {
      const reader = tracer.startNode({ type: "hook", name: "reader-hook" })
      const writerNodeId = tracer.recordStateRead(reader, "session", "unknown-key")
      tracer.endNode(reader, { status: "completed" })

      expect(writerNodeId).toBeUndefined()
    })

    it("creates data-flow edge from event emit/consume", () => {
      const emitter = tracer.startNode({ type: "hook", name: "emitter-hook" })
      tracer.recordEventEmit(emitter, "budget-warning")
      tracer.endNode(emitter, { status: "completed" })

      const consumer = tracer.startNode({ type: "hook", name: "consumer-hook" })
      const emitterNodeId = tracer.recordEventConsume(consumer, "budget-warning")
      tracer.endNode(consumer, { status: "completed" })

      expect(emitterNodeId).toBe(emitter)

      const trace = tracer.getTrace()
      const dataFlowEdge = trace.edges.find(
        (e) => e.type === "data-flow" && e.from === emitter && e.to === consumer
      )

      expect(dataFlowEdge).toBeDefined()
      expect(dataFlowEdge?.trigger.type).toBe("event")
      expect(dataFlowEdge?.trigger.eventType).toBe("budget-warning")
    })

    it("creates data-flow edge from proposal submit/apply/read", () => {
      const proposer = tracer.startNode({ type: "hook", name: "proposer-hook" })
      tracer.recordProposalSubmit(proposer, "prop-123", "config", "theme")
      tracer.endNode(proposer, { status: "completed" })

      // Proposal gets applied
      tracer.recordProposalApplied("prop-123", "config", "theme")

      const reader = tracer.startNode({ type: "hook", name: "reader-hook" })
      const writerNodeId = tracer.recordStateRead(reader, "config", "theme")
      tracer.endNode(reader, { status: "completed" })

      expect(writerNodeId).toBe(proposer)
    })

    it("creates data-flow edge for file dependencies", () => {
      const writer = tracer.startNode({ type: "tool", name: "write-file" })
      tracer.endNode(writer, { status: "completed" })

      const reader = tracer.startNode({ type: "tool", name: "read-file" })
      tracer.recordFileDependency(reader, writer, "/src/config.ts")
      tracer.endNode(reader, { status: "completed" })

      const trace = tracer.getTrace()
      const dataFlowEdge = trace.edges.find(
        (e) => e.type === "data-flow" && e.from === writer && e.to === reader
      )

      expect(dataFlowEdge).toBeDefined()
      expect(dataFlowEdge?.trigger.type).toBe("file-dependency")
      expect(dataFlowEdge?.trigger.path).toBe("/src/config.ts")
      expect(dataFlowEdge?.data?.filePath).toBe("/src/config.ts")
    })

    it("records timeline events for state operations", () => {
      const node = tracer.startNode({ type: "hook", name: "state-hook" })
      tracer.recordStateWrite(node, "ns", "key1")
      tracer.recordStateRead(node, "ns", "key2")
      tracer.endNode(node, { status: "completed" })

      const trace = tracer.getTrace()
      const writeEvent = trace.timeline.find((e) => e.type === "state-write")
      const readEvent = trace.timeline.find((e) => e.type === "state-read")

      expect(writeEvent).toBeDefined()
      expect(writeEvent?.details).toEqual({ namespace: "ns", key: "key1" })

      expect(readEvent).toBeDefined()
      expect(readEvent?.details).toEqual({ namespace: "ns", key: "key2" })
    })
  })

  describe("finalize", () => {
    it("sets endedAt and returns final trace", () => {
      const node = tracer.startNode({ type: "hook", name: "hook1" })
      tracer.endNode(node, { status: "completed" })

      const finalTrace = tracer.finalize()

      expect(finalTrace.endedAt).toBeDefined()
      expect(finalTrace.nodes).toHaveLength(1)
    })
  })
})

describe("TracerManager", () => {
  let manager: TracerManager

  beforeEach(() => {
    manager = new TracerManager()
  })

  afterEach(() => {
    resetTracerManager()
  })

  it("creates and retrieves tracers by session", () => {
    const tracer1 = manager.getTracer("session-1")
    const tracer2 = manager.getTracer("session-2")

    expect(tracer1).not.toBe(tracer2)

    // Same session returns same tracer
    const tracer1Again = manager.getTracer("session-1")
    expect(tracer1Again).toBe(tracer1)
  })

  it("checks if session has tracer", () => {
    expect(manager.hasTracer("new-session")).toBe(false)

    manager.getTracer("new-session")

    expect(manager.hasTracer("new-session")).toBe(true)
  })

  it("finalizes and removes tracer", () => {
    const tracer = manager.getTracer("session-1")
    const nodeId = tracer.startNode({ type: "hook", name: "hook1" })
    tracer.endNode(nodeId, { status: "completed" })

    const finalTrace = manager.finalizeTracer("session-1")

    expect(finalTrace).toBeDefined()
    expect(finalTrace?.endedAt).toBeDefined()
    expect(manager.hasTracer("session-1")).toBe(false)
  })

  it("returns undefined when finalizing non-existent session", () => {
    const result = manager.finalizeTracer("non-existent")
    expect(result).toBeUndefined()
  })

  it("lists active sessions", () => {
    manager.getTracer("session-a")
    manager.getTracer("session-b")
    manager.getTracer("session-c")

    const sessions = manager.listSessions()

    expect(sessions).toContain("session-a")
    expect(sessions).toContain("session-b")
    expect(sessions).toContain("session-c")
    expect(sessions).toHaveLength(3)
  })
})

describe("getTracerManager singleton", () => {
  afterEach(() => {
    resetTracerManager()
  })

  it("returns singleton instance", () => {
    const manager1 = getTracerManager()
    const manager2 = getTracerManager()

    expect(manager1).toBe(manager2)
  })

  it("resets singleton on reset call", () => {
    const manager1 = getTracerManager()
    resetTracerManager()
    const manager2 = getTracerManager()

    expect(manager1).not.toBe(manager2)
  })
})
