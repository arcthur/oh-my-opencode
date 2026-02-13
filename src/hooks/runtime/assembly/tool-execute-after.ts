import { executePostToolGovernance } from "../../../features/governance"
import { extractCacheUsageSnapshot } from "../../../features/cache-observability/probe"
import { appendBudgetedOutput } from "../../../features/context-view"
import { getPrefixFingerprintForSession } from "../../../features/context-injector"
import type { PolicyDecision } from "../../../contracts"
import type { ExecutionBudgetSnapshot } from "../../../features/policy-runtime"
import type { ToolExecuteInput } from "../../../shared/hook-types"
import { log } from "../../../shared"
import type { RuntimeExecutionNode } from "../types"
import type { RuntimeAssemblyContext, ToolExecuteAfterOutput } from "./types"

export function resolvePrefixFingerprint(
  metadata: Record<string, unknown> | undefined,
  sessionID: string
): string | undefined {
  const fromMetadata = metadata?.prefixFingerprint
  if (typeof fromMetadata === "string" && fromMetadata.trim().length > 0) {
    return fromMetadata
  }
  return getPrefixFingerprintForSession(sessionID)
}

function enforcePolicyDecisionsOnToolAfter(params: {
  decisions: PolicyDecision[]
  output: ToolExecuteAfterOutput
}): void {
  for (const decision of params.decisions) {
    if (decision.decision === "deny" && decision.enforcement === "hard") {
      throw new Error(decision.message ?? "Policy denied tool.execute.after")
    }

    if (decision.decision !== "modify" || !decision.mutation) {
      continue
    }

    const mutation = decision.mutation

    const outputOverride = mutation.output
    if (typeof outputOverride === "string") {
      params.output.output = outputOverride
    }

    const titleOverride = mutation.title
    if (typeof titleOverride === "string") {
      params.output.title = titleOverride
    }

    const metadataPatch = mutation.metadata
    if (metadataPatch && typeof metadataPatch === "object" && !Array.isArray(metadataPatch)) {
      Object.assign(params.output.metadata, metadataPatch as Record<string, unknown>)
    }
  }
}

interface ToolTokenUsageResolution {
  usageSnapshot: ReturnType<typeof extractCacheUsageSnapshot>
  estimatedTokensUsed: number
  resolvedTokensUsed: number
}

function resolveToolTokenUsage(output: ToolExecuteAfterOutput): ToolTokenUsageResolution {
  const metadata = output.metadata as Record<string, unknown> | undefined
  const outputStr = typeof output.output === "string" ? output.output : ""
  const usageSnapshot = extractCacheUsageSnapshot(metadata ?? output)
  const estimatedTokensUsed = Math.ceil(outputStr.length / 4)
  const resolvedTokensUsed =
    usageSnapshot.totalTokens > 0 ? usageSnapshot.totalTokens : estimatedTokensUsed

  return {
    usageSnapshot,
    estimatedTokensUsed,
    resolvedTokensUsed,
  }
}

function appendContextPressureHint(params: {
  context: RuntimeAssemblyContext
  input: ToolExecuteInput
  output: ToolExecuteAfterOutput
  snapshot: ExecutionBudgetSnapshot
}): void {
  const { context, input, output, snapshot } = params
  if (
    !snapshot.tokenPressure
    || !context.executionBudgetManager?.shouldEmitCompactionHint(input.sessionID, snapshot)
  ) {
    return
  }

  const metadata = output.metadata as Record<string, unknown>
  metadata.policyContextPressure = true
  metadata.policyContextPressureRatio = Number(snapshot.pressureRatio.toFixed(3))
  metadata.policyContextTokenUsage = snapshot.estimatedRecentTokens
  metadata.policyContextTokenHardLimit = snapshot.contextTokensHardLimit

  appendBudgetedOutput({
    output,
    sessionID: input.sessionID,
    source: "policy-runtime:context-pressure",
    id: `${input.callID}:context-pressure`,
    priority: "high",
    oncePerSession: true,
    content:
      `\n\n[Policy Runtime] Context pressure is high ` +
      `(${snapshot.estimatedRecentTokens}/${snapshot.contextTokensHardLimit} tokens, ` +
      `${Math.round(snapshot.pressureRatio * 100)}%). ` +
      "Prioritize compacting stale context before continuing long tool chains.",
  })
}

function reportContextPressure(params: {
  context: RuntimeAssemblyContext
  input: ToolExecuteInput
  snapshot: ExecutionBudgetSnapshot
}): void {
  params.context.workOrchestrator?.onPolicyContextPressure?.({
    sessionID: params.input.sessionID,
    pressureRatio: params.snapshot.pressureRatio,
    estimatedRecentTokens: params.snapshot.estimatedRecentTokens,
    hardLimit: params.snapshot.contextTokensHardLimit,
  })
}

export function buildToolExecuteAfterNodes(
  context: RuntimeAssemblyContext,
  input: ToolExecuteInput,
  output: ToolExecuteAfterOutput
): RuntimeExecutionNode[] {
  const nodes: RuntimeExecutionNode[] = []
  let cachedTokenUsage: ToolTokenUsageResolution | undefined
  let cachedBudgetSnapshot: ExecutionBudgetSnapshot | undefined

  const getTokenUsage = (): ToolTokenUsageResolution => {
    if (!cachedTokenUsage) {
      cachedTokenUsage = resolveToolTokenUsage(output)
    }
    return cachedTokenUsage
  }

  const getExecutionBudgetSnapshot = (): ExecutionBudgetSnapshot | undefined => {
    if (cachedBudgetSnapshot) {
      return cachedBudgetSnapshot
    }
    if (!context.executionBudgetManager || !context.executionBudgetLimits) {
      return undefined
    }
    const usage = getTokenUsage()
    cachedBudgetSnapshot = context.executionBudgetManager.snapshot(
      input.sessionID,
      context.executionBudgetLimits,
      usage.resolvedTokensUsed
    )
    return cachedBudgetSnapshot
  }

  if (context.workOrchestrator?.["tool.execute.after"]) {
    nodes.push({
      id: "work-orchestrator:tool.execute.after",
      invoke: async () => {
        await context.workOrchestrator?.["tool.execute.after"]?.(input, output)
      },
    })
  }

  nodes.push({
    id: "internal:policy-observe:tool.execute.after",
    failurePolicy: "fail-open",
    invoke: async () => {
      const executionBudget = getExecutionBudgetSnapshot()
      await context.policyRuntime?.observe?.({
        hookPoint: "tool.execute.after",
        sessionID: input.sessionID,
        toolName: input.tool,
        agent: context.getSessionAgent?.(input.sessionID),
        payload: {
          guardsVersion: 1,
          callID: input.callID,
          title: output.title,
          outputLength: output.output.length,
          guards: executionBudget
            ? {
                executionBudget: {
                  toolCalls: executionBudget.toolCalls,
                  maxToolCalls: executionBudget.maxToolCalls,
                  elapsedMs: executionBudget.elapsedMs,
                  wallClockMs: executionBudget.wallClockMs,
                  contextTokens: executionBudget.estimatedRecentTokens,
                  contextTokensHardLimit: executionBudget.contextTokensHardLimit,
                  tokenPressure: executionBudget.tokenPressure,
                  pressureRatio: executionBudget.pressureRatio,
                },
              }
            : undefined,
        },
        traceHookNodeId: "internal:policy-observe:tool.execute.after",
      })
    },
  })

  if (context.claudeCodeBridgeEnabled && context.claudeCodeHooks?.["tool.execute.after"]) {
    nodes.push({
      id: "bridge:claude-code-hooks:tool.execute.after",
      invoke: async () => {
        await context.claudeCodeHooks?.["tool.execute.after"]?.(input, output)
      },
    })
  }

  if (context.antiSlopEnforcer?.["tool.execute.after"]) {
    nodes.push({
      id: "anti-slop-enforcer:tool.execute.after",
      invoke: async () => {
        await context.antiSlopEnforcer?.["tool.execute.after"]?.(input, output)
      },
    })
  }

  if (context.silentToolOutput?.["tool.execute.after"]) {
    nodes.push({
      id: "silent-tool-output:tool.execute.after",
      invoke: async () => {
        await context.silentToolOutput?.["tool.execute.after"]?.(input, output)
      },
    })
  }

  if (context.runtimeTracker?.["tool.execute.after"]) {
    nodes.push({
      id: "runtime-tracker:tool.execute.after",
      invoke: async () => {
        await context.runtimeTracker?.["tool.execute.after"]?.(input, output)
      },
    })
  }

  if (context.repoOverviewInjector?.["tool.execute.after"]) {
    nodes.push({
      id: "repo-overview-injector:tool.execute.after",
      invoke: async () => {
        await context.repoOverviewInjector?.["tool.execute.after"]?.(input, output)
      },
    })
  }

  nodes.push({
    id: "internal:policy-enforce:tool.execute.after",
    failurePolicy: "fail-closed",
    invoke: async () => {
      const executionBudget = getExecutionBudgetSnapshot()
      const decisions = await context.policyRuntime?.enforce?.({
        hookPoint: "tool.execute.after",
        sessionID: input.sessionID,
        toolName: input.tool,
        agent: context.getSessionAgent?.(input.sessionID),
        payload: {
          guardsVersion: 1,
          callID: input.callID,
          title: output.title,
          outputLength: output.output.length,
          guards: executionBudget
            ? {
                executionBudget: {
                  toolCalls: executionBudget.toolCalls,
                  maxToolCalls: executionBudget.maxToolCalls,
                  elapsedMs: executionBudget.elapsedMs,
                  wallClockMs: executionBudget.wallClockMs,
                  contextTokens: executionBudget.estimatedRecentTokens,
                  contextTokensHardLimit: executionBudget.contextTokensHardLimit,
                  tokenPressure: executionBudget.tokenPressure,
                  pressureRatio: executionBudget.pressureRatio,
                },
              }
            : undefined,
        },
        traceHookNodeId: "internal:policy-enforce:tool.execute.after",
      })

      if (!decisions || decisions.length === 0) {
        if (executionBudget) {
          reportContextPressure({
            context,
            input,
            snapshot: executionBudget,
          })
          appendContextPressureHint({
            context,
            input,
            output,
            snapshot: executionBudget,
          })
        }
        return
      }

      enforcePolicyDecisionsOnToolAfter({ decisions, output })

      if (executionBudget) {
        reportContextPressure({
          context,
          input,
          snapshot: executionBudget,
        })
        appendContextPressureHint({
          context,
          input,
          output,
          snapshot: executionBudget,
        })
      }
    },
  })

  if (context.governanceEnabled) {
    nodes.push({
      id: "internal:governance-post-tool:tool.execute.after",
      invoke: async () => {
        try {
          const metadata = output.metadata as Record<string, unknown> | undefined
          const outputStr = typeof output.output === "string" ? output.output : ""
          const outputLower = outputStr.toLowerCase()
          const exitCode = typeof metadata?.exitCode === "number" ? metadata.exitCode : undefined
          const explicitSuccess =
            typeof metadata?.success === "boolean" ? metadata.success : undefined
          const inferredSuccess =
            explicitSuccess
            ?? (exitCode !== undefined
              ? exitCode === 0
              : !outputLower.includes("error:") && !outputLower.includes("failed:"))
          const usage = getTokenUsage()
          const usageSnapshot = usage.usageSnapshot
          const resolvedTokensUsed = usage.resolvedTokensUsed
          const prefixFingerprint = resolvePrefixFingerprint(metadata, input.sessionID)

          const rawArgs =
            (metadata as { args?: unknown } | undefined)?.args
            ?? (output as { args?: unknown }).args
          const toolInput =
            rawArgs && typeof rawArgs === "object" && !Array.isArray(rawArgs)
              ? (rawArgs as Record<string, unknown>)
              : {}

          const govResult = await executePostToolGovernance({
            sessionId: input.sessionID,
            toolName: input.tool,
            toolInput,
            toolOutput: output as unknown as Record<string, unknown>,
            toolUseId: input.callID,
            success: inferredSuccess,
            tokensUsed: resolvedTokensUsed,
            cacheReadTokens: usageSnapshot.cacheReadTokens || undefined,
            cacheWriteTokens: usageSnapshot.cacheWriteTokens || undefined,
            cacheHitRatio: usageSnapshot.cacheHitRatio || undefined,
            prefixFingerprint,
            cwd: context.directory ?? process.cwd(),
            config: context.governanceConfig,
          })

          if (govResult.warnings.length > 0) {
            appendBudgetedOutput({
              output,
              sessionID: input.sessionID,
              source: "governance-post-tool",
              id: `${input.callID}:governance-warnings`,
              priority: "high",
              content: `\n\n${govResult.warnings.join("\n")}`,
            })
          }

          if (govResult.systemMessage) {
            appendBudgetedOutput({
              output,
              sessionID: input.sessionID,
              source: "governance-post-tool",
              id: `${input.callID}:governance-system-message`,
              priority: "high",
              content: `\n\n${govResult.systemMessage}`,
            })
          }

          if (govResult.checkpointCreated) {
            log("[governance] Auto-checkpoint created", { sessionID: input.sessionID })
          }

          if (govResult.block) {
            await context.client?.tui
              .showToast({
                body: {
                  title: "Budget Exhausted",
                  message: "Context budget limit reached. Consider wrapping up.",
                  variant: "warning",
                  duration: 5000,
                },
              })
              .catch(() => {})
          }
        } catch (err) {
          log("[governance] Post-tool error (non-fatal)", {
            sessionID: input.sessionID,
            tool: input.tool,
            error: err instanceof Error ? err.message : String(err),
          })
        }
      },
    })
  }

  if (context.userMemory?.["tool.execute.after"]) {
    nodes.push({
      id: "internal:user-memory:tool.execute.after",
      invoke: async () => {
        await context.userMemory?.["tool.execute.after"]?.(input, output)
      },
    })
  }

  if (context.orgMemory?.["tool.execute.after"]) {
    nodes.push({
      id: "internal:org-memory:tool.execute.after",
      invoke: async () => {
        await context.orgMemory?.["tool.execute.after"]?.(input, output)
      },
    })
  }

  if (context.commentChecker?.["tool.execute.after"]) {
    nodes.push({
      id: "comment-checker:tool.execute.after",
      invoke: async () => {
        await context.commentChecker?.["tool.execute.after"]?.(input, output)
      },
    })
  }

  if (context.directoryAgentsInjector?.["tool.execute.after"]) {
    nodes.push({
      id: "directory-agents-injector:tool.execute.after",
      invoke: async () => {
        await context.directoryAgentsInjector?.["tool.execute.after"]?.(input, output)
      },
    })
  }

  if (context.directoryReadmeInjector?.["tool.execute.after"]) {
    nodes.push({
      id: "directory-readme-injector:tool.execute.after",
      invoke: async () => {
        await context.directoryReadmeInjector?.["tool.execute.after"]?.(input, output)
      },
    })
  }

  if (context.rulesInjector?.["tool.execute.after"]) {
    nodes.push({
      id: "rules-injector:tool.execute.after",
      invoke: async () => {
        await context.rulesInjector?.["tool.execute.after"]?.(input, output)
      },
    })
  }

  if (context.emptyTaskResponseDetector?.["tool.execute.after"]) {
    nodes.push({
      id: "empty-task-response-detector:tool.execute.after",
      invoke: async () => {
        await context.emptyTaskResponseDetector?.["tool.execute.after"]?.(input, output)
      },
    })
  }

  if (context.delegationNudgeAgentUsage?.["tool.execute.after"]) {
    nodes.push({
      id: "delegation-nudge-agent-usage:tool.execute.after",
      invoke: async () => {
        await context.delegationNudgeAgentUsage?.["tool.execute.after"]?.(input, output)
      },
    })
  }

  if (context.delegationNudgeCategorySkill?.["tool.execute.after"]) {
    nodes.push({
      id: "delegation-nudge-category-skill:tool.execute.after",
      invoke: async () => {
        await context.delegationNudgeCategorySkill?.["tool.execute.after"]?.(input, output)
      },
    })
  }

  if (context.interactiveBashSession?.["tool.execute.after"]) {
    nodes.push({
      id: "interactive-bash-session:tool.execute.after",
      invoke: async () => {
        await context.interactiveBashSession?.["tool.execute.after"]?.(input, output)
      },
    })
  }

  if (context.editFailureGuidance?.["tool.execute.after"]) {
    nodes.push({
      id: "edit-failure-guidance:tool.execute.after",
      invoke: async () => {
        await context.editFailureGuidance?.["tool.execute.after"]?.(input, output)
      },
    })
  }

  if (context.delegationFailureGuidance?.["tool.execute.after"]) {
    nodes.push({
      id: "delegation-failure-guidance:tool.execute.after",
      invoke: async () => {
        await context.delegationFailureGuidance?.["tool.execute.after"]?.(input, output)
      },
    })
  }

  if (context.taskResumeInfo?.["tool.execute.after"]) {
    nodes.push({
      id: "internal:task-resume-info:tool.execute.after",
      invoke: async () => {
        await context.taskResumeInfo?.["tool.execute.after"]?.(input, output)
      },
    })
  }

  if (context.sessionHandoffHook?.["tool.execute.after"]) {
    nodes.push({
      id: "session-handoff:tool.execute.after",
      invoke: async () => {
        await context.sessionHandoffHook?.["tool.execute.after"]?.(input, output)
      },
    })
  }

  if (context.swarmAgent?.["tool.execute.after"]) {
    nodes.push({
      id: "swarm-agent:tool.execute.after",
      invoke: async () => {
        await context.swarmAgent?.["tool.execute.after"]?.(input, output)
      },
    })
  }

  return nodes
}
