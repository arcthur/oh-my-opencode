import { executePostToolGovernance } from "../../../features/governance"
import { extractCacheUsageSnapshot } from "../../../features/cache-observability/probe"
import { appendBudgetedOutput } from "../../../features/context-budget"
import { getPrefixFingerprintForSession } from "../../../features/context-injector"
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

export function buildToolExecuteAfterNodes(
  context: RuntimeAssemblyContext,
  input: ToolExecuteInput,
  output: ToolExecuteAfterOutput
): RuntimeExecutionNode[] {
  const nodes: RuntimeExecutionNode[] = []

  if (context.workOrchestrator?.["tool.execute.after"]) {
    nodes.push({
      id: "work-orchestrator:tool.execute.after",
      invoke: async () => {
        await context.workOrchestrator?.["tool.execute.after"]?.(input, output)
      },
    })
  }

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

  if (context.toolOutputTruncator?.["tool.execute.after"]) {
    nodes.push({
      id: "tool-output-truncator:tool.execute.after",
      invoke: async () => {
        await context.toolOutputTruncator?.["tool.execute.after"]?.(input, output)
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
          const usageSnapshot = extractCacheUsageSnapshot(metadata ?? output)
          const estimatedTokensUsed = Math.ceil(outputStr.length / 4)
          const resolvedTokensUsed =
            usageSnapshot.totalTokens > 0 ? usageSnapshot.totalTokens : estimatedTokensUsed
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

  if (context.contextWindowGovernor?.["tool.execute.after"]) {
    nodes.push({
      id: "context-window-governor:tool.execute.after",
      invoke: async () => {
        await context.contextWindowGovernor?.["tool.execute.after"]?.(input, output)
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

  if (context.toolOutputTruncator?.["tool.execute.after"]) {
    nodes.push({
      id: "internal:output-finalization:tool.execute.after",
      invoke: async () => {
        await context.toolOutputTruncator?.["tool.execute.after"]?.(input, output)
      },
    })
  }

  return nodes
}
