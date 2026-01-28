/**
 * Trace Visualization Tests
 */

import { describe, it, expect, beforeEach } from "vitest"
import {
  TraceVisualizer,
  toMermaidFlowchart,
  toMermaidSequence,
  toMermaidGantt,
  toD3Force,
  toHtmlReport,
  calculateTraceStatistics,
} from "./visualization"
import type { ExecutionTrace, CompressedTrace, TraceNode, TraceEdge } from "./tracer-types"
import { DEFAULT_VISUALIZATION_CONFIG } from "./visualization-types"

// ============================================================================
// Test Helpers
// ============================================================================

function createTestTrace(
  overrides: Partial<ExecutionTrace> = {}
): ExecutionTrace {
  const now = Date.now()
  return {
    traceId: "trace-001",
    sessionId: "session-001",
    startedAt: now - 1000,
    endedAt: now,
    nodes: [],
    edges: [],
    timeline: [],
    metrics: {
      totalDurationMs: 1000,
      totalTokensUsed: 500,
      totalApiCalls: 10,
      nodeCount: 0,
      edgeCount: 0,
      failedNodes: 0,
      suspendedNodes: 0,
    },
    ...overrides,
  }
}

function createTestNode(
  overrides: Partial<TraceNode> = {}
): TraceNode {
  const now = Date.now()
  return {
    id: `node-${Math.random().toString(36).substring(7)}`,
    type: "tool",
    name: "test-node",
    timing: {
      startedAt: now - 100,
      endedAt: now,
      durationMs: 100,
    },
    inputs: {},
    resources: {
      tokensUsed: 50,
      apiCalls: 1,
    },
    status: "completed",
    ...overrides,
  }
}

function createTestEdge(
  from: string,
  to: string,
  overrides: Partial<TraceEdge> = {}
): TraceEdge {
  return {
    from,
    to,
    type: "control-flow",
    trigger: { type: "explicit" },
    ...overrides,
  }
}

// ============================================================================
// TraceVisualizer Tests
// ============================================================================

describe("TraceVisualizer", () => {
  let visualizer: TraceVisualizer

  beforeEach(() => {
    visualizer = new TraceVisualizer()
  })

  // =========================================================================
  // Configuration
  // =========================================================================

  describe("configuration", () => {
    it("should use default configuration", () => {
      const output = visualizer.toMermaidFlowchart(createTestTrace())
      expect(output.direction).toBe(DEFAULT_VISUALIZATION_CONFIG.mermaid.flowchartDirection)
    })

    it("should accept custom configuration", () => {
      const customVisualizer = new TraceVisualizer({
        mermaid: { flowchartDirection: "LR" },
      })
      const output = customVisualizer.toMermaidFlowchart(createTestTrace())
      expect(output.direction).toBe("LR")
    })

    it("should merge partial config with defaults", () => {
      const customVisualizer = new TraceVisualizer({
        mermaid: { maxLabelLength: 50 },
      })
      const trace = createTestTrace({
        nodes: [createTestNode({ name: "A".repeat(60) })],
      })
      const output = customVisualizer.toMermaidFlowchart(trace)
      // Label should be truncated based on custom maxLabelLength
      expect(output.diagram).toContain("...")
    })
  })

  // =========================================================================
  // Export Method
  // =========================================================================

  describe("export", () => {
    it("should export to default format", () => {
      const output = visualizer.export(createTestTrace())
      expect(output.format).toBe("mermaid-flowchart")
    })

    it("should export to specified format", () => {
      const output = visualizer.export(createTestTrace(), "json-summary")
      expect(output.format).toBe("json-summary")
    })

    it("should throw for unsupported format", () => {
      expect(() => {
        visualizer.export(createTestTrace(), "unsupported" as any)
      }).toThrow("Unsupported format")
    })
  })

  // =========================================================================
  // Mermaid Flowchart
  // =========================================================================

  describe("toMermaidFlowchart", () => {
    it("should generate valid flowchart header", () => {
      const output = visualizer.toMermaidFlowchart(createTestTrace())
      expect(output.diagram).toContain("flowchart TB")
    })

    it("should include all nodes", () => {
      const node1 = createTestNode({ id: "n1", name: "Node 1" })
      const node2 = createTestNode({ id: "n2", name: "Node 2" })
      const trace = createTestTrace({ nodes: [node1, node2] })

      const output = visualizer.toMermaidFlowchart(trace)
      expect(output.nodeCount).toBe(2)
      expect(output.diagram).toContain("n1")
      expect(output.diagram).toContain("n2")
    })

    it("should include edges", () => {
      const node1 = createTestNode({ id: "n1" })
      const node2 = createTestNode({ id: "n2" })
      const edge = createTestEdge("n1", "n2")
      const trace = createTestTrace({ nodes: [node1, node2], edges: [edge] })

      const output = visualizer.toMermaidFlowchart(trace)
      expect(output.edgeCount).toBe(1)
      expect(output.diagram).toContain("n1 --> n2")
    })

    it("should use different shapes for different node types", () => {
      const decision = createTestNode({ id: "d1", type: "decision" })
      const checkpoint = createTestNode({ id: "c1", type: "checkpoint" })
      const agent = createTestNode({ id: "a1", type: "agent" })
      const trace = createTestTrace({ nodes: [decision, checkpoint, agent] })

      const output = visualizer.toMermaidFlowchart(trace)
      expect(output.diagram).toContain("{") // diamond for decision
      expect(output.diagram).toContain("[[") // subroutine for checkpoint
      expect(output.diagram).toContain("((") // circle for agent
    })

    it("should style nodes based on status", () => {
      const failed = createTestNode({ id: "f1", status: "failed" })
      const completed = createTestNode({ id: "c1", status: "completed" })
      const trace = createTestTrace({ nodes: [failed, completed] })

      const output = visualizer.toMermaidFlowchart(trace)
      expect(output.diagram).toContain("style f1")
      expect(output.diagram).toContain("style c1")
    })

    it("should use different arrow styles for edge types", () => {
      const node1 = createTestNode({ id: "n1" })
      const node2 = createTestNode({ id: "n2" })
      const node3 = createTestNode({ id: "n3" })
      const dataEdge = createTestEdge("n1", "n2", { type: "data-flow" })
      const spawnEdge = createTestEdge("n2", "n3", { type: "spawn" })
      const trace = createTestTrace({
        nodes: [node1, node2, node3],
        edges: [dataEdge, spawnEdge],
      })

      const output = visualizer.toMermaidFlowchart(trace)
      expect(output.diagram).toContain("==>") // data-flow arrow
      expect(output.diagram).toContain("-.->") // spawn arrow
    })

    it("should truncate long labels", () => {
      const longName = "A".repeat(50)
      const node = createTestNode({ id: "n1", name: longName })
      const trace = createTestTrace({ nodes: [node] })

      const output = visualizer.toMermaidFlowchart(trace)
      expect(output.diagram).toContain("...")
    })

    it("should include edge labels with trigger details", () => {
      const node1 = createTestNode({ id: "n1" })
      const node2 = createTestNode({ id: "n2" })
      const edge = createTestEdge("n1", "n2", {
        trigger: { type: "condition", details: "x > 10" },
      })
      const trace = createTestTrace({ nodes: [node1, node2], edges: [edge] })

      const output = visualizer.toMermaidFlowchart(trace)
      expect(output.diagram).toContain("x > 10")
    })
  })

  // =========================================================================
  // Mermaid Sequence
  // =========================================================================

  describe("toMermaidSequence", () => {
    it("should generate valid sequence diagram header", () => {
      const output = visualizer.toMermaidSequence(createTestTrace())
      expect(output.diagram).toContain("sequenceDiagram")
    })

    it("should include participants from node types", () => {
      const hook = createTestNode({ id: "h1", type: "hook" })
      const tool = createTestNode({ id: "t1", type: "tool" })
      const trace = createTestTrace({ nodes: [hook, tool] })

      const output = visualizer.toMermaidSequence(trace)
      expect(output.participants).toContain("hook")
      expect(output.participants).toContain("tool")
      expect(output.diagram).toContain("participant hook")
      expect(output.diagram).toContain("participant tool")
    })

    it("should generate messages from edges", () => {
      const hook = createTestNode({ id: "h1", type: "hook" })
      const tool = createTestNode({ id: "t1", type: "tool" })
      const edge = createTestEdge("h1", "t1", { type: "trigger" })
      const trace = createTestTrace({ nodes: [hook, tool], edges: [edge] })

      const output = visualizer.toMermaidSequence(trace)
      expect(output.messageCount).toBe(1)
      expect(output.diagram).toContain("hook->tool")
    })

    it("should use different arrow for data-flow", () => {
      const hook = createTestNode({ id: "h1", type: "hook" })
      const tool = createTestNode({ id: "t1", type: "tool" })
      const edge = createTestEdge("h1", "t1", { type: "data-flow" })
      const trace = createTestTrace({ nodes: [hook, tool], edges: [edge] })

      const output = visualizer.toMermaidSequence(trace)
      expect(output.diagram).toContain("->>")
    })
  })

  // =========================================================================
  // Mermaid Gantt
  // =========================================================================

  describe("toMermaidGantt", () => {
    it("should generate valid gantt header", () => {
      const output = visualizer.toMermaidGantt(createTestTrace())
      expect(output.diagram).toContain("gantt")
      expect(output.diagram).toContain("dateFormat X")
    })

    it("should group nodes by type into sections", () => {
      const hook = createTestNode({ id: "h1", type: "hook", name: "hook1" })
      const tool = createTestNode({ id: "t1", type: "tool", name: "tool1" })
      const trace = createTestTrace({ nodes: [hook, tool] })

      const output = visualizer.toMermaidGantt(trace)
      expect(output.sections).toContain("hook")
      expect(output.sections).toContain("tool")
      expect(output.diagram).toContain("section hook")
      expect(output.diagram).toContain("section tool")
    })

    it("should mark failed tasks as critical", () => {
      const failed = createTestNode({ id: "f1", status: "failed", name: "failed-task" })
      const trace = createTestTrace({ nodes: [failed] })

      const output = visualizer.toMermaidGantt(trace)
      expect(output.diagram).toContain("crit,")
    })

    it("should mark suspended tasks as done", () => {
      const suspended = createTestNode({ id: "s1", status: "suspended", name: "suspended-task" })
      const trace = createTestTrace({ nodes: [suspended] })

      const output = visualizer.toMermaidGantt(trace)
      expect(output.diagram).toContain("done,")
    })

    it("should calculate total duration", () => {
      const now = Date.now()
      const node1 = createTestNode({
        id: "n1",
        timing: { startedAt: now - 500, endedAt: now - 300, durationMs: 200 },
      })
      const node2 = createTestNode({
        id: "n2",
        timing: { startedAt: now - 300, endedAt: now, durationMs: 300 },
      })
      const trace = createTestTrace({
        startedAt: now - 500,
        nodes: [node1, node2],
      })

      const output = visualizer.toMermaidGantt(trace)
      expect(output.totalDurationMs).toBeGreaterThan(0)
    })
  })

  // =========================================================================
  // D3 Force Graph
  // =========================================================================

  describe("toD3Force", () => {
    it("should create D3 nodes with required properties", () => {
      const node = createTestNode({ id: "n1", name: "Test", type: "tool", status: "completed" })
      const trace = createTestTrace({ nodes: [node] })

      const output = visualizer.toD3Force(trace)
      expect(output.nodes).toHaveLength(1)
      expect(output.nodes[0]).toMatchObject({
        id: "n1",
        label: "Test",
        type: "tool",
        status: "completed",
      })
      expect(output.nodes[0].group).toBeDefined()
      expect(output.nodes[0].size).toBeDefined()
    })

    it("should create D3 links from edges", () => {
      const node1 = createTestNode({ id: "n1" })
      const node2 = createTestNode({ id: "n2" })
      const edge = createTestEdge("n1", "n2", { type: "data-flow" })
      const trace = createTestTrace({ nodes: [node1, node2], edges: [edge] })

      const output = visualizer.toD3Force(trace)
      expect(output.links).toHaveLength(1)
      expect(output.links[0]).toMatchObject({
        source: "n1",
        target: "n2",
        type: "data-flow",
      })
    })

    it("should assign higher weight to data-flow edges", () => {
      const node1 = createTestNode({ id: "n1" })
      const node2 = createTestNode({ id: "n2" })
      const node3 = createTestNode({ id: "n3" })
      const dataEdge = createTestEdge("n1", "n2", { type: "data-flow" })
      const controlEdge = createTestEdge("n2", "n3", { type: "control-flow" })
      const trace = createTestTrace({
        nodes: [node1, node2, node3],
        edges: [dataEdge, controlEdge],
      })

      const output = visualizer.toD3Force(trace)
      const dataLink = output.links.find((l) => l.type === "data-flow")
      const controlLink = output.links.find((l) => l.type === "control-flow")
      expect(dataLink!.weight).toBeGreaterThan(controlLink!.weight)
    })

    it("should scale node size based on duration", () => {
      const shortNode = createTestNode({ id: "n1", timing: { startedAt: 0, durationMs: 10 } })
      const longNode = createTestNode({ id: "n2", timing: { startedAt: 0, durationMs: 10000 } })
      const trace = createTestTrace({ nodes: [shortNode, longNode] })

      const output = visualizer.toD3Force(trace)
      const short = output.nodes.find((n) => n.id === "n1")
      const long = output.nodes.find((n) => n.id === "n2")
      expect(long!.size).toBeGreaterThan(short!.size)
    })
  })

  // =========================================================================
  // D3 Tree
  // =========================================================================

  describe("toD3Tree", () => {
    it("should build tree structure from edges", () => {
      const root = createTestNode({ id: "root", name: "Root" })
      const child1 = createTestNode({ id: "c1", name: "Child 1" })
      const child2 = createTestNode({ id: "c2", name: "Child 2" })
      const edges = [
        createTestEdge("root", "c1", { type: "control-flow" }),
        createTestEdge("root", "c2", { type: "control-flow" }),
      ]
      const trace = createTestTrace({ nodes: [root, child1, child2], edges })

      const output = visualizer.toD3Tree(trace)
      expect(output.root.name).toBe("Root")
      expect(output.root.children).toHaveLength(2)
      expect(output.maxDepth).toBe(1)
      expect(output.totalNodes).toBe(3)
    })

    it("should create virtual root for multiple root nodes", () => {
      const root1 = createTestNode({ id: "r1", name: "Root 1" })
      const root2 = createTestNode({ id: "r2", name: "Root 2" })
      const trace = createTestTrace({ nodes: [root1, root2], edges: [] })

      const output = visualizer.toD3Tree(trace)
      expect(output.root.name).toBe("Trace")
      expect(output.root.type).toBe("root")
      expect(output.root.children).toHaveLength(2)
    })

    it("should calculate correct max depth", () => {
      const n1 = createTestNode({ id: "n1" })
      const n2 = createTestNode({ id: "n2" })
      const n3 = createTestNode({ id: "n3" })
      const n4 = createTestNode({ id: "n4" })
      const edges = [
        createTestEdge("n1", "n2"),
        createTestEdge("n2", "n3"),
        createTestEdge("n3", "n4"),
      ]
      const trace = createTestTrace({ nodes: [n1, n2, n3, n4], edges })

      const output = visualizer.toD3Tree(trace)
      expect(output.maxDepth).toBe(3)
    })

    it("should include node data in tree nodes", () => {
      const node = createTestNode({ id: "n1", type: "agent", status: "completed" })
      const trace = createTestTrace({ nodes: [node] })

      const output = visualizer.toD3Tree(trace)
      expect(output.root.data).toMatchObject({
        id: "n1",
        type: "agent",
        status: "completed",
      })
    })
  })

  // =========================================================================
  // D3 Timeline
  // =========================================================================

  describe("toD3Timeline", () => {
    it("should create timeline events from nodes", () => {
      const node = createTestNode({
        id: "n1",
        name: "Test",
        timing: { startedAt: 1000, endedAt: 2000, durationMs: 1000 },
      })
      const trace = createTestTrace({ startedAt: 0, nodes: [node] })

      const output = visualizer.toD3Timeline(trace)
      expect(output.events).toHaveLength(1)
      expect(output.events[0]).toMatchObject({
        id: "n1",
        label: "Test",
        start: 1000,
        end: 2000,
      })
    })

    it("should assign lanes for concurrent events", () => {
      const now = Date.now()
      const concurrent1 = createTestNode({
        id: "c1",
        timing: { startedAt: now, endedAt: now + 100, durationMs: 100 },
      })
      const concurrent2 = createTestNode({
        id: "c2",
        timing: { startedAt: now + 50, endedAt: now + 150, durationMs: 100 },
      })
      const trace = createTestTrace({ startedAt: now, nodes: [concurrent1, concurrent2] })

      const output = visualizer.toD3Timeline(trace)
      expect(output.lanes.length).toBeGreaterThan(1)
      const lane1 = output.events.find((e) => e.id === "c1")!.lane
      const lane2 = output.events.find((e) => e.id === "c2")!.lane
      expect(lane1).not.toBe(lane2)
    })

    it("should reuse lanes for non-overlapping events", () => {
      const now = Date.now()
      const first = createTestNode({
        id: "f1",
        timing: { startedAt: now, endedAt: now + 100, durationMs: 100 },
      })
      const second = createTestNode({
        id: "s1",
        timing: { startedAt: now + 200, endedAt: now + 300, durationMs: 100 },
      })
      const trace = createTestTrace({ startedAt: now, nodes: [first, second] })

      const output = visualizer.toD3Timeline(trace)
      expect(output.lanes).toHaveLength(1)
    })

    it("should calculate correct time range", () => {
      const now = Date.now()
      const node1 = createTestNode({
        timing: { startedAt: now, endedAt: now + 100, durationMs: 100 },
      })
      const node2 = createTestNode({
        timing: { startedAt: now + 200, endedAt: now + 500, durationMs: 300 },
      })
      const trace = createTestTrace({ startedAt: now, nodes: [node1, node2] })

      const output = visualizer.toD3Timeline(trace)
      expect(output.timeRange.start).toBe(0)
      expect(output.timeRange.end).toBe(500)
      expect(output.timeRange.duration).toBe(500)
    })

    it("should assign colors based on node type", () => {
      const hook = createTestNode({ id: "h1", type: "hook" })
      const tool = createTestNode({ id: "t1", type: "tool" })
      const trace = createTestTrace({ nodes: [hook, tool] })

      const output = visualizer.toD3Timeline(trace)
      const hookEvent = output.events.find((e) => e.id === "h1")
      const toolEvent = output.events.find((e) => e.id === "t1")
      expect(hookEvent!.color).not.toBe(toolEvent!.color)
    })
  })

  // =========================================================================
  // HTML Report
  // =========================================================================

  describe("toHtmlReport", () => {
    it("should generate valid HTML document", () => {
      const output = visualizer.toHtmlReport(createTestTrace())
      expect(output.html).toContain("<!DOCTYPE html>")
      expect(output.html).toContain("<html")
      expect(output.html).toContain("</html>")
    })

    it("should include summary section", () => {
      const output = visualizer.toHtmlReport(createTestTrace())
      expect(output.sections.find((s) => s.title === "Summary")).toBeDefined()
    })

    it("should include statistics section", () => {
      const output = visualizer.toHtmlReport(createTestTrace())
      expect(output.sections.find((s) => s.title === "Statistics")).toBeDefined()
      expect(output.statistics).toBeDefined()
    })

    it("should include diagrams when configured", () => {
      const output = visualizer.toHtmlReport(createTestTrace())
      expect(output.sections.find((s) => s.title === "Execution Flow")).toBeDefined()
    })

    it("should exclude diagrams when configured", () => {
      const nodiagramVisualizer = new TraceVisualizer({
        report: { includeDiagrams: false },
      })
      const output = nodiagramVisualizer.toHtmlReport(createTestTrace())
      expect(output.sections.find((s) => s.title === "Execution Flow")).toBeUndefined()
    })

    it("should include node details table", () => {
      const node = createTestNode({ id: "n1", name: "Test Node" })
      const trace = createTestTrace({ nodes: [node] })

      const output = visualizer.toHtmlReport(trace)
      expect(output.html).toContain("<table>")
      expect(output.html).toContain("Test Node")
    })

    it("should use dark theme when configured", () => {
      const darkVisualizer = new TraceVisualizer({
        report: { cssTheme: "dark" },
      })
      const output = darkVisualizer.toHtmlReport(createTestTrace())
      expect(output.html).toContain("#1e1e1e")
    })

    it("should include governance summary", () => {
      const output = visualizer.toHtmlReport(createTestTrace())
      expect(output.governance).toBeDefined()
      expect(output.governance.approvalGatesTriggered).toBeDefined()
    })
  })

  // =========================================================================
  // JSON Summary
  // =========================================================================

  describe("toJsonSummary", () => {
    it("should include metadata", () => {
      const trace = createTestTrace({ traceId: "test-trace", sessionId: "test-session" })
      const output = visualizer.toJsonSummary(trace)

      expect(output.metadata.traceId).toBe("test-trace")
      expect(output.metadata.sessionId).toBe("test-session")
      expect(output.metadata.startedAt).toBeDefined()
      expect(output.metadata.durationMs).toBeDefined()
    })

    it("should include statistics", () => {
      const output = visualizer.toJsonSummary(createTestTrace())
      expect(output.statistics).toBeDefined()
      expect(output.statistics.totalDurationMs).toBeDefined()
    })

    it("should include governance summary", () => {
      const output = visualizer.toJsonSummary(createTestTrace())
      expect(output.governance).toBeDefined()
    })

    it("should include critical path", () => {
      const n1 = createTestNode({ id: "n1", timing: { startedAt: 0, durationMs: 100 } })
      const n2 = createTestNode({ id: "n2", timing: { startedAt: 100, durationMs: 200 } })
      const edge = createTestEdge("n1", "n2")
      const trace = createTestTrace({ nodes: [n1, n2], edges: [edge] })

      const output = visualizer.toJsonSummary(trace)
      expect(output.criticalPath).toBeDefined()
      expect(Array.isArray(output.criticalPath)).toBe(true)
    })

    it("should include top-level nodes (max 10)", () => {
      const nodes = Array.from({ length: 15 }, (_, i) =>
        createTestNode({ id: `n${i}`, name: `Node ${i}` })
      )
      const trace = createTestTrace({ nodes })

      const output = visualizer.toJsonSummary(trace)
      expect(output.topLevelNodes).toHaveLength(10)
    })
  })

  // =========================================================================
  // Statistics Calculation
  // =========================================================================

  describe("calculateStatistics", () => {
    it("should count nodes by type", () => {
      const hook = createTestNode({ type: "hook" })
      const tool1 = createTestNode({ type: "tool" })
      const tool2 = createTestNode({ type: "tool" })
      const trace = createTestTrace({ nodes: [hook, tool1, tool2] })

      const stats = visualizer.calculateStatistics(trace)
      expect(stats.nodesByType["hook"]).toBe(1)
      expect(stats.nodesByType["tool"]).toBe(2)
    })

    it("should count nodes by status", () => {
      const completed = createTestNode({ status: "completed" })
      const failed = createTestNode({ status: "failed" })
      const trace = createTestTrace({ nodes: [completed, failed] })

      const stats = visualizer.calculateStatistics(trace)
      expect(stats.nodesByStatus["completed"]).toBe(1)
      expect(stats.nodesByStatus["failed"]).toBe(1)
    })

    it("should count edges by type", () => {
      const n1 = createTestNode({ id: "n1" })
      const n2 = createTestNode({ id: "n2" })
      const n3 = createTestNode({ id: "n3" })
      const edges = [
        createTestEdge("n1", "n2", { type: "data-flow" }),
        createTestEdge("n2", "n3", { type: "control-flow" }),
      ]
      const trace = createTestTrace({ nodes: [n1, n2, n3], edges })

      const stats = visualizer.calculateStatistics(trace)
      expect(stats.edgesByType["data-flow"]).toBe(1)
      expect(stats.edgesByType["control-flow"]).toBe(1)
    })

    it("should sum total tokens and API calls", () => {
      const n1 = createTestNode({ resources: { tokensUsed: 100, apiCalls: 2 } })
      const n2 = createTestNode({ resources: { tokensUsed: 200, apiCalls: 3 } })
      const trace = createTestTrace({ nodes: [n1, n2] })

      const stats = visualizer.calculateStatistics(trace)
      expect(stats.totalTokensUsed).toBe(300)
      expect(stats.totalApiCalls).toBe(5)
    })

    it("should calculate average and max duration", () => {
      const n1 = createTestNode({ timing: { startedAt: 0, durationMs: 100 } })
      const n2 = createTestNode({ timing: { startedAt: 0, durationMs: 300 } })
      const trace = createTestTrace({ nodes: [n1, n2] })

      const stats = visualizer.calculateStatistics(trace)
      expect(stats.avgNodeDurationMs).toBe(200)
      expect(stats.maxNodeDurationMs).toBe(300)
    })

    it("should calculate critical path length", () => {
      const n1 = createTestNode({ id: "n1" })
      const n2 = createTestNode({ id: "n2" })
      const n3 = createTestNode({ id: "n3" })
      const edges = [createTestEdge("n1", "n2"), createTestEdge("n2", "n3")]
      const trace = createTestTrace({ nodes: [n1, n2, n3], edges })

      const stats = visualizer.calculateStatistics(trace)
      expect(stats.criticalPathLength).toBe(3)
    })
  })

  // =========================================================================
  // Governance Summary
  // =========================================================================

  describe("calculateGovernanceSummary", () => {
    it("should count approval gates", () => {
      const decision1 = createTestNode({ type: "decision", status: "completed" })
      const decision2 = createTestNode({ type: "decision", status: "failed" })
      const trace = createTestTrace({ nodes: [decision1, decision2] })

      const summary = visualizer.calculateGovernanceSummary(trace)
      expect(summary.approvalGatesTriggered).toBe(2)
      expect(summary.approvalsGranted).toBe(1)
      expect(summary.approvalsRejected).toBe(1)
    })

    it("should count checkpoints", () => {
      const cp1 = createTestNode({ type: "checkpoint" })
      const cp2 = createTestNode({ type: "checkpoint" })
      const trace = createTestTrace({ nodes: [cp1, cp2] })

      const summary = visualizer.calculateGovernanceSummary(trace)
      expect(summary.checkpointsCreated).toBe(2)
    })

    it("should count errors", () => {
      const failed1 = createTestNode({ status: "failed" })
      const failed2 = createTestNode({ status: "failed" })
      const completed = createTestNode({ status: "completed" })
      const trace = createTestTrace({ nodes: [failed1, failed2, completed] })

      const summary = visualizer.calculateGovernanceSummary(trace)
      expect(summary.errorsEncountered).toBe(2)
    })

    it("should detect permission violations from node names", () => {
      const permNode = createTestNode({ name: "permission-check-failed" })
      const trace = createTestTrace({ nodes: [permNode] })

      const summary = visualizer.calculateGovernanceSummary(trace)
      expect(summary.permissionViolations).toBe(1)
    })

    it("should detect budget warnings from node names", () => {
      const budgetNode = createTestNode({ name: "budget-warning-triggered" })
      const trace = createTestTrace({ nodes: [budgetNode] })

      const summary = visualizer.calculateGovernanceSummary(trace)
      expect(summary.budgetWarnings).toBe(1)
    })
  })

  // =========================================================================
  // Compressed Trace Handling
  // =========================================================================

  describe("compressed trace handling", () => {
    function createCompressedTrace(): CompressedTrace {
      const now = Date.now()
      return {
        originalCount: 100,
        compressedCount: 10,
        ratio: 10,
        nodes: [
          createTestNode({ id: "n1", timing: { startedAt: now - 500, durationMs: 200 } }),
          createTestNode({ id: "n2", timing: { startedAt: now - 300, durationMs: 300 } }),
          {
            type: "governance-block",
            id: "gb1",
            mergedCount: 5,
            timeSpan: { start: now - 200, end: now },
            summary: "Merged low-impact hooks",
            totalResources: { tokensUsed: 100, apiCalls: 5 },
            originalNodeIds: ["h1", "h2", "h3", "h4", "h5"],
          },
        ],
        edges: [createTestEdge("n1", "n2")],
      }
    }

    it("should mark output as compressed", () => {
      const compressed = createCompressedTrace()
      const output = visualizer.toMermaidFlowchart(compressed)
      expect(output.compressed).toBe(true)
    })

    it("should filter out governance blocks from nodes", () => {
      const compressed = createCompressedTrace()
      const output = visualizer.toD3Force(compressed)
      // Should only include actual TraceNodes, not GovernanceBlock
      expect(output.nodes).toHaveLength(2)
    })

    it("should handle compressed trace in flowchart", () => {
      const compressed = createCompressedTrace()
      const output = visualizer.toMermaidFlowchart(compressed)
      expect(output.nodeCount).toBe(2)
    })

    it("should handle compressed trace in JSON summary", () => {
      const compressed = createCompressedTrace()
      const output = visualizer.toJsonSummary(compressed)
      expect(output.traceId).toBe("compressed")
    })
  })

  // =========================================================================
  // Empty Trace Handling
  // =========================================================================

  describe("empty trace handling", () => {
    it("should handle empty nodes array", () => {
      const trace = createTestTrace({ nodes: [], edges: [] })

      const flowchart = visualizer.toMermaidFlowchart(trace)
      expect(flowchart.nodeCount).toBe(0)
      expect(flowchart.edgeCount).toBe(0)

      const stats = visualizer.calculateStatistics(trace)
      expect(stats.avgNodeDurationMs).toBe(0)
    })

    it("should handle trace with no edges", () => {
      const node = createTestNode()
      const trace = createTestTrace({ nodes: [node], edges: [] })

      const output = visualizer.toD3Tree(trace)
      expect(output.root.name).toBe(node.name)
      expect(output.maxDepth).toBe(0)
    })
  })
})

// ============================================================================
// Convenience Function Tests
// ============================================================================

describe("convenience functions", () => {
  const trace = createTestTrace({
    nodes: [
      createTestNode({ id: "n1", name: "Node 1" }),
      createTestNode({ id: "n2", name: "Node 2" }),
    ],
    edges: [createTestEdge("n1", "n2")],
  })

  it("toMermaidFlowchart returns diagram string", () => {
    const diagram = toMermaidFlowchart(trace)
    expect(typeof diagram).toBe("string")
    expect(diagram).toContain("flowchart")
  })

  it("toMermaidSequence returns diagram string", () => {
    const diagram = toMermaidSequence(trace)
    expect(typeof diagram).toBe("string")
    expect(diagram).toContain("sequenceDiagram")
  })

  it("toMermaidGantt returns diagram string", () => {
    const diagram = toMermaidGantt(trace)
    expect(typeof diagram).toBe("string")
    expect(diagram).toContain("gantt")
  })

  it("toD3Force returns force output", () => {
    const output = toD3Force(trace)
    expect(output.format).toBe("d3-force")
    expect(output.nodes).toBeDefined()
    expect(output.links).toBeDefined()
  })

  it("toHtmlReport returns HTML string", () => {
    const html = toHtmlReport(trace)
    expect(typeof html).toBe("string")
    expect(html).toContain("<!DOCTYPE html>")
  })

  it("calculateTraceStatistics returns statistics", () => {
    const stats = calculateTraceStatistics(trace)
    expect(stats.nodesByType).toBeDefined()
    expect(stats.totalDurationMs).toBeDefined()
  })
})
