import type { Hooks, PluginInput } from "@opencode-ai/plugin"
import type { OhMyOpenCodeConfig } from "../../config/schema"
import { DEFAULT_CONTINUATION_CONTROL_CONFIG } from "../../config/schema"
import type { BackgroundManager } from "../../features/background-agent"
import type { ContextCollector } from "../../features/context-injector"
import { DEFAULT_PLANNING_CONFIG } from "../../features/planning-with-files/types"
import { createContinuationControl, createDirectContinuationReporterForTesting, type ContinuationIntent, type ContinuationIntentOutcome, type ContinuationPromptModel, type ContinuationPromptPayload, type ContinuationRejectReason, type ContinuationSource } from "./continuation"
import { createContinuationStopGuardHook } from "./stop-guard"
import { createPlanningWithFilesHook } from "./planning"
import { createExecutionOrchestratorHook } from "./execution"

export type {
  ContinuationIntent,
  ContinuationIntentOutcome,
  ContinuationPromptModel,
  ContinuationPromptPayload,
  ContinuationRejectReason,
  ContinuationSource,
}
export { createDirectContinuationReporterForTesting }

export type WorkOrchestratorTransitionPhase =
  | "planning"
  | "continuation"
  | "execution"
  | "lifecycle"

export type WorkOrchestratorTransitionOutcome =
  | "accepted"
  | "rejected"
  | "applied"
  | "observed"

export interface WorkOrchestratorTransition {
  sessionID: string
  phase: WorkOrchestratorTransitionPhase
  action: string
  outcome: WorkOrchestratorTransitionOutcome
  reason?: string
  metadata?: Record<string, unknown>
}

export interface WorkOrchestratorHookOptions {
  config?: {
    enabled?: boolean
    planning_with_files?: Partial<typeof DEFAULT_PLANNING_CONFIG>
    continuation_control?: Partial<typeof DEFAULT_CONTINUATION_CONTROL_CONFIG>
  }
  taskConfig?: Partial<OhMyOpenCodeConfig>
  collector?: ContextCollector
  backgroundManager?: BackgroundManager
  taskContinuationEnabled?: boolean
  onTransition?: (transition: WorkOrchestratorTransition) => void
}

export interface WorkOrchestratorHook extends Hooks {
  beginEvent: (input: { event: { type: string; properties?: unknown } }) => void
  flushEvent: (input: { event: { type: string; properties?: unknown } }) => Promise<void>
  reportContinuationIntent: (intent: ContinuationIntent) => Promise<void>
  getContinuationRound: (sessionID: string) => number | undefined
  stopContinuation: (sessionID: string) => void
  isContinuationStopped: (sessionID: string) => boolean
  clearContinuationStop: (sessionID: string) => void
}

export function createWorkOrchestratorHook(
  ctx: PluginInput,
  options: WorkOrchestratorHookOptions = {}
): WorkOrchestratorHook {
  const enabled = options.config?.enabled ?? true
  const stopGuard = createContinuationStopGuardHook(ctx)
  const onTransition = options.onTransition

  const emitTransition = (transition: WorkOrchestratorTransition): void => {
    try {
      onTransition?.(transition)
    } catch {
      // Governance/observer callbacks must not block orchestrator execution.
    }
  }

  const continuationControl = createContinuationControl(ctx, {
    config: {
      ...DEFAULT_CONTINUATION_CONTROL_CONFIG,
      ...(options.config?.continuation_control ?? {}),
      priority: {
        ...DEFAULT_CONTINUATION_CONTROL_CONFIG.priority,
        ...(options.config?.continuation_control?.priority ?? {}),
      },
    },
    isContinuationStopped: stopGuard.isStopped,
  })

  const reportContinuationIntent = async (intent: ContinuationIntent): Promise<void> => {
    await continuationControl.reportIntent({
      ...intent,
      onResult: async (outcome) => {
        await intent.onResult?.(outcome)
        emitTransition({
          sessionID: intent.sessionID,
          phase: "continuation",
          action: intent.reason,
          outcome: outcome.status === "accepted" ? "accepted" : "rejected",
          reason: outcome.rejectReason,
          metadata: {
            source: intent.source,
            round: intent.round,
          },
        })
      },
    })
  }

  const planningConfig = {
    ...DEFAULT_PLANNING_CONFIG,
    ...(options.config?.planning_with_files ?? {}),
  }

  const planningHook = enabled && planningConfig.enabled
    ? createPlanningWithFilesHook(ctx, {
        config: planningConfig,
        collector: options.collector,
        taskConfig: options.taskConfig,
        taskContinuationEnabled: options.taskContinuationEnabled,
        isContinuationStopped: stopGuard.isStopped,
        getContinuationRound: continuationControl.getCurrentRound,
        reportContinuationIntent,
      })
    : null

  const executionHook = enabled
    ? createExecutionOrchestratorHook(ctx, {
        directory: ctx.directory,
        backgroundManager: options.backgroundManager,
        taskConfig: options.taskConfig,
        isContinuationStopped: stopGuard.isStopped,
        getContinuationRound: continuationControl.getCurrentRound,
        reportContinuationIntent,
      })
    : null

  const stopContinuation = (sessionID: string): void => {
    stopGuard.stop(sessionID)
    emitTransition({
      sessionID,
      phase: "lifecycle",
      action: "stop-continuation",
      outcome: "applied",
    })
  }

  const clearContinuationStop = (sessionID: string, action = "stop-cleared"): void => {
    stopGuard.clear(sessionID)
    emitTransition({
      sessionID,
      phase: "lifecycle",
      action,
      outcome: "applied",
    })
  }

  return {
    beginEvent: continuationControl.beginEvent,
    flushEvent: continuationControl.flushEvent,
    reportContinuationIntent,
    getContinuationRound: continuationControl.getCurrentRound,
    stopContinuation,
    isContinuationStopped: stopGuard.isStopped,
    clearContinuationStop,

    "chat.message": async (input, output) => {
      const wasStopped = stopGuard.isStopped(input.sessionID)
      await stopGuard["chat.message"]?.({ sessionID: input.sessionID })
      if (wasStopped && !stopGuard.isStopped(input.sessionID)) {
        emitTransition({
          sessionID: input.sessionID,
          phase: "lifecycle",
          action: "stop-cleared-by-user-message",
          outcome: "applied",
        })
      }
      await planningHook?.["chat.message"]?.(input, output)
    },

    "tool.execute.before": async (input, output) => {
      await planningHook?.["tool.execute.before"]?.(input, output)
      await executionHook?.["tool.execute.before"]?.(input, output)
    },

    "tool.execute.after": async (input, output) => {
      await planningHook?.["tool.execute.after"]?.(input, output)
      await executionHook?.["tool.execute.after"]?.(input, output)
    },

    event: async (input) => {
      const props = input.event.properties as Record<string, unknown> | undefined
      const sessionID = (props?.sessionID as string | undefined) ??
        ((props?.info as { id?: string } | undefined)?.id as string | undefined)
      if (sessionID && input.event.type === "session.idle") {
        emitTransition({
          sessionID,
          phase: "lifecycle",
          action: "session-idle",
          outcome: "observed",
        })
      }
      await stopGuard.event?.(input)
      await planningHook?.event?.(input)
      await executionHook?.handler?.(input)
    },
  }
}
