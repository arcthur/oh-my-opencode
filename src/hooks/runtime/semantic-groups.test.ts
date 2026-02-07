import { describe, expect, test } from "bun:test"
import { EVENT_TOTAL_ORDER } from "./pipeline-order"
import {
  DELEGATION_PROGRESS_STAGE_BY_HOOK,
  RECOVERY_MECHANISM_CATEGORY_BY_HOOK,
  validateSemanticGroups,
} from "./semantic-groups"
import type { HookEventType, HookNodeId } from "./types"

function cloneOrder(): Record<HookEventType, HookNodeId[]> {
  return JSON.parse(JSON.stringify(EVENT_TOTAL_ORDER)) as Record<
    HookEventType,
    HookNodeId[]
  >
}

describe("semantic groups", () => {
  test("recovery mechanism categories are complete and stable", () => {
    // #given #when
    const entries = Object.entries(RECOVERY_MECHANISM_CATEGORY_BY_HOOK)

    // #then
    expect(entries).toHaveLength(5)
    expect(RECOVERY_MECHANISM_CATEGORY_BY_HOOK["session-state-repair"]).toBe(
      "state-repair"
    )
    expect(RECOVERY_MECHANISM_CATEGORY_BY_HOOK["edit-failure-guidance"]).toBe(
      "failure-guidance"
    )
    expect(
      RECOVERY_MECHANISM_CATEGORY_BY_HOOK["delegation-failure-guidance"]
    ).toBe("failure-guidance")
    expect(
      RECOVERY_MECHANISM_CATEGORY_BY_HOOK["continuation-stop-guard"]
    ).toBe("continuation-control")
    expect(
      RECOVERY_MECHANISM_CATEGORY_BY_HOOK["todo-auto-continuation"]
    ).toBe("continuation-control")
  })

  test("delegation progress stage map is complete and stable", () => {
    // #given #when
    const entries = Object.entries(DELEGATION_PROGRESS_STAGE_BY_HOOK)

    // #then
    expect(entries).toHaveLength(4)
    expect(
      DELEGATION_PROGRESS_STAGE_BY_HOOK["delegation-block-subagent-question"]
    ).toBe("block")
    expect(
      DELEGATION_PROGRESS_STAGE_BY_HOOK["delegation-validate-decision"]
    ).toBe("validate")
    expect(
      DELEGATION_PROGRESS_STAGE_BY_HOOK["delegation-nudge-agent-usage"]
    ).toBe("nudge")
    expect(
      DELEGATION_PROGRESS_STAGE_BY_HOOK["delegation-nudge-category-skill"]
    ).toBe("nudge")
  })

  test("validation passes for current runtime order", () => {
    // #given
    const order = cloneOrder()

    // #when #then
    expect(() => validateSemanticGroups({ order })).not.toThrow()
  })

  test("throws when validate-stage runs before block-stage", () => {
    // #given
    const order = cloneOrder()
    const before = order["tool.execute.before"]
    const blockNode =
      "delegation-block-subagent-question:tool.execute.before"
    const validateNode = "delegation-validate-decision:tool.execute.before"
    const blockIndex = before.indexOf(blockNode)
    const validateIndex = before.indexOf(validateNode)
    expect(blockIndex).toBeGreaterThan(-1)
    expect(validateIndex).toBeGreaterThan(-1)

    before[blockIndex] = validateNode
    before[validateIndex] = blockNode

    // #when #then
    expect(() => validateSemanticGroups({ order })).toThrow(
      "block-stage hooks must run before validate-stage hooks"
    )
  })

  test("throws when nudge-stage hook is placed in tool.execute.before", () => {
    // #given
    const order = cloneOrder()
    const illegalNode = "delegation-nudge-agent-usage:tool.execute.before"
    order["tool.execute.before"].push(illegalNode)

    // #when #then
    expect(() => validateSemanticGroups({ order })).toThrow(
      "must run in tool.execute.after"
    )
  })
})
