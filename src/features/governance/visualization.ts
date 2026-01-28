/**
 * Trace Visualization
 *
 * Provides multiple visualization formats for execution traces:
 * - Mermaid diagrams (flowchart, sequence, gantt)
 * - D3.js compatible data (force, tree, timeline)
 * - HTML reports with statistics
 *
 * @see docs/governance-orchestration-design.md Section 2.3
 */

import type {
  ExecutionTrace,
  TraceNode,
  TraceEdge,
  CompressedTrace,
  GovernanceBlock,
} from "./tracer-types"
import type {
  VisualizationFormat,
  VisualizationConfig,
  AnyVisualizationOutput,
  MermaidFlowchartOutput,
  MermaidSequenceOutput,
  MermaidGanttOutput,
  D3ForceOutput,
  D3ForceNode,
  D3ForceLink,
  D3TreeOutput,
  D3TreeNode,
  D3TimelineOutput,
  D3TimelineEvent,
  HtmlReportOutput,
  JsonSummaryOutput,
  TraceStatistics,
  GovernanceSummary,
  ReportSection,
} from "./visualization-types"
import {
  DEFAULT_VISUALIZATION_CONFIG,
  NODE_TYPE_COLORS,
  NODE_STATUS_COLORS,
  EDGE_TYPE_COLORS,
} from "./visualization-types"

// ============================================================================
// Trace Visualizer
// ============================================================================

/**
 * Main trace visualizer class
 */
export class TraceVisualizer {
  private config: VisualizationConfig

  constructor(config: Partial<VisualizationConfig> = {}) {
    this.config = {
      ...DEFAULT_VISUALIZATION_CONFIG,
      ...config,
      mermaid: { ...DEFAULT_VISUALIZATION_CONFIG.mermaid, ...config.mermaid },
      d3: { ...DEFAULT_VISUALIZATION_CONFIG.d3, ...config.d3 },
      report: { ...DEFAULT_VISUALIZATION_CONFIG.report, ...config.report },
      compression: { ...DEFAULT_VISUALIZATION_CONFIG.compression, ...config.compression },
    }
  }

  // ===========================================================================
  // Main Export Methods
  // ===========================================================================

  /**
   * Export trace to specified format
   */
  export(
    trace: ExecutionTrace | CompressedTrace,
    format?: VisualizationFormat
  ): AnyVisualizationOutput {
    const fmt = format || this.config.defaultFormat

    switch (fmt) {
      case "mermaid-flowchart":
        return this.toMermaidFlowchart(trace)
      case "mermaid-sequence":
        return this.toMermaidSequence(trace)
      case "mermaid-gantt":
        return this.toMermaidGantt(trace)
      case "d3-force":
        return this.toD3Force(trace)
      case "d3-tree":
        return this.toD3Tree(trace)
      case "d3-timeline":
        return this.toD3Timeline(trace)
      case "html-report":
        return this.toHtmlReport(trace)
      case "json-summary":
        return this.toJsonSummary(trace)
      default:
        throw new Error(`Unsupported format: ${fmt}`)
    }
  }

  // ===========================================================================
  // Mermaid Exports
  // ===========================================================================

  /**
   * Export to Mermaid flowchart
   */
  toMermaidFlowchart(trace: ExecutionTrace | CompressedTrace): MermaidFlowchartOutput {
    const nodes = this.getNodes(trace)
    const edges = this.getEdges(trace)
    const direction = this.config.mermaid.flowchartDirection

    const lines: string[] = [`flowchart ${direction}`]

    // Add nodes
    for (const node of nodes) {
      const label = this.truncateLabel(this.getNodeLabel(node))
      const shape = this.getNodeShape(node)
      const style = this.getNodeStyle(node)

      lines.push(`    ${node.id}${shape.open}"${label}"${shape.close}`)
      if (style) {
        lines.push(`    style ${node.id} ${style}`)
      }
    }

    // Add edges
    for (const edge of edges) {
      const arrow = this.getEdgeArrow(edge)
      const label = edge.trigger?.details ? `|${edge.trigger.details}|` : ""
      lines.push(`    ${edge.from} ${arrow}${label} ${edge.to}`)
    }

    return {
      format: "mermaid-flowchart",
      generatedAt: Date.now(),
      traceId: this.getTraceId(trace),
      compressed: this.isCompressed(trace),
      diagram: lines.join("\n"),
      direction,
      nodeCount: nodes.length,
      edgeCount: edges.length,
    }
  }

  /**
   * Export to Mermaid sequence diagram
   */
  toMermaidSequence(trace: ExecutionTrace | CompressedTrace): MermaidSequenceOutput {
    const nodes = this.getNodes(trace)
    const edges = this.getEdges(trace)

    // Collect participants from nodes
    const participants = new Set<string>()
    for (const node of nodes) {
      participants.add(node.type)
    }

    const lines: string[] = ["sequenceDiagram"]

    // Add participants
    for (const participant of participants) {
      lines.push(`    participant ${participant}`)
    }

    // Add messages based on edges
    let messageCount = 0
    for (const edge of edges) {
      const fromNode = nodes.find((n) => n.id === edge.from)
      const toNode = nodes.find((n) => n.id === edge.to)

      if (fromNode && toNode) {
        const arrow = edge.type === "data-flow" ? "->>" : "->"
        const label = edge.trigger?.details || edge.type
        lines.push(`    ${fromNode.type}${arrow}${toNode.type}: ${label}`)
        messageCount++
      }
    }

    return {
      format: "mermaid-sequence",
      generatedAt: Date.now(),
      traceId: this.getTraceId(trace),
      compressed: this.isCompressed(trace),
      diagram: lines.join("\n"),
      participants: Array.from(participants),
      messageCount,
    }
  }

  /**
   * Export to Mermaid Gantt chart
   */
  toMermaidGantt(trace: ExecutionTrace | CompressedTrace): MermaidGanttOutput {
    const nodes = this.getNodes(trace)
    const traceStart = this.getTraceStart(trace)

    // Group nodes by type
    const nodesByType = new Map<string, TraceNode[]>()
    for (const node of nodes) {
      const type = node.type
      if (!nodesByType.has(type)) {
        nodesByType.set(type, [])
      }
      nodesByType.get(type)!.push(node)
    }

    const lines: string[] = [
      "gantt",
      "    dateFormat X",
      "    axisFormat %H:%M:%S",
      `    title Execution Timeline`,
    ]

    let totalDuration = 0

    for (const [type, typeNodes] of nodesByType) {
      lines.push(`    section ${type}`)

      for (const node of typeNodes) {
        const start = node.timing.startedAt - traceStart
        const duration = node.timing.durationMs || 1
        const status = node.status === "failed" ? "crit," : node.status === "suspended" ? "done," : ""

        totalDuration = Math.max(totalDuration, start + duration)
        lines.push(`    ${this.truncateLabel(node.name)} :${status}${node.id}, ${start}, ${duration}ms`)
      }
    }

    return {
      format: "mermaid-gantt",
      generatedAt: Date.now(),
      traceId: this.getTraceId(trace),
      compressed: this.isCompressed(trace),
      diagram: lines.join("\n"),
      sections: Array.from(nodesByType.keys()),
      taskCount: nodes.length,
      totalDurationMs: totalDuration,
    }
  }

  // ===========================================================================
  // D3.js Exports
  // ===========================================================================

  /**
   * Export to D3 force-directed graph
   */
  toD3Force(trace: ExecutionTrace | CompressedTrace): D3ForceOutput {
    const nodes = this.getNodes(trace)
    const edges = this.getEdges(trace)

    // Create D3 nodes
    const d3Nodes: D3ForceNode[] = nodes.map((node, index) => ({
      id: node.id,
      label: node.name,
      type: node.type,
      status: node.status,
      group: this.getTypeGroup(node.type),
      size: this.calculateNodeSize(node),
      duration: node.timing.durationMs,
      data: {
        id: node.id,
        type: node.type,
        name: node.name,
        status: node.status,
        timing: node.timing,
      },
    }))

    // Create D3 links
    const d3Links: D3ForceLink[] = edges.map((edge) => ({
      source: edge.from,
      target: edge.to,
      type: edge.type,
      weight: edge.type === "data-flow" ? 2 : 1,
    }))

    return {
      format: "d3-force",
      generatedAt: Date.now(),
      traceId: this.getTraceId(trace),
      compressed: this.isCompressed(trace),
      nodes: d3Nodes,
      links: d3Links,
    }
  }

  /**
   * Export to D3 tree structure
   */
  toD3Tree(trace: ExecutionTrace | CompressedTrace): D3TreeOutput {
    const nodes = this.getNodes(trace)
    const edges = this.getEdges(trace)

    // Build parent-child relationships
    const childMap = new Map<string, string[]>()
    const hasParent = new Set<string>()

    for (const edge of edges) {
      if (edge.type === "control-flow" || edge.type === "spawn") {
        if (!childMap.has(edge.from)) {
          childMap.set(edge.from, [])
        }
        childMap.get(edge.from)!.push(edge.to)
        hasParent.add(edge.to)
      }
    }

    // Find root nodes
    const roots = nodes.filter((n) => !hasParent.has(n.id))

    // Build tree recursively
    const buildTree = (node: TraceNode, depth: number): D3TreeNode => {
      const children = childMap.get(node.id) || []
      const childNodes = children
        .map((childId) => nodes.find((n) => n.id === childId))
        .filter((n): n is TraceNode => n !== undefined)

      return {
        name: node.name,
        type: node.type,
        status: node.status,
        duration: node.timing.durationMs,
        children: childNodes.length > 0 ? childNodes.map((c) => buildTree(c, depth + 1)) : undefined,
        data: {
          id: node.id,
          type: node.type,
          name: node.name,
          status: node.status,
        },
      }
    }

    // Create virtual root if multiple roots
    let root: D3TreeNode
    let maxDepth = 0

    if (roots.length === 1) {
      root = buildTree(roots[0], 0)
    } else {
      root = {
        name: "Trace",
        type: "root",
        status: "completed",
        children: roots.map((r) => buildTree(r, 1)),
      }
    }

    // Calculate max depth
    const calcDepth = (node: D3TreeNode, depth: number): number => {
      if (!node.children || node.children.length === 0) {
        return depth
      }
      return Math.max(...node.children.map((c) => calcDepth(c, depth + 1)))
    }
    maxDepth = calcDepth(root, 0)

    return {
      format: "d3-tree",
      generatedAt: Date.now(),
      traceId: this.getTraceId(trace),
      compressed: this.isCompressed(trace),
      root,
      maxDepth,
      totalNodes: nodes.length,
    }
  }

  /**
   * Export to D3 timeline
   */
  toD3Timeline(trace: ExecutionTrace | CompressedTrace): D3TimelineOutput {
    const nodes = this.getNodes(trace)
    const traceStart = this.getTraceStart(trace)

    // Assign lanes based on concurrent nodes
    const lanes: string[] = []
    const nodeToLane = new Map<string, number>()

    // Sort by start time
    const sortedNodes = [...nodes].sort((a, b) => a.timing.startedAt - b.timing.startedAt)

    // Greedy lane assignment
    const laneEndTimes: number[] = []

    for (const node of sortedNodes) {
      const start = node.timing.startedAt
      let lane = laneEndTimes.findIndex((endTime) => endTime <= start)

      if (lane === -1) {
        lane = laneEndTimes.length
        laneEndTimes.push(0)
        lanes.push(`Lane ${lane + 1}`)
      }

      nodeToLane.set(node.id, lane)
      laneEndTimes[lane] = node.timing.endedAt || start + (node.timing.durationMs || 0)
    }

    // Create timeline events
    const events: D3TimelineEvent[] = nodes.map((node) => ({
      id: node.id,
      label: node.name,
      start: node.timing.startedAt - traceStart,
      end: (node.timing.endedAt || node.timing.startedAt + (node.timing.durationMs || 0)) - traceStart,
      type: node.type,
      status: node.status,
      lane: nodeToLane.get(node.id) || 0,
      color: NODE_TYPE_COLORS[node.type] || "#9E9E9E",
    }))

    const endTime = Math.max(...events.map((e) => e.end))

    return {
      format: "d3-timeline",
      generatedAt: Date.now(),
      traceId: this.getTraceId(trace),
      compressed: this.isCompressed(trace),
      events,
      lanes,
      timeRange: {
        start: 0,
        end: endTime,
        duration: endTime,
      },
    }
  }

  // ===========================================================================
  // Report Exports
  // ===========================================================================

  /**
   * Export to HTML report
   */
  toHtmlReport(trace: ExecutionTrace | CompressedTrace): HtmlReportOutput {
    const statistics = this.calculateStatistics(trace)
    const governance = this.calculateGovernanceSummary(trace)
    const sections: ReportSection[] = []

    // Summary section
    sections.push({
      title: "Summary",
      type: "summary",
      content: this.generateSummaryHtml(trace, statistics, governance),
    })

    // Statistics section
    sections.push({
      title: "Statistics",
      type: "stats",
      content: statistics,
    })

    // Diagrams section
    if (this.config.report.includeDiagrams) {
      const flowchart = this.toMermaidFlowchart(trace)
      sections.push({
        title: "Execution Flow",
        type: "diagram",
        content: flowchart.diagram,
      })
    }

    // Timeline section
    if (this.config.report.includeTimeline) {
      const gantt = this.toMermaidGantt(trace)
      sections.push({
        title: "Timeline",
        type: "timeline",
        content: gantt.diagram,
      })
    }

    // Node details table
    sections.push({
      title: "Node Details",
      type: "table",
      content: this.generateNodeTableHtml(trace),
    })

    // Generate full HTML
    const html = this.generateFullHtml(trace, sections, statistics, governance)

    return {
      format: "html-report",
      generatedAt: Date.now(),
      traceId: this.getTraceId(trace),
      compressed: this.isCompressed(trace),
      title: `Trace Report: ${this.getTraceId(trace)}`,
      sections,
      html,
      statistics,
      governance,
    }
  }

  /**
   * Export to JSON summary
   */
  toJsonSummary(trace: ExecutionTrace | CompressedTrace): JsonSummaryOutput {
    const nodes = this.getNodes(trace)
    const statistics = this.calculateStatistics(trace)
    const governance = this.calculateGovernanceSummary(trace)

    // Find critical path (longest duration chain)
    const criticalPath = this.findCriticalPath(trace)

    // Top-level nodes
    const topLevelNodes = nodes.slice(0, 10).map((node) => ({
      id: node.id,
      name: node.name,
      type: node.type,
      status: node.status,
      durationMs: node.timing.durationMs,
    }))

    return {
      format: "json-summary",
      generatedAt: Date.now(),
      traceId: this.getTraceId(trace),
      compressed: this.isCompressed(trace),
      metadata: {
        traceId: this.getTraceId(trace),
        sessionId: this.getSessionId(trace),
        startedAt: this.getTraceStart(trace),
        endedAt: this.getTraceEnd(trace),
        durationMs: statistics.totalDurationMs,
      },
      statistics,
      governance,
      criticalPath,
      topLevelNodes,
    }
  }

  // ===========================================================================
  // Statistics Calculation
  // ===========================================================================

  /**
   * Calculate trace statistics
   */
  calculateStatistics(trace: ExecutionTrace | CompressedTrace): TraceStatistics {
    const nodes = this.getNodes(trace)
    const edges = this.getEdges(trace)

    // Node counts by type
    const nodesByType: Record<string, number> = {}
    const nodesByStatus: Record<string, number> = {}
    const edgesByType: Record<string, number> = {}

    let totalTokens = 0
    let totalApiCalls = 0
    let totalDuration = 0
    let maxDuration = 0

    for (const node of nodes) {
      nodesByType[node.type] = (nodesByType[node.type] || 0) + 1
      nodesByStatus[node.status] = (nodesByStatus[node.status] || 0) + 1

      if (node.resources) {
        totalTokens += node.resources.tokensUsed || 0
        totalApiCalls += node.resources.apiCalls || 0
      }

      const duration = node.timing.durationMs || 0
      totalDuration += duration
      maxDuration = Math.max(maxDuration, duration)
    }

    for (const edge of edges) {
      edgesByType[edge.type] = (edgesByType[edge.type] || 0) + 1
    }

    const avgDuration = nodes.length > 0 ? totalDuration / nodes.length : 0
    const criticalPath = this.findCriticalPath(trace)

    // Calculate parallelism factor
    const timeline = this.toD3Timeline(trace)
    const parallelismFactor = timeline.lanes.length

    return {
      totalDurationMs: this.getTraceEnd(trace) - this.getTraceStart(trace),
      nodesByType,
      nodesByStatus,
      edgesByType,
      totalTokensUsed: totalTokens,
      totalApiCalls,
      avgNodeDurationMs: avgDuration,
      maxNodeDurationMs: maxDuration,
      criticalPathLength: criticalPath.length,
      parallelismFactor,
    }
  }

  /**
   * Calculate governance summary
   */
  calculateGovernanceSummary(trace: ExecutionTrace | CompressedTrace): GovernanceSummary {
    const nodes = this.getNodes(trace)

    let approvalGatesTriggered = 0
    let approvalsGranted = 0
    let approvalsRejected = 0
    let permissionViolations = 0
    let budgetWarnings = 0
    let checkpointsCreated = 0
    let errorsEncountered = 0

    for (const node of nodes) {
      if (node.type === "decision") {
        approvalGatesTriggered++
        if (node.status === "completed") {
          approvalsGranted++
        } else if (node.status === "failed") {
          approvalsRejected++
        }
      }

      if (node.type === "checkpoint") {
        checkpointsCreated++
      }

      if (node.status === "failed") {
        errorsEncountered++
      }

      // Check for governance-related names
      if (node.name.toLowerCase().includes("permission")) {
        permissionViolations++
      }
      if (node.name.toLowerCase().includes("budget")) {
        budgetWarnings++
      }
    }

    return {
      approvalGatesTriggered,
      approvalsGranted,
      approvalsRejected,
      permissionViolations,
      budgetWarnings,
      checkpointsCreated,
      errorsEncountered,
    }
  }

  // ===========================================================================
  // Helper Methods
  // ===========================================================================

  private getNodes(trace: ExecutionTrace | CompressedTrace): TraceNode[] {
    if ("originalCount" in trace) {
      // CompressedTrace - extract nodes from mixed array
      return trace.nodes.filter((n): n is TraceNode => n.type !== "governance-block") as TraceNode[]
    }
    return trace.nodes
  }

  private getEdges(trace: ExecutionTrace | CompressedTrace): TraceEdge[] {
    if ("originalCount" in trace) {
      return trace.edges
    }
    return trace.edges
  }

  private getTraceId(trace: ExecutionTrace | CompressedTrace): string {
    if ("originalCount" in trace) {
      return "compressed"
    }
    return trace.traceId
  }

  private getSessionId(trace: ExecutionTrace | CompressedTrace): string {
    if ("originalCount" in trace) {
      return "unknown"
    }
    return trace.sessionId
  }

  private getTraceStart(trace: ExecutionTrace | CompressedTrace): number {
    if ("originalCount" in trace) {
      const nodes = this.getNodes(trace)
      return nodes.length > 0 ? Math.min(...nodes.map((n) => n.timing.startedAt)) : Date.now()
    }
    return trace.startedAt
  }

  private getTraceEnd(trace: ExecutionTrace | CompressedTrace): number {
    const nodes = this.getNodes(trace)
    if (nodes.length === 0) return Date.now()
    return Math.max(...nodes.map((n) => n.timing.endedAt || n.timing.startedAt))
  }

  private isCompressed(trace: ExecutionTrace | CompressedTrace): boolean {
    return "originalCount" in trace
  }

  private truncateLabel(label: string): string {
    const maxLen = this.config.mermaid.maxLabelLength
    if (label.length <= maxLen) return label
    return label.substring(0, maxLen - 3) + "..."
  }

  private getNodeLabel(node: TraceNode): string {
    return `${node.name} (${node.timing.durationMs || 0}ms)`
  }

  private getNodeShape(node: TraceNode): { open: string; close: string } {
    switch (node.type) {
      case "decision":
        return { open: "{", close: "}" }
      case "checkpoint":
        return { open: "[[", close: "]]" }
      case "agent":
        return { open: "((", close: "))" }
      default:
        return { open: "[", close: "]" }
    }
  }

  private getNodeStyle(node: TraceNode): string | null {
    const color = NODE_STATUS_COLORS[node.status]
    if (!color) return null
    return `fill:${color},stroke:#333,stroke-width:2px`
  }

  private getEdgeArrow(edge: TraceEdge): string {
    switch (edge.type) {
      case "data-flow":
        return "==>"
      case "spawn":
        return "-.->|spawn|"
      case "trigger":
        return "-->|trigger|"
      default:
        return "-->"
    }
  }

  private getTypeGroup(type: string): number {
    const groups: Record<string, number> = {
      hook: 0,
      tool: 1,
      agent: 2,
      decision: 3,
      checkpoint: 4,
    }
    return groups[type] ?? 5
  }

  private calculateNodeSize(node: TraceNode): number {
    const [min, max] = this.config.d3.nodeSizeRange
    const duration = node.timing.durationMs || 0

    // Scale based on duration (log scale)
    const scale = Math.log10(duration + 1) / 4
    return Math.min(max, Math.max(min, min + scale * (max - min)))
  }

  private findCriticalPath(trace: ExecutionTrace | CompressedTrace): string[] {
    const nodes = this.getNodes(trace)
    const edges = this.getEdges(trace)

    if (nodes.length === 0) return []

    // Build adjacency list
    const adj = new Map<string, string[]>()
    for (const edge of edges) {
      if (!adj.has(edge.from)) {
        adj.set(edge.from, [])
      }
      adj.get(edge.from)!.push(edge.to)
    }

    // Find longest path (by duration)
    const nodeDuration = new Map<string, number>()
    for (const node of nodes) {
      nodeDuration.set(node.id, node.timing.durationMs || 0)
    }

    // Simple DFS for critical path
    let maxPath: string[] = []
    let maxDuration = 0

    const dfs = (nodeId: string, path: string[], duration: number) => {
      path.push(nodeId)
      duration += nodeDuration.get(nodeId) || 0

      const children = adj.get(nodeId) || []
      if (children.length === 0) {
        if (duration > maxDuration) {
          maxDuration = duration
          maxPath = [...path]
        }
      } else {
        for (const child of children) {
          dfs(child, path, duration)
        }
      }

      path.pop()
    }

    // Start from nodes without parents
    const hasParent = new Set<string>()
    for (const edge of edges) {
      hasParent.add(edge.to)
    }

    for (const node of nodes) {
      if (!hasParent.has(node.id)) {
        dfs(node.id, [], 0)
      }
    }

    return maxPath
  }

  private generateSummaryHtml(
    trace: ExecutionTrace | CompressedTrace,
    stats: TraceStatistics,
    gov: GovernanceSummary
  ): string {
    return `
      <div class="summary">
        <p><strong>Trace ID:</strong> ${this.getTraceId(trace)}</p>
        <p><strong>Duration:</strong> ${stats.totalDurationMs}ms</p>
        <p><strong>Nodes:</strong> ${Object.values(stats.nodesByType).reduce((a, b) => a + b, 0)}</p>
        <p><strong>Tokens Used:</strong> ${stats.totalTokensUsed}</p>
        <p><strong>Errors:</strong> ${gov.errorsEncountered}</p>
      </div>
    `
  }

  private generateNodeTableHtml(trace: ExecutionTrace | CompressedTrace): string {
    const nodes = this.getNodes(trace)

    const rows = nodes.map(
      (node) => `
      <tr>
        <td>${node.id}</td>
        <td>${node.name}</td>
        <td>${node.type}</td>
        <td>${node.status}</td>
        <td>${node.timing.durationMs || 0}ms</td>
      </tr>
    `
    )

    return `
      <table>
        <thead>
          <tr>
            <th>ID</th>
            <th>Name</th>
            <th>Type</th>
            <th>Status</th>
            <th>Duration</th>
          </tr>
        </thead>
        <tbody>
          ${rows.join("")}
        </tbody>
      </table>
    `
  }

  private generateFullHtml(
    trace: ExecutionTrace | CompressedTrace,
    sections: ReportSection[],
    stats: TraceStatistics,
    gov: GovernanceSummary
  ): string {
    const theme = this.config.report.cssTheme
    const bgColor = theme === "dark" ? "#1e1e1e" : "#ffffff"
    const textColor = theme === "dark" ? "#ffffff" : "#333333"

    const sectionHtml = sections
      .map(
        (section) => `
      <section>
        <h2>${section.title}</h2>
        ${typeof section.content === "string" ? section.content : `<pre>${JSON.stringify(section.content, null, 2)}</pre>`}
      </section>
    `
      )
      .join("")

    return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Trace Report: ${this.getTraceId(trace)}</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      margin: 0;
      padding: 20px;
      background: ${bgColor};
      color: ${textColor};
    }
    h1 { border-bottom: 2px solid #4CAF50; padding-bottom: 10px; }
    h2 { color: #4CAF50; }
    section { margin: 20px 0; padding: 15px; border: 1px solid #ddd; border-radius: 8px; }
    table { width: 100%; border-collapse: collapse; }
    th, td { padding: 8px; text-align: left; border-bottom: 1px solid #ddd; }
    th { background: #f5f5f5; }
    pre { background: #f5f5f5; padding: 10px; overflow-x: auto; border-radius: 4px; }
    .summary p { margin: 5px 0; }
  </style>
</head>
<body>
  <h1>Execution Trace Report</h1>
  ${sectionHtml}
  <footer>
    <p>Generated at ${new Date().toISOString()}</p>
  </footer>
</body>
</html>
    `.trim()
  }
}

// ============================================================================
// Convenience Functions
// ============================================================================

/**
 * Quick export to Mermaid flowchart
 */
export function toMermaidFlowchart(trace: ExecutionTrace | CompressedTrace): string {
  const visualizer = new TraceVisualizer()
  return visualizer.toMermaidFlowchart(trace).diagram
}

/**
 * Quick export to Mermaid sequence diagram
 */
export function toMermaidSequence(trace: ExecutionTrace | CompressedTrace): string {
  const visualizer = new TraceVisualizer()
  return visualizer.toMermaidSequence(trace).diagram
}

/**
 * Quick export to Mermaid Gantt chart
 */
export function toMermaidGantt(trace: ExecutionTrace | CompressedTrace): string {
  const visualizer = new TraceVisualizer()
  return visualizer.toMermaidGantt(trace).diagram
}

/**
 * Quick export to D3 force graph
 */
export function toD3Force(trace: ExecutionTrace | CompressedTrace): D3ForceOutput {
  const visualizer = new TraceVisualizer()
  return visualizer.toD3Force(trace)
}

/**
 * Quick export to HTML report
 */
export function toHtmlReport(trace: ExecutionTrace | CompressedTrace): string {
  const visualizer = new TraceVisualizer()
  return visualizer.toHtmlReport(trace).html
}

/**
 * Quick calculate statistics
 */
export function calculateTraceStatistics(trace: ExecutionTrace | CompressedTrace): TraceStatistics {
  const visualizer = new TraceVisualizer()
  return visualizer.calculateStatistics(trace)
}
