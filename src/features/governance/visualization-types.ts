/**
 * Trace Visualization Types
 *
 * Type definitions for trace visualization and reporting.
 * Supports multiple output formats: Mermaid, D3.js, Gantt, HTML.
 *
 * @see docs/research/governance-orchestration-design.md Section 2.3
 */

import type { TraceNode, TraceEdge, ExecutionTrace, CompressedTrace } from "./tracer-types"

// ============================================================================
// Visualization Format Types
// ============================================================================

/**
 * Supported visualization formats
 */
export type VisualizationFormat =
  | "mermaid-flowchart"
  | "mermaid-sequence"
  | "mermaid-gantt"
  | "d3-force"
  | "d3-tree"
  | "d3-timeline"
  | "html-report"
  | "json-summary"

/**
 * Base visualization output
 */
export interface VisualizationOutput {
  /** Format type */
  format: VisualizationFormat

  /** Generated at timestamp */
  generatedAt: number

  /** Source trace ID */
  traceId: string

  /** Whether compressed */
  compressed: boolean
}

// ============================================================================
// Mermaid Types
// ============================================================================

/**
 * Mermaid flowchart output
 */
export interface MermaidFlowchartOutput extends VisualizationOutput {
  format: "mermaid-flowchart"

  /** Mermaid diagram code */
  diagram: string

  /** Flowchart direction */
  direction: "TB" | "BT" | "LR" | "RL"

  /** Node count */
  nodeCount: number

  /** Edge count */
  edgeCount: number
}

/**
 * Mermaid sequence diagram output
 */
export interface MermaidSequenceOutput extends VisualizationOutput {
  format: "mermaid-sequence"

  /** Mermaid diagram code */
  diagram: string

  /** Participants */
  participants: string[]

  /** Message count */
  messageCount: number
}

/**
 * Mermaid Gantt chart output
 */
export interface MermaidGanttOutput extends VisualizationOutput {
  format: "mermaid-gantt"

  /** Mermaid diagram code */
  diagram: string

  /** Section names */
  sections: string[]

  /** Task count */
  taskCount: number

  /** Total duration (ms) */
  totalDurationMs: number
}

// ============================================================================
// D3.js Types
// ============================================================================

/**
 * D3 force-directed graph node
 */
export interface D3ForceNode {
  /** Node ID */
  id: string

  /** Display label */
  label: string

  /** Node type */
  type: string

  /** Node status */
  status: string

  /** Group for coloring */
  group: number

  /** Node size (based on importance) */
  size: number

  /** Duration in ms */
  duration?: number

  /** Original trace node */
  data: Partial<TraceNode>
}

/**
 * D3 force-directed graph link
 */
export interface D3ForceLink {
  /** Source node ID */
  source: string

  /** Target node ID */
  target: string

  /** Link type */
  type: string

  /** Link weight (for layout) */
  weight: number
}

/**
 * D3 force-directed graph output
 */
export interface D3ForceOutput extends VisualizationOutput {
  format: "d3-force"

  /** Graph nodes */
  nodes: D3ForceNode[]

  /** Graph links */
  links: D3ForceLink[]
}

/**
 * D3 tree node
 */
export interface D3TreeNode {
  /** Node name */
  name: string

  /** Node type */
  type: string

  /** Node status */
  status: string

  /** Duration in ms */
  duration?: number

  /** Children nodes */
  children?: D3TreeNode[]

  /** Original data */
  data?: Partial<TraceNode>
}

/**
 * D3 tree output
 */
export interface D3TreeOutput extends VisualizationOutput {
  format: "d3-tree"

  /** Root node */
  root: D3TreeNode

  /** Max depth */
  maxDepth: number

  /** Total nodes */
  totalNodes: number
}

/**
 * D3 timeline event
 */
export interface D3TimelineEvent {
  /** Event ID */
  id: string

  /** Event label */
  label: string

  /** Start time (ms from trace start) */
  start: number

  /** End time (ms from trace start) */
  end: number

  /** Event type */
  type: string

  /** Event status */
  status: string

  /** Lane/row for display */
  lane: number

  /** Color category */
  color: string
}

/**
 * D3 timeline output
 */
export interface D3TimelineOutput extends VisualizationOutput {
  format: "d3-timeline"

  /** Timeline events */
  events: D3TimelineEvent[]

  /** Lanes (parallel tracks) */
  lanes: string[]

  /** Time range */
  timeRange: {
    start: number
    end: number
    duration: number
  }
}

// ============================================================================
// Report Types
// ============================================================================

/**
 * Trace statistics
 */
export interface TraceStatistics {
  /** Total duration (ms) */
  totalDurationMs: number

  /** Node counts by type */
  nodesByType: Record<string, number>

  /** Node counts by status */
  nodesByStatus: Record<string, number>

  /** Edge counts by type */
  edgesByType: Record<string, number>

  /** Total tokens used */
  totalTokensUsed: number

  /** Total API calls */
  totalApiCalls: number

  /** Average node duration (ms) */
  avgNodeDurationMs: number

  /** Max node duration (ms) */
  maxNodeDurationMs: number

  /** Critical path length */
  criticalPathLength: number

  /** Parallelism factor (concurrent nodes) */
  parallelismFactor: number
}

/**
 * Governance summary
 */
export interface GovernanceSummary {
  /** Approval gates triggered */
  approvalGatesTriggered: number

  /** Approvals granted */
  approvalsGranted: number

  /** Approvals rejected */
  approvalsRejected: number

  /** Permission violations */
  permissionViolations: number

  /** Budget warnings */
  budgetWarnings: number

  /** Checkpoints created */
  checkpointsCreated: number

  /** Errors encountered */
  errorsEncountered: number
}

/**
 * HTML report section
 */
export interface ReportSection {
  /** Section title */
  title: string

  /** Section type */
  type: "summary" | "diagram" | "table" | "timeline" | "stats"

  /** Section content (HTML or data) */
  content: string | unknown
}

/**
 * HTML report output
 */
export interface HtmlReportOutput extends VisualizationOutput {
  format: "html-report"

  /** Report title */
  title: string

  /** Report sections */
  sections: ReportSection[]

  /** Full HTML content */
  html: string

  /** Statistics */
  statistics: TraceStatistics

  /** Governance summary */
  governance: GovernanceSummary
}

/**
 * JSON summary output
 */
export interface JsonSummaryOutput extends VisualizationOutput {
  format: "json-summary"

  /** Trace metadata */
  metadata: {
    traceId: string
    sessionId: string
    startedAt: number
    endedAt?: number
    durationMs: number
  }

  /** Statistics */
  statistics: TraceStatistics

  /** Governance summary */
  governance: GovernanceSummary

  /** Critical path node IDs */
  criticalPath: string[]

  /** Top-level nodes */
  topLevelNodes: Array<{
    id: string
    name: string
    type: string
    status: string
    durationMs?: number
  }>
}

/**
 * Union type for all visualization outputs
 * Use this when accepting any visualization output type
 */
export type AnyVisualizationOutput =
  | MermaidFlowchartOutput
  | MermaidSequenceOutput
  | MermaidGanttOutput
  | D3ForceOutput
  | D3TreeOutput
  | D3TimelineOutput
  | HtmlReportOutput
  | JsonSummaryOutput

// ============================================================================
// Configuration
// ============================================================================

/**
 * Visualization configuration
 */
export interface VisualizationConfig {
  /** Default format */
  defaultFormat: VisualizationFormat

  /** Mermaid settings */
  mermaid: {
    /** Flowchart direction */
    flowchartDirection: "TB" | "BT" | "LR" | "RL"

    /** Theme */
    theme: "default" | "forest" | "dark" | "neutral"

    /** Max label length */
    maxLabelLength: number
  }

  /** D3 settings */
  d3: {
    /** Force graph charge strength */
    chargeStrength: number

    /** Link distance */
    linkDistance: number

    /** Node size range */
    nodeSizeRange: [number, number]
  }

  /** Report settings */
  report: {
    /** Include diagrams */
    includeDiagrams: boolean

    /** Include timeline */
    includeTimeline: boolean

    /** Include raw data */
    includeRawData: boolean

    /** CSS theme */
    cssTheme: "light" | "dark"
  }

  /** Compression settings */
  compression: {
    /** Auto-compress for visualization */
    autoCompress: boolean

    /** Compression threshold (node count) */
    compressionThreshold: number
  }
}

/**
 * Default visualization configuration
 */
export const DEFAULT_VISUALIZATION_CONFIG: VisualizationConfig = {
  defaultFormat: "mermaid-flowchart",
  mermaid: {
    flowchartDirection: "TB",
    theme: "default",
    maxLabelLength: 30,
  },
  d3: {
    chargeStrength: -100,
    linkDistance: 50,
    nodeSizeRange: [5, 20],
  },
  report: {
    includeDiagrams: true,
    includeTimeline: true,
    includeRawData: false,
    cssTheme: "light",
  },
  compression: {
    autoCompress: true,
    compressionThreshold: 50,
  },
}

// ============================================================================
// Color Schemes
// ============================================================================

/**
 * Node type colors
 */
export const NODE_TYPE_COLORS: Record<string, string> = {
  hook: "#4CAF50",
  tool: "#2196F3",
  agent: "#9C27B0",
  decision: "#FF9800",
  checkpoint: "#607D8B",
  "governance-block": "#795548",
}

/**
 * Node status colors
 */
export const NODE_STATUS_COLORS: Record<string, string> = {
  running: "#FFC107",
  completed: "#4CAF50",
  failed: "#F44336",
  suspended: "#9E9E9E",
}

/**
 * Edge type colors
 */
export const EDGE_TYPE_COLORS: Record<string, string> = {
  "data-flow": "#2196F3",
  "control-flow": "#4CAF50",
  trigger: "#FF9800",
  spawn: "#9C27B0",
}
