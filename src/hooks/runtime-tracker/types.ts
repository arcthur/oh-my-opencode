export interface ToolRuntime {
  /** Tool name */
  tool: string
  /** Average duration in ms */
  avgDuration: number
  /** Last duration in ms */
  lastDuration: number
  /** Total call count */
  callCount: number
  /** Recent durations for rolling average */
  recentDurations: number[]
  /** Last call timestamp */
  lastCalled: number
}

export interface RuntimeTrackerConfig {
  /** Enable runtime tracking (default: true) */
  enabled: boolean
  /** Threshold in ms to trigger warning (default: 3000) */
  threshold_ms: number
  /** Max recent durations to track for average (default: 10) */
  max_recent: number
  /** Inject runtime hints into tool output (default: true) */
  inject_hints: boolean
}

export const DEFAULT_CONFIG: RuntimeTrackerConfig = {
  enabled: true,
  threshold_ms: 3000,
  max_recent: 10,
  inject_hints: true,
}

export interface RuntimeStats {
  [tool: string]: ToolRuntime
}
