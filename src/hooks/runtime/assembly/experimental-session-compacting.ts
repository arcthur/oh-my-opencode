import type { RuntimeExecutionNode } from "../types"
import { pushBudgetedContext } from "../../../features/context-view"
import type { PolicyDecision } from "../../../contracts"
import type {
  ExperimentalSessionCompactingInput,
  ExperimentalSessionCompactingOutput,
  RuntimeAssemblyContext,
} from "./types"

function applyCompactingMutations(params: {
  decisions: PolicyDecision[]
  output: ExperimentalSessionCompactingOutput
  sessionID: string
}): void {
  for (const decision of params.decisions) {
    if (decision.decision === "deny" && decision.enforcement === "hard") {
      throw new Error(decision.message ?? "Policy denied experimental.session.compacting")
    }

    if (decision.decision !== "modify" || !decision.mutation) {
      continue
    }

    const additionalContext = decision.mutation.additionalContext
    if (typeof additionalContext === "string") {
      pushBudgetedContext({
        output: params.output,
        sessionID: params.sessionID,
        source: "policy-runtime:compaction",
        id: `${decision.decisionId}:additional-context`,
        content: additionalContext,
        priority: "high",
      })
      continue
    }

    if (Array.isArray(additionalContext)) {
      for (const [index, item] of additionalContext.entries()) {
        if (typeof item !== "string" || item.length === 0) {
          continue
        }
        pushBudgetedContext({
          output: params.output,
          sessionID: params.sessionID,
          source: "policy-runtime:compaction",
          id: `${decision.decisionId}:additional-context:${index}`,
          content: item,
          priority: "high",
        })
      }
    }
  }
}

export function buildExperimentalSessionCompactingNodes(
  context: RuntimeAssemblyContext,
  input: ExperimentalSessionCompactingInput,
  output?: ExperimentalSessionCompactingOutput
): RuntimeExecutionNode[] {
  const nodes: RuntimeExecutionNode[] = []

  nodes.push({
    id: "internal:policy-observe:experimental.session.compacting",
    failurePolicy: "fail-open",
    invoke: async () => {
      await context.policyRuntime?.observe?.({
        hookPoint: "experimental.session.compacting",
        sessionID: input.sessionID,
        payload: {
          contextCount: Array.isArray(output?.context) ? output.context.length : 0,
        },
        traceHookNodeId: "internal:policy-observe:experimental.session.compacting",
      })
    },
  })

  if (
    context.claudeCodeBridgeEnabled
    && output
    && Array.isArray(output.context)
    && context.claudeCodeHooks?.["experimental.session.compacting"]
  ) {
    nodes.push({
      id: "bridge:claude-code-hooks:experimental.session.compacting",
      invoke: async () => {
        await context.claudeCodeHooks?.["experimental.session.compacting"]?.(input, output)
      },
    })
  }

  nodes.push({
    id: "internal:policy-enforce:experimental.session.compacting",
    failurePolicy: "fail-closed",
    invoke: async () => {
      const decisions = await context.policyRuntime?.enforce?.({
        hookPoint: "experimental.session.compacting",
        sessionID: input.sessionID,
        payload: {
          contextCount: Array.isArray(output?.context) ? output.context.length : 0,
        },
        traceHookNodeId: "internal:policy-enforce:experimental.session.compacting",
      })

      if (!decisions || decisions.length === 0) {
        return
      }

      if (!output) {
        for (const decision of decisions) {
          if (decision.decision === "deny" && decision.enforcement === "hard") {
            throw new Error(decision.message ?? "Policy denied experimental.session.compacting")
          }
        }
        return
      }

      applyCompactingMutations({
        decisions,
        output,
        sessionID: input.sessionID,
      })
    },
  })

  return nodes
}
