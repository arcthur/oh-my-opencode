export interface ExecutionBudgetLimits {
  maxToolCalls: number
  wallClockMs: number
  contextTokensHardLimit: number
}

export interface ExecutionBudgetSnapshot {
  startedAt: number
  elapsedMs: number
  toolCalls: number
  maxToolCalls: number
  wallClockMs: number
  contextTokensHardLimit: number
  estimatedRecentTokens: number
  tokenPressure: boolean
  pressureRatio: number
}

export interface ToolAdmissionResult {
  allowed: boolean
  reasonCode?: "MAX_TOOL_CALLS_EXCEEDED" | "WALL_CLOCK_BUDGET_EXCEEDED"
  message?: string
  snapshot: ExecutionBudgetSnapshot
}

interface SessionExecutionState {
  startedAt: number
  toolCalls: number
  lastCompactionHintAt?: number
}

const DEFAULT_PRESSURE_RATIO = 0.9
const DEFAULT_COMPACTION_HINT_COOLDOWN_MS = 30_000

export class SessionExecutionBudgetManager {
  private readonly sessions = new Map<string, SessionExecutionState>()
  private readonly now: () => number
  private readonly pressureRatio: number
  private readonly compactionHintCooldownMs: number

  constructor(options?: {
    now?: () => number
    pressureRatio?: number
    compactionHintCooldownMs?: number
  }) {
    this.now = options?.now ?? (() => Date.now())
    this.pressureRatio = options?.pressureRatio ?? DEFAULT_PRESSURE_RATIO
    this.compactionHintCooldownMs =
      options?.compactionHintCooldownMs ?? DEFAULT_COMPACTION_HINT_COOLDOWN_MS
  }

  admitToolCall(sessionID: string, limits: ExecutionBudgetLimits): ToolAdmissionResult {
    const state = this.ensureState(sessionID)
    const elapsedMs = Math.max(0, this.now() - state.startedAt)

    if (elapsedMs > limits.wallClockMs) {
      return {
        allowed: false,
        reasonCode: "WALL_CLOCK_BUDGET_EXCEEDED",
        message: `Execution budget exceeded: wall clock ${elapsedMs}ms > ${limits.wallClockMs}ms`,
        snapshot: this.snapshotFromState(state, limits, 0),
      }
    }

    if (state.toolCalls >= limits.maxToolCalls) {
      return {
        allowed: false,
        reasonCode: "MAX_TOOL_CALLS_EXCEEDED",
        message: `Execution budget exceeded: tool calls ${state.toolCalls} >= ${limits.maxToolCalls}`,
        snapshot: this.snapshotFromState(state, limits, 0),
      }
    }

    state.toolCalls += 1
    return {
      allowed: true,
      snapshot: this.snapshotFromState(state, limits, 0),
    }
  }

  snapshot(
    sessionID: string,
    limits: ExecutionBudgetLimits,
    estimatedRecentTokens: number
  ): ExecutionBudgetSnapshot {
    const state = this.ensureState(sessionID)
    return this.snapshotFromState(
      state,
      limits,
      Math.max(0, estimatedRecentTokens)
    )
  }

  shouldEmitCompactionHint(
    sessionID: string,
    snapshot: ExecutionBudgetSnapshot
  ): boolean {
    if (!snapshot.tokenPressure) {
      return false
    }

    const state = this.ensureState(sessionID)
    const now = this.now()
    if (
      state.lastCompactionHintAt !== undefined
      && now - state.lastCompactionHintAt < this.compactionHintCooldownMs
    ) {
      return false
    }

    state.lastCompactionHintAt = now
    return true
  }

  clearSession(sessionID: string): void {
    this.sessions.delete(sessionID)
  }

  private ensureState(sessionID: string): SessionExecutionState {
    const existing = this.sessions.get(sessionID)
    if (existing) {
      return existing
    }

    const created: SessionExecutionState = {
      startedAt: this.now(),
      toolCalls: 0,
    }
    this.sessions.set(sessionID, created)
    return created
  }

  private snapshotFromState(
    state: SessionExecutionState,
    limits: ExecutionBudgetLimits,
    estimatedRecentTokens: number
  ): ExecutionBudgetSnapshot {
    const elapsedMs = Math.max(0, this.now() - state.startedAt)
    const hardLimit = Math.max(1, limits.contextTokensHardLimit)
    const pressureRatio = estimatedRecentTokens / hardLimit

    return {
      startedAt: state.startedAt,
      elapsedMs,
      toolCalls: state.toolCalls,
      maxToolCalls: limits.maxToolCalls,
      wallClockMs: limits.wallClockMs,
      contextTokensHardLimit: hardLimit,
      estimatedRecentTokens,
      tokenPressure: pressureRatio >= this.pressureRatio,
      pressureRatio,
    }
  }
}
