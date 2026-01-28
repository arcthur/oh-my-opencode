/**
 * Execution Tracer
 *
 * Automatically instruments hook/tool execution to build
 * observable execution traces. Supports causal compression
 * for visualization and debugging.
 */

import type {
  ExecutionTrace,
  TraceNode,
  TraceEdge,
  TraceEvent,
  TraceMetrics,
  TraceNodeType,
  TraceNodeStatus,
  TraceResources,
  TraceError,
  EdgeTrigger,
  CompressedTrace,
  GovernanceBlock,
  CriticalPathTrace,
  CriticalityReason,
  TraceVisualization,
  MermaidDiagram,
  TracerConfig,
  CompressionRules,
} from "./tracer-types"
import { DEFAULT_TRACER_CONFIG, DEFAULT_COMPRESSION_RULES } from "./tracer-types"
import { SuspendException } from "./suspend-exception"
import { generateId, sanitizeData as sharedSanitizeData } from "./utils"

/**
 * Execution Tracer
 *
 * Traces hook and tool execution to build an observable graph.
 */
export class ExecutionTracer {
  private trace: ExecutionTrace
  private nodeStack: string[] = []
  private config: TracerConfig

  // Data-flow inference: track which nodes write to which keys
  private stateWriters = new Map<string, { nodeId: string; timestamp: number }>()
  // Track proposal sources for data-flow inference
  private proposalSources = new Map<string, { nodeId: string; timestamp: number }>()

  constructor(sessionId: string, config: Partial<TracerConfig> = {}) {
    this.config = { ...DEFAULT_TRACER_CONFIG, ...config }

    this.trace = {
      traceId: generateId(),
      sessionId,
      startedAt: Date.now(),
      nodes: [],
      edges: [],
      timeline: [],
      metrics: this.initMetrics(),
    }
  }

  // ===========================================================================
  // Core Tracing API
  // ===========================================================================

  /**
   * Start a new trace node
   */
  startNode(params: {
    type: TraceNodeType
    name: string
    inputs?: Record<string, unknown>
    parentId?: string
    tags?: Record<string, string>
  }): string {
    const nodeId = generateId()
    const now = Date.now()

    const node: TraceNode = {
      id: nodeId,
      type: params.type,
      name: params.name,
      timing: { startedAt: now },
      inputs: this.sanitizeData(params.inputs ?? {}),
      resources: {},
      status: "running",
      parentId: params.parentId ?? this.getCurrentParentId(),
      tags: params.tags,
    }

    this.trace.nodes.push(node)
    this.addTimelineEvent("node-start", nodeId, { name: params.name, type: params.type })

    // Create control-flow edge from parent
    if (this.nodeStack.length > 0) {
      this.addEdge({
        from: this.nodeStack[this.nodeStack.length - 1],
        to: nodeId,
        type: "control-flow",
        trigger: { type: "explicit" },
      })
    }

    this.nodeStack.push(nodeId)
    this.updateMetrics()

    return nodeId
  }

  /**
   * End a trace node
   */
  endNode(
    nodeId: string,
    result: {
      status: TraceNodeStatus
      outputs?: Record<string, unknown>
      error?: TraceError
      resources?: Partial<TraceResources>
    }
  ): void {
    const node = this.findNode(nodeId)
    if (!node) return

    const now = Date.now()
    node.timing.endedAt = now
    node.timing.durationMs = now - node.timing.startedAt
    node.status = result.status
    node.outputs = this.sanitizeData(result.outputs ?? {})
    node.error = result.error

    if (result.resources) {
      node.resources = { ...node.resources, ...result.resources }
    }

    this.addTimelineEvent("node-end", nodeId, {
      status: result.status,
      durationMs: node.timing.durationMs,
    })

    // Pop from stack
    const stackIndex = this.nodeStack.indexOf(nodeId)
    if (stackIndex >= 0) {
      this.nodeStack.splice(stackIndex, 1)
    }

    this.updateMetrics()

    // Auto-compress if threshold reached
    if (this.trace.nodes.length >= this.config.autoCompressThreshold) {
      this.autoCompress()
    }
  }

  /**
   * Add an edge between nodes
   */
  addEdge(edge: Omit<TraceEdge, "id">): void {
    const fullEdge: TraceEdge = { ...edge }
    this.trace.edges.push(fullEdge)
    this.addTimelineEvent("edge-created", undefined, {
      from: edge.from,
      to: edge.to,
      type: edge.type,
    })
    this.updateMetrics()
  }

  /**
   * Record a state change event
   */
  recordStateChange(nodeId: string, keys: string[]): void {
    this.addTimelineEvent("state-change", nodeId, { keys })
  }

  /**
   * Record a resource warning
   */
  recordResourceWarning(nodeId: string, warning: string): void {
    this.addTimelineEvent("resource-warning", nodeId, { warning })
  }

  // ===========================================================================
  // Data-flow Inference API
  // ===========================================================================

  /**
   * Record a state write for data-flow inference
   *
   * When a node writes to a state key, we track it. If another node
   * later reads from the same key, we automatically create a data-flow edge.
   *
   * @param nodeId - The node writing state
   * @param namespace - State namespace (e.g., "session", "plugin:foo")
   * @param key - State key being written
   */
  recordStateWrite(nodeId: string, namespace: string, key: string): void {
    const fullKey = `${namespace}:${key}`
    this.stateWriters.set(fullKey, { nodeId, timestamp: Date.now() })
    this.addTimelineEvent("state-write", nodeId, { namespace, key })
  }

  /**
   * Record a state read for data-flow inference
   *
   * If a previous node wrote to this key, automatically creates a
   * data-flow edge from the writer to the reader.
   *
   * @param nodeId - The node reading state
   * @param namespace - State namespace
   * @param key - State key being read
   * @returns The writer node ID if a data-flow edge was created
   */
  recordStateRead(nodeId: string, namespace: string, key: string): string | undefined {
    const fullKey = `${namespace}:${key}`
    const writer = this.stateWriters.get(fullKey)

    if (writer && writer.nodeId !== nodeId) {
      // Create data-flow edge from writer to reader
      this.addEdge({
        from: writer.nodeId,
        to: nodeId,
        type: "data-flow",
        trigger: { type: "state-dependency", key: fullKey },
        data: { key: fullKey, writerTimestamp: writer.timestamp },
      })

      this.addTimelineEvent("state-read", nodeId, {
        namespace,
        key,
        inferredEdgeFrom: writer.nodeId,
      })

      return writer.nodeId
    }

    this.addTimelineEvent("state-read", nodeId, { namespace, key })
    return undefined
  }

  /**
   * Record a proposal submission for data-flow inference
   *
   * StateProposals create potential data-flow when another hook
   * consumes the proposed state after it's applied.
   *
   * @param nodeId - The node submitting the proposal
   * @param proposalId - Proposal ID
   * @param namespace - Target namespace
   * @param key - Target key
   */
  recordProposalSubmit(nodeId: string, proposalId: string, namespace: string, key: string): void {
    const fullKey = `proposal:${namespace}:${key}`
    this.proposalSources.set(proposalId, { nodeId, timestamp: Date.now() })

    // Also track as a potential state write for when proposal is applied
    this.stateWriters.set(fullKey, { nodeId, timestamp: Date.now() })

    this.addTimelineEvent("proposal-submit", nodeId, { proposalId, namespace, key })
  }

  /**
   * Record when a proposal is applied
   *
   * Promotes the proposal's target key to regular state,
   * so subsequent reads will create data-flow edges.
   *
   * @param proposalId - The applied proposal
   * @param namespace - Target namespace
   * @param key - Target key
   */
  recordProposalApplied(proposalId: string, namespace: string, key: string): void {
    const source = this.proposalSources.get(proposalId)
    if (source) {
      // Promote to regular state key tracking
      const fullKey = `${namespace}:${key}`
      this.stateWriters.set(fullKey, source)

      this.addTimelineEvent("proposal-applied", source.nodeId, {
        proposalId,
        namespace,
        key,
      })
    }
  }

  /**
   * Record a file dependency for data-flow inference
   *
   * Used by checkpoint system to track file read/write dependencies.
   *
   * @param readerNodeId - Node that reads the file
   * @param writerNodeId - Node that wrote the file
   * @param filePath - File path
   */
  recordFileDependency(readerNodeId: string, writerNodeId: string, filePath: string): void {
    if (readerNodeId !== writerNodeId) {
      this.addEdge({
        from: writerNodeId,
        to: readerNodeId,
        type: "data-flow",
        trigger: { type: "file-dependency", path: filePath },
        data: { filePath },
      })

      this.addTimelineEvent("file-dependency", readerNodeId, {
        writerNodeId,
        filePath,
      })
    }
  }

  /**
   * Record an event emission for data-flow inference
   *
   * Events can create data-flow when another component
   * consumes/handles the event.
   *
   * @param nodeId - Node emitting the event
   * @param eventType - Event type name
   */
  recordEventEmit(nodeId: string, eventType: string): void {
    const eventKey = `event:${eventType}`
    this.stateWriters.set(eventKey, { nodeId, timestamp: Date.now() })
    this.addTimelineEvent("event-emit", nodeId, { eventType })
  }

  /**
   * Record an event consumption for data-flow inference
   *
   * If a node emitted this event type before, creates a data-flow edge.
   *
   * @param nodeId - Node consuming the event
   * @param eventType - Event type name
   * @returns The emitter node ID if a data-flow edge was created
   */
  recordEventConsume(nodeId: string, eventType: string): string | undefined {
    const eventKey = `event:${eventType}`
    const emitter = this.stateWriters.get(eventKey)

    if (emitter && emitter.nodeId !== nodeId) {
      this.addEdge({
        from: emitter.nodeId,
        to: nodeId,
        type: "data-flow",
        trigger: { type: "event", eventType },
        data: { eventType, emitterTimestamp: emitter.timestamp },
      })

      this.addTimelineEvent("event-consume", nodeId, {
        eventType,
        inferredEdgeFrom: emitter.nodeId,
      })

      return emitter.nodeId
    }

    this.addTimelineEvent("event-consume", nodeId, { eventType })
    return undefined
  }

  // ===========================================================================
  // Wrapper for automatic tracing
  // ===========================================================================

  /**
   * Wrap a hook execution with automatic tracing
   */
  async traceHook<T>(
    hookName: string,
    inputs: Record<string, unknown>,
    execute: () => Promise<T>
  ): Promise<T> {
    const nodeId = this.startNode({
      type: "hook",
      name: hookName,
      inputs,
    })

    try {
      const result = await execute()

      this.endNode(nodeId, {
        status: "completed",
        outputs: typeof result === "object" ? (result as Record<string, unknown>) : { result },
      })

      return result
    } catch (error) {
      if (SuspendException.isSuspendException(error)) {
        this.endNode(nodeId, {
          status: "suspended",
          outputs: { suspendReason: error.suspendInfo.reason },
        })
      } else {
        this.endNode(nodeId, {
          status: "failed",
          error: this.formatError(error),
        })
      }
      throw error
    }
  }

  /**
   * Wrap a tool execution with automatic tracing
   */
  async traceTool<T>(
    toolName: string,
    args: Record<string, unknown>,
    execute: () => Promise<T>
  ): Promise<T> {
    const nodeId = this.startNode({
      type: "tool",
      name: toolName,
      inputs: args,
    })

    try {
      const result = await execute()

      this.endNode(nodeId, {
        status: "completed",
        outputs: typeof result === "object" ? (result as Record<string, unknown>) : { result },
      })

      return result
    } catch (error) {
      if (SuspendException.isSuspendException(error)) {
        this.endNode(nodeId, {
          status: "suspended",
          outputs: { suspendReason: error.suspendInfo.reason },
        })
      } else {
        this.endNode(nodeId, {
          status: "failed",
          error: this.formatError(error),
        })
      }
      throw error
    }
  }

  // ===========================================================================
  // Compression
  // ===========================================================================

  /**
   * Causal compression: Merge consecutive low-impact nodes
   */
  compress(rules: CompressionRules = this.config.compression): CompressedTrace {
    const criticalNodeIds = new Set<string>()
    const lowImpactNodes: TraceNode[] = []

    // Identify critical nodes
    for (const node of this.trace.nodes) {
      if (this.isNodeCritical(node, rules)) {
        criticalNodeIds.add(node.id)
      } else {
        lowImpactNodes.push(node)
      }
    }

    // Group consecutive low-impact nodes into blocks
    const blocks: GovernanceBlock[] = []
    let currentBlock: TraceNode[] = []

    for (const node of this.trace.nodes) {
      if (criticalNodeIds.has(node.id)) {
        // Flush current block
        if (currentBlock.length >= rules.mergeThreshold) {
          blocks.push(this.createGovernanceBlock(currentBlock))
        }
        currentBlock = []
      } else {
        currentBlock.push(node)
      }
    }

    // Flush final block
    if (currentBlock.length >= rules.mergeThreshold) {
      blocks.push(this.createGovernanceBlock(currentBlock))
    }

    // Build compressed nodes list
    const blockNodeIds = new Set(blocks.flatMap((b) => b.originalNodeIds))
    const compressedNodes: (TraceNode | GovernanceBlock)[] = []

    let blockIndex = 0
    for (const node of this.trace.nodes) {
      if (criticalNodeIds.has(node.id)) {
        compressedNodes.push(node)
      } else if (!blockNodeIds.has(node.id)) {
        compressedNodes.push(node)
      } else {
        // Check if this is the first node of a block
        if (blockIndex < blocks.length && blocks[blockIndex].originalNodeIds[0] === node.id) {
          compressedNodes.push(blocks[blockIndex])
          blockIndex++
        }
      }
    }

    // Filter edges to only include visible nodes
    const visibleNodeIds = new Set(
      compressedNodes.map((n) => ("mergedCount" in n ? n.id : n.id))
    )
    const compressedEdges = this.trace.edges.filter(
      (e) => visibleNodeIds.has(e.from) || visibleNodeIds.has(e.to)
    )

    return {
      originalCount: this.trace.nodes.length,
      compressedCount: compressedNodes.length,
      ratio: compressedNodes.length / Math.max(this.trace.nodes.length, 1),
      nodes: compressedNodes,
      edges: compressedEdges,
    }
  }

  /**
   * Extract critical path only
   */
  extractCriticalPath(rules: CompressionRules = this.config.compression): CriticalPathTrace {
    const criticalNodes: TraceNode[] = []
    const criticality = new Map<string, CriticalityReason>()

    for (const node of this.trace.nodes) {
      const reason = this.getCriticalityReason(node, rules)
      if (reason) {
        criticalNodes.push(node)
        criticality.set(node.id, reason)
      }
    }

    return { nodes: criticalNodes, criticality }
  }

  // ===========================================================================
  // Export and Visualization
  // ===========================================================================

  /**
   * Export trace for visualization
   */
  exportForVisualization(): TraceVisualization {
    return {
      nodes: this.trace.nodes.map((n) => ({
        id: n.id,
        label: n.name,
        type: n.type,
        status: n.status,
        duration: n.timing.durationMs,
      })),
      edges: this.trace.edges.map((e) => ({
        source: e.from,
        target: e.to,
        type: e.type,
      })),
      timeline: this.trace.nodes.map((n) => ({
        id: n.id,
        name: n.name,
        start: n.timing.startedAt,
        end: n.timing.endedAt,
      })),
      metrics: this.trace.metrics,
    }
  }

  /**
   * Export as Mermaid flowchart
   */
  exportMermaidFlowchart(): MermaidDiagram {
    const lines: string[] = ["flowchart TD"]

    // Add nodes
    for (const node of this.trace.nodes) {
      const shape = this.getMermaidNodeShape(node.type)
      const statusClass = node.status === "failed" ? ":::error" : node.status === "suspended" ? ":::warning" : ""
      lines.push(`    ${node.id}${shape[0]}"${node.name}"${shape[1]}${statusClass}`)
    }

    // Add edges
    for (const edge of this.trace.edges) {
      const style = edge.type === "data-flow" ? "-.->|data|" : "-->"
      lines.push(`    ${edge.from} ${style} ${edge.to}`)
    }

    // Add style classes
    lines.push("")
    lines.push("    classDef error fill:#f96,stroke:#333")
    lines.push("    classDef warning fill:#ff9,stroke:#333")

    return {
      syntax: lines.join("\n"),
      type: "flowchart",
    }
  }

  /**
   * Export as Mermaid Gantt chart
   */
  exportMermaidGantt(): MermaidDiagram {
    const lines: string[] = [
      "gantt",
      "    title Execution Timeline",
      "    dateFormat x",
      "    axisFormat %H:%M:%S",
    ]

    // Group by type
    const byType = new Map<string, TraceNode[]>()
    for (const node of this.trace.nodes) {
      const group = byType.get(node.type) ?? []
      group.push(node)
      byType.set(node.type, group)
    }

    for (const [type, nodes] of byType) {
      lines.push(`    section ${type}`)
      for (const node of nodes) {
        const status = node.status === "failed" ? "crit, " : node.status === "suspended" ? "active, " : ""
        const end = node.timing.endedAt ?? Date.now()
        lines.push(`    ${node.name} :${status}${node.timing.startedAt}, ${end}`)
      }
    }

    return {
      syntax: lines.join("\n"),
      type: "gantt",
    }
  }

  // ===========================================================================
  // Accessors
  // ===========================================================================

  /**
   * Get the current trace
   */
  getTrace(): ExecutionTrace {
    return { ...this.trace }
  }

  /**
   * Get trace ID
   */
  getTraceId(): string {
    return this.trace.traceId
  }

  /**
   * Get current metrics
   */
  getMetrics(): TraceMetrics {
    return { ...this.trace.metrics }
  }

  /**
   * Get all nodes
   */
  getNodes(): TraceNode[] {
    return [...this.trace.nodes]
  }

  /**
   * Find a node by ID
   */
  findNode(nodeId: string): TraceNode | undefined {
    return this.trace.nodes.find((n) => n.id === nodeId)
  }

  /**
   * Finalize the trace
   */
  finalize(): ExecutionTrace {
    this.trace.endedAt = Date.now()
    this.updateMetrics()
    return this.getTrace()
  }

  // ===========================================================================
  // Private helpers
  // ===========================================================================

  private initMetrics(): TraceMetrics {
    return {
      totalDurationMs: 0,
      totalTokensUsed: 0,
      totalApiCalls: 0,
      nodeCount: 0,
      edgeCount: 0,
      failedNodes: 0,
      suspendedNodes: 0,
    }
  }

  private updateMetrics(): void {
    const metrics = this.trace.metrics
    metrics.nodeCount = this.trace.nodes.length
    metrics.edgeCount = this.trace.edges.length

    let totalTokens = 0
    let totalApiCalls = 0
    let failed = 0
    let suspended = 0

    for (const node of this.trace.nodes) {
      totalTokens += node.resources.tokensUsed ?? 0
      totalApiCalls += node.resources.apiCalls ?? 0
      if (node.status === "failed") failed++
      if (node.status === "suspended") suspended++
    }

    metrics.totalTokensUsed = totalTokens
    metrics.totalApiCalls = totalApiCalls
    metrics.failedNodes = failed
    metrics.suspendedNodes = suspended

    if (this.trace.nodes.length > 0) {
      const firstStart = Math.min(...this.trace.nodes.map((n) => n.timing.startedAt))
      const lastEnd = Math.max(
        ...this.trace.nodes.map((n) => n.timing.endedAt ?? n.timing.startedAt)
      )
      metrics.totalDurationMs = lastEnd - firstStart
    }
  }

  private getCurrentParentId(): string | undefined {
    return this.nodeStack.length > 0 ? this.nodeStack[this.nodeStack.length - 1] : undefined
  }

  private addTimelineEvent(
    type: TraceEvent["type"],
    nodeId: string | undefined,
    details: Record<string, unknown>
  ): void {
    this.trace.timeline.push({
      timestamp: Date.now(),
      nodeId,
      type,
      details,
    })
  }

  private sanitizeData(data: Record<string, unknown>): Record<string, unknown> {
    return sharedSanitizeData(data, { enabled: this.config.sanitizeSensitiveData })
  }

  private formatError(error: unknown): TraceError {
    if (error instanceof Error) {
      return {
        type: error.name,
        message: error.message,
        stack: error.stack,
        recoverable: false,
      }
    }
    return {
      type: "UnknownError",
      message: String(error),
      recoverable: false,
    }
  }

  private isNodeCritical(node: TraceNode, rules: CompressionRules): boolean {
    // Type-based criticality
    if (rules.alwaysCritical.includes(node.type)) return true

    // Low-impact hooks can be merged
    if (rules.lowImpactHooks.includes(node.name)) return false

    // Check for state mutations
    if (node.outputs) {
      for (const key of rules.highImpactStateKeys) {
        if (key in node.outputs) return true
      }
    }

    // Failed or suspended nodes are critical
    if (node.status === "failed" || node.status === "suspended") return true

    return false
  }

  private getCriticalityReason(node: TraceNode, rules: CompressionRules): CriticalityReason | null {
    if (node.type === "decision") {
      return { type: "llm-decision", decision: node.name }
    }

    if (node.type === "checkpoint") {
      return { type: "checkpoint", checkpointId: node.id }
    }

    if (node.status === "failed" && node.error) {
      return { type: "error", error: node.error.message }
    }

    if (node.outputs) {
      const mutatedKeys = rules.highImpactStateKeys.filter((k) => k in node.outputs!)
      if (mutatedKeys.length > 0) {
        return { type: "state-mutation", keys: mutatedKeys }
      }
    }

    if (node.name.includes("approval") || node.tags?.approval) {
      const action = node.outputs?.decision as "approved" | "rejected" | undefined
      if (action) {
        return { type: "approval-gate", action }
      }
    }

    return null
  }

  private createGovernanceBlock(nodes: TraceNode[]): GovernanceBlock {
    const totalResources = {
      tokensUsed: 0,
      apiCalls: 0,
    }

    for (const node of nodes) {
      totalResources.tokensUsed += node.resources.tokensUsed ?? 0
      totalResources.apiCalls += node.resources.apiCalls ?? 0
    }

    const start = Math.min(...nodes.map((n) => n.timing.startedAt))
    const end = Math.max(...nodes.map((n) => n.timing.endedAt ?? n.timing.startedAt))

    // Generate summary
    const types = [...new Set(nodes.map((n) => n.type))]
    const summary = `${nodes.length} ${types.join("/")} operations`

    return {
      type: "governance-block",
      id: `block-${generateId()}`,
      mergedCount: nodes.length,
      timeSpan: { start, end },
      summary,
      totalResources,
      originalNodeIds: nodes.map((n) => n.id),
    }
  }

  private getMermaidNodeShape(type: TraceNodeType): [string, string] {
    switch (type) {
      case "hook":
        return ["[", "]"]
      case "tool":
        return ["[[", "]]"]
      case "agent":
        return ["((", "))"]
      case "decision":
        return ["{", "}"]
      case "checkpoint":
        return ["([", "])"]
      default:
        return ["[", "]"]
    }
  }

  private autoCompress(): void {
    // Simple auto-compression: just reset old events
    // A more sophisticated implementation would persist to disk
    if (this.trace.timeline.length > this.config.maxNodes * 2) {
      this.trace.timeline = this.trace.timeline.slice(-this.config.maxNodes)
    }
  }
}

// =============================================================================
// Tracer Manager (handles multiple sessions)
// =============================================================================

/**
 * Manages tracers across multiple sessions
 */
export class TracerManager {
  private tracers = new Map<string, ExecutionTracer>()
  private config: Partial<TracerConfig>

  constructor(config: Partial<TracerConfig> = {}) {
    this.config = config
  }

  /**
   * Get or create a tracer for a session
   */
  getTracer(sessionId: string): ExecutionTracer {
    let tracer = this.tracers.get(sessionId)
    if (!tracer) {
      tracer = new ExecutionTracer(sessionId, this.config)
      this.tracers.set(sessionId, tracer)
    }
    return tracer
  }

  /**
   * Check if a session has a tracer
   */
  hasTracer(sessionId: string): boolean {
    return this.tracers.has(sessionId)
  }

  /**
   * Finalize and remove a tracer
   */
  finalizeTracer(sessionId: string): ExecutionTrace | undefined {
    const tracer = this.tracers.get(sessionId)
    if (tracer) {
      const trace = tracer.finalize()
      this.tracers.delete(sessionId)
      return trace
    }
    return undefined
  }

  /**
   * List all active session IDs
   */
  listSessions(): string[] {
    return Array.from(this.tracers.keys())
  }
}

// =============================================================================
// Global instance
// =============================================================================

let globalManager: TracerManager | undefined

/**
 * Get the global tracer manager
 */
export function getTracerManager(config?: Partial<TracerConfig>): TracerManager {
  if (!globalManager) {
    globalManager = new TracerManager(config)
  }
  return globalManager
}

/**
 * Reset the global tracer manager (for testing)
 */
export function resetTracerManager(): void {
  globalManager = undefined
}
