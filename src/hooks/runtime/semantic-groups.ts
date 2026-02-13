import type { HookEventType, HookNodeId } from "./types"

export type RecoveryMechanismCategory =
  | "state-repair"
  | "failure-guidance"
  | "work-orchestrator-continuation"

export type RecoveryMechanismHook =
  | "session-state-repair"
  | "edit-failure-guidance"
  | "delegation-failure-guidance"
  | "work-orchestrator"
  | "task-auto-continuation"
  | "unstable-agent-watchdog"

export const RECOVERY_MECHANISM_CATEGORY_BY_HOOK: Record<
  RecoveryMechanismHook,
  RecoveryMechanismCategory
> = {
  "session-state-repair": "state-repair",
  "edit-failure-guidance": "failure-guidance",
  "delegation-failure-guidance": "failure-guidance",
  "work-orchestrator": "work-orchestrator-continuation",
  "task-auto-continuation": "work-orchestrator-continuation",
  "unstable-agent-watchdog": "work-orchestrator-continuation",
}

export type DelegationProgressStage = "block" | "validate" | "nudge"

export type DelegationProgressHook =
  | "delegation-validate-decision"
  | "delegation-nudge-agent-usage"
  | "delegation-nudge-category-skill"

export const DELEGATION_PROGRESS_STAGE_BY_HOOK: Record<
  DelegationProgressHook,
  DelegationProgressStage
> = {
  "delegation-validate-decision": "validate",
  "delegation-nudge-agent-usage": "nudge",
  "delegation-nudge-category-skill": "nudge",
}

const DELEGATION_EXPECTED_EVENT_BY_STAGE: Record<
  DelegationProgressStage,
  "tool.execute.before" | "tool.execute.after"
> = {
  block: "tool.execute.before",
  validate: "tool.execute.before",
  nudge: "tool.execute.after",
}

function getNodeId(
  hook: DelegationProgressHook,
  event: HookEventType
): HookNodeId {
  return `${hook}:${event}` as HookNodeId
}

export function validateSemanticGroups(params: {
  order: Record<HookEventType, HookNodeId[]>
}): void {
  const { order } = params

  for (const [hook, stage] of Object.entries(
    DELEGATION_PROGRESS_STAGE_BY_HOOK
  ) as Array<[DelegationProgressHook, DelegationProgressStage]>) {
    const expectedEvent = DELEGATION_EXPECTED_EVENT_BY_STAGE[stage]
    const expectedNode = getNodeId(hook, expectedEvent)

    if (!order[expectedEvent].includes(expectedNode)) {
      throw new Error(
        `Delegation stage hook ${hook} (${stage}) must run in ${expectedEvent}`
      )
    }

    if (stage === "nudge") {
      const disallowedBeforeNode = getNodeId(hook, "tool.execute.before")
      if (order["tool.execute.before"].includes(disallowedBeforeNode)) {
        throw new Error(
          `Delegation stage hook ${hook} (${stage}) must run in tool.execute.after`
        )
      }
      continue
    }

    const disallowedAfterNode = getNodeId(hook, "tool.execute.after")
    if (order["tool.execute.after"].includes(disallowedAfterNode)) {
      throw new Error(
        `Delegation stage hook ${hook} (${stage}) must run in tool.execute.before`
      )
    }
  }

  const beforeOrder = order["tool.execute.before"]
  const blockIndices = Object.entries(DELEGATION_PROGRESS_STAGE_BY_HOOK)
    .filter(([, stage]) => stage === "block")
    .map(([hook]) =>
      beforeOrder.indexOf(
        getNodeId(
          hook as DelegationProgressHook,
          "tool.execute.before"
        )
      )
    )
  const validateIndices = Object.entries(DELEGATION_PROGRESS_STAGE_BY_HOOK)
    .filter(([, stage]) => stage === "validate")
    .map(([hook]) =>
      beforeOrder.indexOf(
        getNodeId(
          hook as DelegationProgressHook,
          "tool.execute.before"
        )
      )
    )

  if (blockIndices.some((index) => index < 0)) {
    throw new Error("Delegation block-stage hooks are missing from tool.execute.before")
  }
  if (validateIndices.some((index) => index < 0)) {
    throw new Error(
      "Delegation validate-stage hooks are missing from tool.execute.before"
    )
  }

  const latestBlockIndex = Math.max(...blockIndices)
  const earliestValidateIndex = Math.min(...validateIndices)
  if (latestBlockIndex >= earliestValidateIndex) {
    throw new Error(
      "Delegation stage order violation: block-stage hooks must run before validate-stage hooks"
    )
  }
}
