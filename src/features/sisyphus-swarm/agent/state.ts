import { z } from "zod"
import type { OhMyOpenCodeConfig } from "../../../config/schema"
import { AgentStatusSchema, type AgentStatus, type AgentIdentity } from "../team/types"

/**
 * Pause context - saved state when agent enters PAUSED status
 */
export const PauseContextSchema = z.object({
  /** Reason for pausing */
  reason: z.string(),
  /** Message type to wait for before resuming */
  resumeOn: z.string(),
  /** Task ID that was in progress when paused */
  savedTaskId: z.string().optional(),
  /** When the agent paused */
  pausedAt: z.number(),
  /** Timeout in ms for auto-resume with error */
  timeoutMs: z.number().optional(),
  /** Optional request ID associated with the pause */
  requestId: z.string().optional(),
})

export type PauseContext = z.infer<typeof PauseContextSchema>

/**
 * Agent state machine state
 */
export const AgentStateSchema = z.object({
  /** Current status */
  status: AgentStatusSchema,
  /** Current task ID if working */
  currentTaskId: z.string().optional(),
  /** Current task title for display */
  currentTaskTitle: z.string().optional(),
  /** Last status change timestamp */
  lastStatusChange: z.number(),
  /** Error message if in error state */
  error: z.string().optional(),
  /** Number of tasks completed this session */
  tasksCompleted: z.number().default(0),
  /** Number of tasks failed this session */
  tasksFailed: z.number().default(0),
  /** Context saved when paused (for non-blocking waits) */
  pauseContext: PauseContextSchema.optional(),
})

export type AgentState = z.infer<typeof AgentStateSchema>

/**
 * State transition events
 */
export type StateEvent =
  | { type: "JOIN_APPROVED" }
  | { type: "JOIN_REJECTED"; reason: string }
  | { type: "TASK_ASSIGNED"; taskId: string; title: string }
  | { type: "TASK_COMPLETED" }
  | { type: "TASK_FAILED"; error: string }
  | { type: "PAUSE"; reason: string; resumeOn: string; timeoutMs?: number; requestId?: string }
  | { type: "RESUME"; payload?: unknown }
  | { type: "PAUSE_TIMEOUT" }
  | { type: "SHUTDOWN_REQUESTED" }
  | { type: "SHUTDOWN_APPROVED" }
  | { type: "SHUTDOWN_REJECTED"; reason: string }
  | { type: "HEARTBEAT_TIMEOUT" }
  | { type: "RESET" }

/**
 * Valid state transitions
 */
const VALID_TRANSITIONS: Record<AgentStatus, AgentStatus[]> = {
  joining: ["idle", "dead"],
  idle: ["working", "leaving", "dead"],
  working: ["idle", "paused", "leaving", "dead"],
  paused: ["working", "idle", "leaving", "dead"],
  leaving: ["dead"],
  dead: ["joining"], // Can rejoin
}

/**
 * Create initial agent state
 */
export function createInitialState(): AgentState {
  return {
    status: "joining",
    lastStatusChange: Date.now(),
    tasksCompleted: 0,
    tasksFailed: 0,
  }
}

/**
 * Check if a transition is valid
 */
export function isValidTransition(from: AgentStatus, to: AgentStatus): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false
}

/**
 * Apply a state event and return new state
 */
export function applyEvent(state: AgentState, event: StateEvent): AgentState {
  const now = Date.now()

  switch (event.type) {
    case "JOIN_APPROVED":
      if (state.status !== "joining") {
        throw new Error(`Invalid transition: ${state.status} -> idle (via JOIN_APPROVED)`)
      }
      return {
        ...state,
        status: "idle",
        lastStatusChange: now,
        error: undefined,
      }

    case "JOIN_REJECTED":
      if (state.status !== "joining") {
        throw new Error(`Invalid transition: ${state.status} -> dead (via JOIN_REJECTED)`)
      }
      return {
        ...state,
        status: "dead",
        lastStatusChange: now,
        error: event.reason,
      }

    case "TASK_ASSIGNED":
      if (state.status !== "idle") {
        throw new Error(`Invalid transition: ${state.status} -> working (via TASK_ASSIGNED)`)
      }
      return {
        ...state,
        status: "working",
        currentTaskId: event.taskId,
        currentTaskTitle: event.title,
        lastStatusChange: now,
      }

    case "TASK_COMPLETED":
      if (state.status !== "working" && state.status !== "paused") {
        throw new Error(`Invalid transition: ${state.status} -> idle (via TASK_COMPLETED)`)
      }
      return {
        ...state,
        status: "idle",
        currentTaskId: undefined,
        currentTaskTitle: undefined,
        pauseContext: undefined,
        lastStatusChange: now,
        tasksCompleted: state.tasksCompleted + 1,
      }

    case "TASK_FAILED":
      if (state.status !== "working" && state.status !== "paused") {
        throw new Error(`Invalid transition: ${state.status} -> idle (via TASK_FAILED)`)
      }
      return {
        ...state,
        status: "idle",
        currentTaskId: undefined,
        currentTaskTitle: undefined,
        pauseContext: undefined,
        lastStatusChange: now,
        error: event.error,
        tasksFailed: state.tasksFailed + 1,
      }

    case "PAUSE":
      if (state.status !== "working") {
        throw new Error(`Invalid transition: ${state.status} -> paused (via PAUSE)`)
      }
      return {
        ...state,
        status: "paused",
        lastStatusChange: now,
        pauseContext: {
          reason: event.reason,
          resumeOn: event.resumeOn,
          savedTaskId: state.currentTaskId,
          pausedAt: now,
          timeoutMs: event.timeoutMs,
          requestId: event.requestId,
        },
      }

    case "RESUME":
      if (state.status !== "paused") {
        throw new Error(`Invalid transition: ${state.status} -> working (via RESUME)`)
      }
      return {
        ...state,
        status: "working",
        pauseContext: undefined,
        lastStatusChange: now,
      }

    case "PAUSE_TIMEOUT":
      if (state.status !== "paused") {
        throw new Error(`Invalid transition: ${state.status} -> idle (via PAUSE_TIMEOUT)`)
      }
      return {
        ...state,
        status: "idle",
        currentTaskId: undefined,
        currentTaskTitle: undefined,
        pauseContext: undefined,
        lastStatusChange: now,
        error: `Pause timeout: ${state.pauseContext?.reason ?? "unknown"}`,
        tasksFailed: state.tasksFailed + 1,
      }

    case "SHUTDOWN_REQUESTED":
      if (!["idle", "working", "paused"].includes(state.status)) {
        throw new Error(`Invalid transition: ${state.status} -> leaving (via SHUTDOWN_REQUESTED)`)
      }
      return {
        ...state,
        status: "leaving",
        lastStatusChange: now,
      }

    case "SHUTDOWN_APPROVED":
      if (state.status !== "leaving") {
        throw new Error(`Invalid transition: ${state.status} -> dead (via SHUTDOWN_APPROVED)`)
      }
      return {
        ...state,
        status: "dead",
        lastStatusChange: now,
      }

    case "SHUTDOWN_REJECTED":
      if (state.status !== "leaving") {
        // Go back to previous state (idle)
        return {
          ...state,
          status: "idle",
          lastStatusChange: now,
          error: event.reason,
        }
      }
      return {
        ...state,
        status: "idle",
        lastStatusChange: now,
        error: event.reason,
      }

    case "HEARTBEAT_TIMEOUT":
      return {
        ...state,
        status: "dead",
        lastStatusChange: now,
        error: "Heartbeat timeout",
      }

    case "RESET":
      return createInitialState()

    default:
      return state
  }
}

/**
 * Agent state machine class
 */
export class AgentStateMachine {
  private state: AgentState
  private listeners: Array<(state: AgentState, event: StateEvent) => void> = []

  constructor(initialState?: Partial<AgentState>) {
    this.state = {
      ...createInitialState(),
      ...initialState,
    }
  }

  /**
   * Get current state
   */
  getState(): AgentState {
    return { ...this.state }
  }

  /**
   * Get current status
   */
  getStatus(): AgentStatus {
    return this.state.status
  }

  /**
   * Check if in a specific status
   */
  is(status: AgentStatus): boolean {
    return this.state.status === status
  }

  /**
   * Check if can transition to a status
   */
  canTransitionTo(status: AgentStatus): boolean {
    return isValidTransition(this.state.status, status)
  }

  /**
   * Dispatch an event
   */
  dispatch(event: StateEvent): AgentState {
    const newState = applyEvent(this.state, event)
    this.state = newState

    // Notify listeners
    for (const listener of this.listeners) {
      try {
        listener(newState, event)
      } catch (err) {
        console.error("[AgentStateMachine] Listener error:", err)
      }
    }

    return newState
  }

  /**
   * Subscribe to state changes
   */
  subscribe(listener: (state: AgentState, event: StateEvent) => void): () => void {
    this.listeners.push(listener)
    return () => {
      const index = this.listeners.indexOf(listener)
      if (index !== -1) {
        this.listeners.splice(index, 1)
      }
    }
  }

  /**
   * Get state summary for display
   */
  getSummary(): string {
    const { status, currentTaskTitle, error, tasksCompleted, tasksFailed } = this.state

    let summary = `Status: ${status}`

    if (currentTaskTitle) {
      summary += ` | Task: ${currentTaskTitle}`
    }

    if (error) {
      summary += ` | Error: ${error}`
    }

    summary += ` | Completed: ${tasksCompleted} | Failed: ${tasksFailed}`

    return summary
  }
}
