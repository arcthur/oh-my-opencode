import { executePreToolGovernance } from "../../../features/governance"
import { createWorkStateManager } from "../../../features/work-state"
import { log } from "../../../shared"
import type { ToolExecuteInput } from "../../../shared/hook-types"
import type { RuntimeExecutionNode } from "../types"
import type { RuntimeAssemblyContext, ToolExecuteBeforeOutput } from "./types"

const DEFAULT_GOVERNANCE_BLOCK_PREFIX = "Governance blocked:"

export function buildToolExecuteBeforeNodes(
  context: RuntimeAssemblyContext,
  input: ToolExecuteInput,
  output: ToolExecuteBeforeOutput
): RuntimeExecutionNode[] {
  const nodes: RuntimeExecutionNode[] = []

  if (context.questionLabelTruncator?.["tool.execute.before"]) {
    nodes.push({
      id: "question-label-truncator:tool.execute.before",
      invoke: async () => {
        await context.questionLabelTruncator?.["tool.execute.before"]?.(input, output)
      },
    })
  }

  if (context.delegationBlockSubagentQuestion?.["tool.execute.before"]) {
    nodes.push({
      id: "delegation-block-subagent-question:tool.execute.before",
      invoke: async () => {
        await context.delegationBlockSubagentQuestion?.["tool.execute.before"]?.(input, output)
      },
    })
  }

  if (context.writeExistingFileGuard?.["tool.execute.before"]) {
    nodes.push({
      id: "write-existing-file-guard:tool.execute.before",
      invoke: async () => {
        await context.writeExistingFileGuard?.["tool.execute.before"]?.(input, output)
      },
    })
  }

  if (context.userMemory?.["tool.execute.before"]) {
    nodes.push({
      id: "internal:user-memory:tool.execute.before",
      invoke: async () => {
        await context.userMemory?.["tool.execute.before"]?.(input, output)
      },
    })
  }

  if (context.orgMemory?.["tool.execute.before"]) {
    nodes.push({
      id: "internal:org-memory:tool.execute.before",
      invoke: async () => {
        await context.orgMemory?.["tool.execute.before"]?.(input, output)
      },
    })
  }

  if (context.runtimeTracker?.["tool.execute.before"]) {
    nodes.push({
      id: "runtime-tracker:tool.execute.before",
      invoke: async () => {
        await context.runtimeTracker?.["tool.execute.before"]?.(input, output)
      },
    })
  }

  if (context.claudeCodeBridgeEnabled && context.claudeCodeHooks?.["tool.execute.before"]) {
    nodes.push({
      id: "bridge:claude-code-hooks:tool.execute.before",
      invoke: async () => {
        await context.claudeCodeHooks?.["tool.execute.before"]?.(input, output)
      },
    })
  }

  if (context.nonInteractiveEnv?.["tool.execute.before"]) {
    nodes.push({
      id: "non-interactive-env:tool.execute.before",
      invoke: async () => {
        await context.nonInteractiveEnv?.["tool.execute.before"]?.(input, output)
      },
    })
  }

  if (context.commentChecker?.["tool.execute.before"]) {
    nodes.push({
      id: "comment-checker:tool.execute.before",
      invoke: async () => {
        await context.commentChecker?.["tool.execute.before"]?.(input, output)
      },
    })
  }

  if (context.directoryAgentsInjector?.["tool.execute.before"]) {
    nodes.push({
      id: "directory-agents-injector:tool.execute.before",
      invoke: async () => {
        await context.directoryAgentsInjector?.["tool.execute.before"]?.(input, output)
      },
    })
  }

  if (context.directoryReadmeInjector?.["tool.execute.before"]) {
    nodes.push({
      id: "directory-readme-injector:tool.execute.before",
      invoke: async () => {
        await context.directoryReadmeInjector?.["tool.execute.before"]?.(input, output)
      },
    })
  }

  if (context.rulesInjector?.["tool.execute.before"]) {
    nodes.push({
      id: "rules-injector:tool.execute.before",
      invoke: async () => {
        await context.rulesInjector?.["tool.execute.before"]?.(input, output)
      },
    })
  }

  if (context.prometheusMdOnly?.["tool.execute.before"]) {
    nodes.push({
      id: "prometheus-md-only:tool.execute.before",
      invoke: async () => {
        await context.prometheusMdOnly?.["tool.execute.before"]?.(input, output)
      },
    })
  }

  if (context.workOrchestrator?.["tool.execute.before"]) {
    nodes.push({
      id: "work-orchestrator:tool.execute.before",
      invoke: async () => {
        await context.workOrchestrator?.["tool.execute.before"]?.(input, output)
      },
    })
  }

  if (context.sisyphusContextualInjector?.["tool.execute.before"]) {
    nodes.push({
      id: "sisyphus-contextual-injector:tool.execute.before",
      invoke: async () => {
        await context.sisyphusContextualInjector?.["tool.execute.before"]?.(input, output)
      },
    })
  }

  if (context.delegationValidateDecision?.["tool.execute.before"]) {
    nodes.push({
      id: "delegation-validate-decision:tool.execute.before",
      invoke: async () => {
        await context.delegationValidateDecision?.["tool.execute.before"]?.(input, output)
      },
    })
  }

  if (context.sisyphusJuniorNotepad?.["tool.execute.before"]) {
    nodes.push({
      id: "sisyphus-junior-notepad:tool.execute.before",
      invoke: async () => {
        await context.sisyphusJuniorNotepad?.["tool.execute.before"]?.(input, output)
      },
    })
  }

  if (context.tmuxParallelAgents?.["tool.execute.before"]) {
    nodes.push({
      id: "tmux-parallel-agents:tool.execute.before",
      invoke: async () => {
        await context.tmuxParallelAgents?.["tool.execute.before"]?.(input, output)
      },
    })
  }

  if (context.swarmAgent?.["tool.execute.before"]) {
    nodes.push({
      id: "swarm-agent:tool.execute.before",
      invoke: async () => {
        await context.swarmAgent?.["tool.execute.before"]?.(input, output)
      },
    })
  }

  if (context.conditionalRulesHooks) {
    nodes.push({
      id: "conditional-rules:tool.execute.before",
      invoke: async () => {
        const currentAgent = context.getSessionAgent?.(input.sessionID)
        await context.conditionalRulesHooks?.["tool.execute.before"]?.({
          tool: input.tool,
          args: output.args,
          sessionId: input.sessionID,
          context: { cwd: context.directory ?? process.cwd(), agent: currentAgent },
        })

        if (input.tool === "delegate_task") {
          const delegateResult = await context.conditionalRulesHooks?.[
            "tool.execute.before:delegate_task"
          ]?.({
            args: output.args,
            sessionId: input.sessionID,
            context: { cwd: context.directory ?? process.cwd(), agent: currentAgent },
          })
          if (delegateResult?.args) {
            Object.assign(output.args, delegateResult.args)
          }
        }
      },
    })
  }

  if (context.contextManifestInjector?.["tool.execute.before"]) {
    nodes.push({
      id: "context-manifest-injector:tool.execute.before",
      invoke: async () => {
        await context.contextManifestInjector?.["tool.execute.before"]?.(input, output)
      },
    })
  }

  nodes.push({
    id: "internal:task-tools-sanitizer:tool.execute.before",
    invoke: async () => {
      if (input.tool === "task") {
        const args = output.args as Record<string, unknown>
        args.tools = {
          ...(args.tools as Record<string, boolean> | undefined),
          delegate_task: false,
        }
      }
    },
  })

  if (context.ralphLoop) {
    nodes.push({
      id: "internal:ralph-loop-slash:tool.execute.before",
      invoke: async () => {
        if (input.tool !== "slashcommand") {
          return
        }

        const args = output.args as { command?: string }
        const command = args?.command?.replace(/^\//, "").toLowerCase()
        const sessionID = input.sessionID || context.getMainSessionID?.()

        if (command === "ralph-loop" && sessionID) {
          const rawArgs = args?.command?.replace(/^\/?(ralph-loop)\s*/i, "") || ""
          const taskMatch = rawArgs.match(/^["'](.+?)["']/)
          const prompt =
            taskMatch?.[1]
            || rawArgs.split(/\s+--/)[0]?.trim()
            || "Complete the task as instructed"

          const maxIterMatch = rawArgs.match(/--max-iterations=(\d+)/i)
          const promiseMatch = rawArgs.match(/--completion-promise=["']?([^"'\s]+)["']?/i)

          context.ralphLoop?.startLoop(sessionID, prompt, {
            maxIterations: maxIterMatch ? parseInt(maxIterMatch[1], 10) : undefined,
            completionPromise: promiseMatch?.[1],
          })
        } else if (command === "cancel-ralph" && sessionID) {
          context.ralphLoop?.cancelLoop(sessionID)
        } else if (command === "ulw-loop" && sessionID) {
          const rawArgs = args?.command?.replace(/^\/?(ulw-loop)\s*/i, "") || ""
          const taskMatch = rawArgs.match(/^["'](.+?)["']/)
          const prompt =
            taskMatch?.[1]
            || rawArgs.split(/\s+--/)[0]?.trim()
            || "Complete the task as instructed"

          const maxIterMatch = rawArgs.match(/--max-iterations=(\d+)/i)
          const promiseMatch = rawArgs.match(/--completion-promise=["']?([^"'\s]+)["']?/i)

          context.ralphLoop?.startLoop(sessionID, prompt, {
            ultrawork: true,
            maxIterations: maxIterMatch ? parseInt(maxIterMatch[1], 10) : undefined,
            completionPromise: promiseMatch?.[1],
          })
        }
      },
    })
  }

  nodes.push({
    id: "internal:stop-continuation-slash:tool.execute.before",
    invoke: async () => {
      if (input.tool !== "slashcommand") {
        return
      }

      const args = output.args as { command?: string }
      const command = args?.command?.replace(/^\//, "").toLowerCase()
      const sessionID = input.sessionID || context.getMainSessionID?.()

      if (command === "stop-continuation" && sessionID) {
        context.workOrchestrator?.stopContinuation(sessionID)
        context.taskAutoContinuation?.cancelAllCountdowns()
        context.ralphLoop?.cancelLoop(sessionID)
        if (context.directory) {
          createWorkStateManager(context.directory).clear()
        }
        log("[stop-continuation] All continuation mechanisms stopped", {
          sessionID,
        })
      }
    },
  })

  if (context.governanceEnabled) {
    nodes.push({
      id: "internal:governance-pre-tool:tool.execute.before",
      failurePolicy: "fail-closed",
      invoke: async () => {
        try {
          const govResult = executePreToolGovernance({
            sessionId: input.sessionID,
            toolName: input.tool,
            toolInput: output.args,
            toolUseId: input.callID,
            cwd: context.directory ?? process.cwd(),
            config: context.governanceConfig,
          })

          if (!govResult.proceed) {
            throw new Error(
              `${context.governanceBlockPrefix ?? DEFAULT_GOVERNANCE_BLOCK_PREFIX} ${
                govResult.reason ?? "Operation blocked"
              }`
            )
          }

          if (govResult.modifiedInput) {
            Object.assign(output.args, govResult.modifiedInput)
          }

          if (govResult.message) {
            output.message = `${output.message ?? ""}\n${govResult.message}`
          }
        } catch (err) {
          if (
            err instanceof Error
            && err.message.startsWith(
              context.governanceBlockPrefix ?? DEFAULT_GOVERNANCE_BLOCK_PREFIX
            )
          ) {
            throw err
          }

          log("[governance] Pre-tool error (non-fatal)", {
            sessionID: input.sessionID,
            tool: input.tool,
            error: err instanceof Error ? err.message : String(err),
          })
        }
      },
    })
  }

  if (context.silentToolOutput?.["tool.execute.before"]) {
    nodes.push({
      id: "silent-tool-output:tool.execute.before",
      invoke: async () => {
        await context.silentToolOutput?.["tool.execute.before"]?.(input, output)
      },
    })
  }

  return nodes
}
