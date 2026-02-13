import type { OhMyOpenCodeConfig } from "../../config"
import type { ContractClause, ExecutionContract } from "../../contracts"
import { getBuiltinPolicyClauses } from "./builtin-clauses"

const DEFAULT_BUDGET_PROFILE = {
  context_tokens_target: 240000,
  context_tokens_hard_limit: 320000,
  reasoning_budget: "medium" as const,
  max_tool_calls: 30,
  wall_clock_ms: 120000,
}

const DEFAULT_MODEL_POLICY = {
  primary: "openai/gpt-5.3-codex" as const,
  provider_priority: ["openai", "google", "anthropic"] as const,
  allow_fallback: true as const,
}

function mapClause(
  clause: NonNullable<OhMyOpenCodeConfig["contracts"]>["clauses"][number]
): ContractClause {
  return {
    id: clause.id,
    description: clause.description,
    hookPoints: clause.hook_points,
    enforcement: clause.enforcement,
    selector: {
      toolName: clause.selector.tool_name,
      agent: clause.selector.agent,
      sessionTags: clause.selector.session_tags,
    },
    condition: clause.condition,
    action: {
      type: (clause.action.type as ContractClause["action"]["type"] | undefined) ?? "audit",
      mutation:
        clause.action.mutation && typeof clause.action.mutation === "object"
          ? (clause.action.mutation as Record<string, unknown>)
          : undefined,
      message: typeof clause.action.message === "string" ? clause.action.message : undefined,
    },
    priority: clause.priority,
    conflictResolution: clause.conflict_resolution,
    enabled: clause.enabled,
    version: clause.version,
    provenance: {
      author: clause.provenance.author,
      source: clause.provenance.source,
      createdAt: clause.provenance.created_at,
    },
    reasonCode: clause.reason_code,
  }
}

export function buildExecutionContract(params: {
  config: OhMyOpenCodeConfig
  taskId: string
}): ExecutionContract {
  const { config, taskId } = params
  const profile =
    config.budget_profiles?.default
    ?? Object.values(config.budget_profiles ?? {})[0]
    ?? DEFAULT_BUDGET_PROFILE
  const modelPolicy = config.model_policy ?? DEFAULT_MODEL_POLICY
  const defaultConflictResolution = config.contracts?.conflict_resolution ?? "most-restrictive"
  const builtinClauses = getBuiltinPolicyClauses()
  const configuredClauses = (config.contracts?.clauses ?? []).map(mapClause)
  const clauses = [...builtinClauses, ...configuredClauses]

  return {
    taskId,
    clauses,
    defaultConflictResolution,
    budgets: {
      contextProfile: profile.context_tokens_hard_limit > 400000 ? "profile_600" : "profile_400",
      contextTokensTarget: profile.context_tokens_target,
      contextTokensHardLimit: profile.context_tokens_hard_limit,
      reasoningBudget: profile.reasoning_budget,
      maxToolCalls: profile.max_tool_calls,
      wallClockMs: profile.wall_clock_ms,
    },
    modelPolicy: {
      primary: modelPolicy.primary,
      providerPriority: [...modelPolicy.provider_priority],
      allowFallback: modelPolicy.allow_fallback,
      minContextWindow: profile.context_tokens_hard_limit > 400000 ? 600000 : 400000,
    },
  }
}
