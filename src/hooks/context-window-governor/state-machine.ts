import type { ContextWindowPhase, ContextWindowSignal } from "./types"

interface StateMachineConfig {
  warningRatio: number
  preemptiveRatio: number
  warningResetRatio: number
  preemptiveResetRatio: number
  limitRatio?: number
}

interface SessionState {
  phase: ContextWindowPhase
  warningArmed: boolean
  preemptiveArmed: boolean
  recoveryPending: boolean
}

interface ContextWindowStateMachine {
  onUsage: (sessionID: string, usageRatio: number) => ContextWindowSignal
  markRecoveryPending: (sessionID: string) => void
  isRecoveryPending: (sessionID: string) => boolean
  clearRecoveryPending: (sessionID: string) => void
  onRecoveryExhausted: (sessionID: string) => void
  onCompactionStarted: (sessionID: string, recovery: boolean) => void
  onCompactionFinished: (sessionID: string) => void
  onCompactionFailed: (sessionID: string) => void
  clearSession: (sessionID: string) => void
}

function createDefaultSignal(phase: ContextWindowPhase): ContextWindowSignal {
  return {
    phase,
    shouldWarn: false,
    shouldPreemptiveCompact: false,
    shouldRecover: false,
  }
}

export function createContextWindowStateMachine(config: StateMachineConfig): ContextWindowStateMachine {
  const stateBySession = new Map<string, SessionState>()
  const limitRatio = config.limitRatio ?? 1

  const ensureState = (sessionID: string): SessionState => {
    const existing = stateBySession.get(sessionID)
    if (existing) {
      return existing
    }

    const next: SessionState = {
      phase: "healthy",
      warningArmed: true,
      preemptiveArmed: true,
      recoveryPending: false,
    }
    stateBySession.set(sessionID, next)
    return next
  }

  return {
    onUsage(sessionID, usageRatio) {
      const state = ensureState(sessionID)

      if (usageRatio < config.warningResetRatio) {
        state.warningArmed = true
      }
      if (usageRatio < config.preemptiveResetRatio) {
        state.preemptiveArmed = true
      }

      const canExitStickyPhase = state.warningArmed && state.preemptiveArmed
      if (state.phase === "failed" && !canExitStickyPhase) {
        return createDefaultSignal(state.phase)
      }

      // Recovery has the highest priority. When recovery is pending, suppress all other actions.
      if (state.recoveryPending) {
        state.phase = "recovery_pending"
        if (usageRatio >= limitRatio) {
          return {
            phase: state.phase,
            shouldWarn: false,
            shouldPreemptiveCompact: false,
            shouldRecover: true,
          }
        }
        return createDefaultSignal(state.phase)
      }

      if (usageRatio >= limitRatio) {
        state.phase = "recovery_pending"
        state.recoveryPending = true
        return {
          phase: state.phase,
          shouldWarn: false,
          shouldPreemptiveCompact: false,
          shouldRecover: true,
        }
      }

      // Preemptive compaction has higher priority than warnings.
      if (usageRatio >= config.preemptiveRatio && state.preemptiveArmed) {
        state.phase = "preemptive_armed"
        state.preemptiveArmed = false
        return {
          phase: state.phase,
          shouldWarn: false,
          shouldPreemptiveCompact: true,
          shouldRecover: false,
        }
      }

      if (
        usageRatio >= config.warningRatio &&
        usageRatio < config.preemptiveRatio &&
        state.warningArmed
      ) {
        state.phase = "warned"
        state.warningArmed = false
        return {
          phase: state.phase,
          shouldWarn: true,
          shouldPreemptiveCompact: false,
          shouldRecover: false,
        }
      }

      // Do not overwrite "cooldown"/"failed" until we have fully re-armed via reset thresholds.
      const canExitCooldown = canExitStickyPhase
      const isStickyPhase = state.phase === "cooldown" || state.phase === "failed"

      if (!isStickyPhase || canExitCooldown) {
        if (usageRatio < config.warningRatio) {
          state.phase = "healthy"
        } else if (usageRatio < config.preemptiveRatio) {
          state.phase = "warned"
        } else {
          state.phase = "preemptive_armed"
        }
      }

      return createDefaultSignal(state.phase)
    },

    markRecoveryPending(sessionID) {
      const state = ensureState(sessionID)
      const canExitStickyPhase = state.warningArmed && state.preemptiveArmed
      if (state.phase === "failed" && !canExitStickyPhase) {
        return
      }
      state.recoveryPending = true
      state.phase = "recovery_pending"
    },

    isRecoveryPending(sessionID) {
      return ensureState(sessionID).recoveryPending
    },

    clearRecoveryPending(sessionID) {
      const state = ensureState(sessionID)
      state.recoveryPending = false
      if (state.phase === "recovery_pending" || state.phase === "recovering") {
        state.phase = "cooldown"
      }
    },

    onRecoveryExhausted(sessionID) {
      const state = ensureState(sessionID)
      state.phase = "failed"
      state.recoveryPending = false
      state.warningArmed = false
      state.preemptiveArmed = false
    },

    onCompactionStarted(sessionID, recovery) {
      const state = ensureState(sessionID)
      state.phase = recovery ? "recovering" : "compacting"
    },

    onCompactionFinished(sessionID) {
      const state = ensureState(sessionID)
      state.phase = "cooldown"
      state.recoveryPending = false
    },

    onCompactionFailed(sessionID) {
      const state = ensureState(sessionID)
      state.phase = "failed"
    },

    clearSession(sessionID) {
      stateBySession.delete(sessionID)
    },
  }
}
