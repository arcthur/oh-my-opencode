import { log } from "../../../shared"
import type { RuntimeExecutionNode } from "../types"
import type { RuntimeAssemblyContext } from "./types"
import { detectErrorType } from "../../session-state-repair"

export function buildEventNodes(
  context: RuntimeAssemblyContext,
  input: { event: { type: string; properties?: unknown } }
): RuntimeExecutionNode[] {
  const nodes: RuntimeExecutionNode[] = []

  if (context.workOrchestrator?.event) {
    nodes.push({
      id: "work-orchestrator:event",
      invoke: async () => {
        await context.workOrchestrator?.event?.(input)
      },
    })
  }

  if (context.autoUpdateChecker?.event) {
    nodes.push({
      id: "auto-update-checker:event",
      invoke: async () => {
        await context.autoUpdateChecker?.event?.(input)
      },
    })
  }

  if (context.claudeCodeBridgeEnabled && context.claudeCodeHooks?.event) {
    nodes.push({
      id: "bridge:claude-code-hooks:event",
      invoke: async () => {
        await context.claudeCodeHooks?.event?.(input)
      },
    })
  }

  if (context.backgroundNotificationHook?.event) {
    nodes.push({
      id: "background-notification:event",
      invoke: async () => {
        await context.backgroundNotificationHook?.event?.(input)
      },
    })
  }

  if (context.sessionNotification) {
    nodes.push({
      id: "session-notification:event",
      invoke: async () => {
        await context.sessionNotification?.(input)
      },
    })
  }

  if (context.taskAutoContinuation?.handler) {
    nodes.push({
      id: "task-auto-continuation:event",
      invoke: async () => {
        await context.taskAutoContinuation?.handler?.(input)
      },
    })
  }

  if (context.unstableAgentWatchdog?.event) {
    nodes.push({
      id: "unstable-agent-watchdog:event",
      invoke: async () => {
        await context.unstableAgentWatchdog?.event?.(input)
      },
    })
  }

  if (context.preCompletionVerification?.event) {
    nodes.push({
      id: "pre-completion-verification:event",
      invoke: async () => {
        await context.preCompletionVerification?.event?.(input)
      },
    })
  }

  if (context.sisyphusContextualInjector?.event) {
    nodes.push({
      id: "sisyphus-contextual-injector:event",
      invoke: async () => {
        await context.sisyphusContextualInjector?.event?.(input)
      },
    })
  }

  if (context.userMemory?.event) {
    nodes.push({
      id: "internal:user-memory:event",
      invoke: async () => {
        await context.userMemory?.event?.(input)
      },
    })
  }

  if (context.orgMemory?.event) {
    nodes.push({
      id: "internal:org-memory:event",
      invoke: async () => {
        await context.orgMemory?.event?.(input)
      },
    })
  }

  if (context.runtimeTracker?.event) {
    nodes.push({
      id: "runtime-tracker:event",
      invoke: async () => {
        await context.runtimeTracker?.event?.(input)
      },
    })
  }

  if (context.repoOverviewInjector?.event) {
    nodes.push({
      id: "repo-overview-injector:event",
      invoke: async () => {
        await context.repoOverviewInjector?.event?.(input)
      },
    })
  }

  if (context.contextWindowGovernor?.event) {
    nodes.push({
      id: "context-window-governor:event",
      invoke: async () => {
        await context.contextWindowGovernor?.event?.(input)
      },
    })
  }

  if (context.directoryAgentsInjector?.event) {
    nodes.push({
      id: "directory-agents-injector:event",
      invoke: async () => {
        await context.directoryAgentsInjector?.event?.(input)
      },
    })
  }

  if (context.directoryReadmeInjector?.event) {
    nodes.push({
      id: "directory-readme-injector:event",
      invoke: async () => {
        await context.directoryReadmeInjector?.event?.(input)
      },
    })
  }

  if (context.rulesInjector?.event) {
    nodes.push({
      id: "rules-injector:event",
      invoke: async () => {
        await context.rulesInjector?.event?.(input)
      },
    })
  }

  if (context.thinkMode?.event) {
    nodes.push({
      id: "think-mode:event",
      invoke: async () => {
        await context.thinkMode?.event?.(input)
      },
    })
  }

  if (context.delegationNudgeAgentUsage?.event) {
    nodes.push({
      id: "delegation-nudge-agent-usage:event",
      invoke: async () => {
        await context.delegationNudgeAgentUsage?.event?.(input)
      },
    })
  }

  if (context.delegationNudgeCategorySkill?.event) {
    nodes.push({
      id: "delegation-nudge-category-skill:event",
      invoke: async () => {
        await context.delegationNudgeCategorySkill?.event?.(input)
      },
    })
  }

  if (context.interactiveBashSession?.event) {
    nodes.push({
      id: "interactive-bash-session:event",
      invoke: async () => {
        await context.interactiveBashSession?.event?.(input)
      },
    })
  }

  if (context.ralphLoop?.event) {
    nodes.push({
      id: "ralph-loop:event",
      invoke: async () => {
        await context.ralphLoop?.event?.(input)
      },
    })
  }

  if (context.conditionalRulesHooks?.event) {
    nodes.push({
      id: "conditional-rules:event",
      invoke: async () => {
        await context.conditionalRulesHooks?.event?.(input)
      },
    })
  }

  if (context.sessionHandoffHook?.event) {
    nodes.push({
      id: "session-handoff:event",
      invoke: async () => {
        await context.sessionHandoffHook?.event?.(input)
      },
    })
  }

  if (context.tmuxParallelAgents?.event) {
    nodes.push({
      id: "tmux-parallel-agents:event",
      invoke: async () => {
        await context.tmuxParallelAgents?.event?.(input)
      },
    })
  }

  if (context.swarmAgent?.event) {
    nodes.push({
      id: "swarm-agent:event",
      invoke: async () => {
        await context.swarmAgent?.event?.(input)
      },
    })
  }

  nodes.push({
    id: "internal:core-session-state:event",
    failurePolicy: "fail-closed",
    invoke: async () => {
      const { event } = input
      const props = event.properties as Record<string, unknown> | undefined

      if (event.type === "session.created") {
        const sessionInfo = props?.info as
          | { id?: string; title?: string; parentID?: string }
          | undefined
        if (!sessionInfo?.parentID) {
          context.setMainSession?.(sessionInfo?.id)
        }
        if (sessionInfo?.id) {
          const agent = (props as Record<string, unknown>)?.agent as string | undefined
          context.sessionStateCoordinator?.onSessionCreated(
            sessionInfo.id,
            sessionInfo.parentID,
            agent
          )
        }
        context.firstMessageVariantGate?.markSessionCreated(sessionInfo)
      }

      if (event.type === "session.deleted") {
        const sessionInfo = props?.info as { id?: string } | undefined
        if (sessionInfo?.id) {
          context.sessionStateCoordinator?.onSessionDeleted(sessionInfo.id)
          context.resetMessageCursor?.(sessionInfo.id)
          context.firstMessageVariantGate?.clear(sessionInfo.id)
          context.swarmRuntime?.unbindSession(sessionInfo.id)
          context.swarmRuntime?.unregisterWorker(sessionInfo.id)
          context.swarmRuntime?.unregisterCoordinator(sessionInfo.id)
          await context.skillMcpManager?.disconnectSession(sessionInfo.id)
          await context.lspManager?.cleanupTempDirectoryClients()
        }
      }

      if (event.type === "session.compacted") {
        const sessionID = props?.sessionID as string | undefined
        if (sessionID) {
          context.sessionStateCoordinator?.onSessionCompacted(sessionID)
        }
      }

      if (event.type === "session.idle") {
        const sessionID = props?.sessionID as string | undefined
        if (sessionID) {
          try {
            context.persistGovernanceTraceSnapshot?.(sessionID)
          } catch (error) {
            log("[runtime:event] governance trace snapshot failed (non-fatal)", {
              sessionID,
              error: error instanceof Error ? error.message : String(error),
            })
          }
        }
      }

      if (event.type === "message.updated") {
        const info = props?.info as Record<string, unknown> | undefined
        const sessionID = info?.sessionID as string | undefined
        const agent = info?.agent as string | undefined
        const role = info?.role as string | undefined
        if (sessionID && agent && role === "user") {
          context.updateSessionAgent?.(sessionID, agent)
        }
      }
    },
  })

  if (context.sessionStateRepair) {
    nodes.push({
      id: "internal:session-state-repair:event",
      invoke: async () => {
        const { event } = input
        const props = event.properties as Record<string, unknown> | undefined
        if (event.type !== "session.error") {
          return
        }

        const sessionID = props?.sessionID as string | undefined
        const error = props?.error

        const errorType = detectErrorType(error)
        if (!errorType) {
          return
        }

        const messageInfo = {
          id: props?.messageID as string | undefined,
          role: "assistant" as const,
          sessionID,
          error,
        }

        const recovered = await context.sessionStateRepair?.handleSessionRecovery(messageInfo)

        if (
          recovered &&
          errorType === "assistant_prefill_unsupported" &&
          sessionID &&
          sessionID === context.getMainSessionID?.()
        ) {
          await context.client?.session
            .prompt({
              path: { id: sessionID },
              body: { parts: [{ type: "text", text: "continue" }] },
              query: { directory: context.directory ?? process.cwd() },
            })
            .catch(() => undefined)
        }
      },
    })
  }

  return nodes
}
