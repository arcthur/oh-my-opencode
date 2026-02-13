import { executePreToolGovernance } from "../../../features/governance"
import { createWorkStateManager } from "../../../features/work-state"
import { isSubagentSession } from "../../../features/claude-code-session-state"
import { log } from "../../../shared"
import type { PolicyDecision } from "../../../contracts"
import type { ToolExecuteInput } from "../../../shared/hook-types"
import type { ExecutionBudgetSnapshot } from "../../../features/policy-runtime"
import {
  PROMETHEUS_MUTATION_TOOLS,
  PROMETHEUS_AGENTS,
} from "../../../features/policy-runtime/prometheus-policy"
import { SYSTEM_DIRECTIVE_PREFIX } from "../../../shared/system-directive"
import { existsSync } from "node:fs"
import { isAbsolute, join, normalize, relative, resolve, sep } from "node:path"
import type { RuntimeExecutionNode } from "../types"
import type { RuntimeAssemblyContext, ToolExecuteBeforeOutput } from "./types"

const DEFAULT_GOVERNANCE_BLOCK_PREFIX = "Governance blocked:"

function resolveFilePath(args: Record<string, unknown>): string | undefined {
  const value = args.filePath ?? args.path ?? args.file_path ?? args.file
  return typeof value === "string" ? value : undefined
}

function isPrometheusAgent(agentName: string | undefined): boolean {
  if (!agentName) {
    return false
  }
  const lowered = agentName.toLowerCase()
  return PROMETHEUS_AGENTS.some((name) => lowered.includes(name.toLowerCase()))
}

function isAllowedPrometheusFile(filePath: string, workspaceRoot: string): boolean {
  const resolved = resolve(workspaceRoot, filePath)
  const rel = relative(workspaceRoot, resolved)
  if (rel.startsWith("..") || isAbsolute(rel)) {
    return false
  }
  if (!/\.sisyphus[/\\]/i.test(rel)) {
    return false
  }
  return resolved.toLowerCase().endsWith(".md")
}

function resolvePolicyGuards(
  context: RuntimeAssemblyContext,
  input: ToolExecuteInput,
  output: ToolExecuteBeforeOutput,
  executionBudget?: ExecutionBudgetSnapshot
): Record<string, unknown> {
  const toolName = input.tool
  const toolNameLower = toolName.toLowerCase()
  const args = output.args
  const filePath = resolveFilePath(args)
  const cwd = context.directory ?? process.cwd()
  const resolvedPath = filePath
    ? normalize(isAbsolute(filePath) ? filePath : resolve(cwd, filePath))
    : undefined

  const fileExists = resolvedPath ? existsSync(resolvedPath) : false
  const sisyphusRoot = join(cwd, ".sisyphus") + sep
  const isSisyphusMarkdown =
    Boolean(resolvedPath)
    && Boolean(resolvedPath?.startsWith(sisyphusRoot))
    && Boolean(resolvedPath?.toLowerCase().endsWith(".md"))

  const sessionAgent = context.getSessionAgent?.(input.sessionID)
  const prometheusAgent = isPrometheusAgent(sessionAgent)
  const prometheusBlockedTool = PROMETHEUS_MUTATION_TOOLS.includes(toolName)
  const prometheusAllowedFile = filePath
    ? isAllowedPrometheusFile(filePath, cwd)
    : true
  const normalizedFilePath = filePath?.toLowerCase().replace(/\\/g, "/") ?? ""
  const prompt = typeof args.prompt === "string" ? args.prompt : undefined
  const verifierGuard = context.workOrchestrator?.getVerifierGuard?.({
    sessionID: input.sessionID,
    callID: input.callID,
    tool: input.tool,
    args,
  })

  return {
    writeExistingFile: {
      blocked:
        toolNameLower === "write"
        && Boolean(filePath)
        && fileExists
        && !isSisyphusMarkdown,
      filePath,
      resolvedPath,
    },
    subagentQuestion: {
      blocked:
        (toolNameLower === "question" || toolNameLower === "askuserquestion")
        && isSubagentSession(input.sessionID),
    },
    prometheus: {
      isPrometheus: prometheusAgent,
      blockedWrite:
        prometheusAgent
        && prometheusBlockedTool
        && Boolean(filePath)
        && !prometheusAllowedFile,
      taskWarning:
        prometheusAgent
        && (toolNameLower === "task" || toolNameLower === "delegate_task")
        && Boolean(prompt)
        && !prompt!.includes(SYSTEM_DIRECTIVE_PREFIX),
      planReminder:
        prometheusAgent
        && prometheusBlockedTool
        && Boolean(filePath)
        && prometheusAllowedFile
        && normalizedFilePath.includes(".sisyphus/plans/"),
      filePath,
      agent: sessionAgent,
    },
    executionBudget: executionBudget
      ? {
          toolCalls: executionBudget.toolCalls,
          maxToolCalls: executionBudget.maxToolCalls,
          elapsedMs: executionBudget.elapsedMs,
          wallClockMs: executionBudget.wallClockMs,
        }
      : undefined,
    verifier: verifierGuard
      ? {
          blocked: verifierGuard.blocked,
          reasonCode: verifierGuard.reasonCode,
          missingEvidence: verifierGuard.missingEvidence,
          denialCount: verifierGuard.denialCount,
          details: verifierGuard.details,
        }
      : undefined,
  }
}

function enforcePolicyDecisionsOnToolBefore(params: {
  decisions: PolicyDecision[]
  output: ToolExecuteBeforeOutput
}): void {
  for (const decision of params.decisions) {
    if (decision.decision === "deny" && decision.enforcement === "hard") {
      throw new Error(decision.message ?? "Policy denied tool.execute.before")
    }

    if (decision.decision !== "modify" || !decision.mutation) {
      continue
    }

    const mutationArgs = decision.mutation.args
    if (mutationArgs && typeof mutationArgs === "object" && !Array.isArray(mutationArgs)) {
      Object.assign(params.output.args, mutationArgs as Record<string, unknown>)
      continue
    }

    const argsPromptPrepend = decision.mutation.argsPromptPrepend
    if (
      typeof argsPromptPrepend === "string"
      && typeof params.output.args.prompt === "string"
    ) {
      params.output.args.prompt = `${argsPromptPrepend}${params.output.args.prompt}`
    }

    const argsPromptAppend = decision.mutation.argsPromptAppend
    if (
      typeof argsPromptAppend === "string"
      && typeof params.output.args.prompt === "string"
    ) {
      params.output.args.prompt = `${params.output.args.prompt}${argsPromptAppend}`
    }

    const messageAppend = decision.mutation.messageAppend
    if (typeof messageAppend === "string") {
      params.output.message = `${params.output.message ?? ""}${messageAppend}`
    }
  }
}

export function buildToolExecuteBeforeNodes(
  context: RuntimeAssemblyContext,
  input: ToolExecuteInput,
  output: ToolExecuteBeforeOutput
): RuntimeExecutionNode[] {
  const nodes: RuntimeExecutionNode[] = []
  let cachedGuards: Record<string, unknown> | undefined
  let lastPolicyDecisions: PolicyDecision[] | undefined

  const getPolicyGuards = (): Record<string, unknown> => {
    if (cachedGuards) {
      return cachedGuards
    }

    const budgetLimits = context.executionBudgetLimits
    const budgetAdmission =
      context.executionBudgetManager && budgetLimits
        ? context.executionBudgetManager.admitToolCall(input.sessionID, budgetLimits)
        : undefined
    if (budgetAdmission && !budgetAdmission.allowed) {
      throw new Error(budgetAdmission.message ?? "Execution budget exceeded")
    }

    cachedGuards = resolvePolicyGuards(
      context,
      input,
      output,
      budgetAdmission?.snapshot
    )
    return cachedGuards
  }

  if (context.questionLabelTruncator?.["tool.execute.before"]) {
    nodes.push({
      id: "question-label-truncator:tool.execute.before",
      invoke: async () => {
        await context.questionLabelTruncator?.["tool.execute.before"]?.(input, output)
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

  nodes.push({
    id: "internal:policy-observe:tool.execute.before",
    failurePolicy: "fail-open",
    invoke: async () => {
      const guards = getPolicyGuards()
      await context.policyRuntime?.observe?.({
        hookPoint: "tool.execute.before",
        sessionID: input.sessionID,
        toolName: input.tool,
        agent: context.getSessionAgent?.(input.sessionID),
        payload: {
          guardsVersion: 1,
          callID: input.callID,
          args: output.args,
          guards,
        },
        traceHookNodeId: "internal:policy-observe:tool.execute.before",
      })
    },
  })

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

  nodes.push({
    id: "internal:policy-enforce:tool.execute.before",
    failurePolicy: "fail-closed",
    invoke: async () => {
      const guards = getPolicyGuards()
      const decisions = await context.policyRuntime?.enforce?.({
        hookPoint: "tool.execute.before",
        sessionID: input.sessionID,
        toolName: input.tool,
        agent: context.getSessionAgent?.(input.sessionID),
        payload: {
          guardsVersion: 1,
          callID: input.callID,
          args: output.args,
          guards,
        },
        traceHookNodeId: "internal:policy-enforce:tool.execute.before",
      })

      if (!decisions || decisions.length === 0) {
        return
      }

      lastPolicyDecisions = decisions
      enforcePolicyDecisionsOnToolBefore({ decisions, output })
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
            const appliedDecisions = lastPolicyDecisions?.filter(
              (d) => !(d.decision === "deny" && d.enforcement === "hard")
            )
            if (appliedDecisions && appliedDecisions.length > 0) {
              context.policyRuntime?.recordSuperseded?.({
                sessionID: input.sessionID,
                hookPoint: "tool.execute.before",
                decisions: appliedDecisions,
                reason: govResult.reason ?? "Governance blocked after policy allowed",
              })
            }
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
