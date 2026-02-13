import { describe, expect, test } from "bun:test"
import { EVENT_TOTAL_ORDER } from "./pipeline-order"

function expectBetween(
  nodes: string[],
  target: string,
  before: string,
  after: string
): void {
  const targetIndex = nodes.indexOf(target)
  const beforeIndex = nodes.indexOf(before)
  const afterIndex = nodes.indexOf(after)

  expect(targetIndex, `${target} missing`).toBeGreaterThan(-1)
  expect(beforeIndex, `${before} missing`).toBeGreaterThan(-1)
  expect(afterIndex, `${after} missing`).toBeGreaterThan(-1)
  expect(targetIndex, `${target} should be after ${before}`).toBeGreaterThan(beforeIndex)
  expect(targetIndex, `${target} should be before ${after}`).toBeLessThan(afterIndex)
}

describe("policy pipeline deterministic insertion", () => {
  test("tool.execute.before policy nodes are inserted at fixed anchors", () => {
    const nodes = EVENT_TOTAL_ORDER["tool.execute.before"]

    expectBetween(
      nodes,
      "internal:policy-observe:tool.execute.before",
      "runtime-tracker:tool.execute.before",
      "bridge:claude-code-hooks:tool.execute.before"
    )

    expectBetween(
      nodes,
      "internal:policy-enforce:tool.execute.before",
      "internal:stop-continuation-slash:tool.execute.before",
      "internal:governance-pre-tool:tool.execute.before"
    )
  })

  test("tool.execute.after policy nodes are inserted at fixed anchors", () => {
    const nodes = EVENT_TOTAL_ORDER["tool.execute.after"]

    expectBetween(
      nodes,
      "internal:policy-observe:tool.execute.after",
      "work-orchestrator:tool.execute.after",
      "bridge:claude-code-hooks:tool.execute.after"
    )

    expectBetween(
      nodes,
      "internal:policy-enforce:tool.execute.after",
      "repo-overview-injector:tool.execute.after",
      "internal:governance-post-tool:tool.execute.after"
    )
  })

  test("experimental.chat.messages.transform policy nodes are inserted at fixed anchors", () => {
    const nodes = EVENT_TOTAL_ORDER["experimental.chat.messages.transform"]

    expectBetween(
      nodes,
      "internal:policy-observe:experimental.chat.messages.transform",
      "internal:context-injector:experimental.chat.messages.transform",
      "thinking-block-validator:experimental.chat.messages.transform"
    )

    expectBetween(
      nodes,
      "internal:policy-enforce:experimental.chat.messages.transform",
      "internal:policy-observe:experimental.chat.messages.transform",
      "thinking-block-validator:experimental.chat.messages.transform"
    )
  })

  test("chat.message policy nodes are inserted at fixed anchors", () => {
    const nodes = EVENT_TOTAL_ORDER["chat.message"]

    expectBetween(
      nodes,
      "internal:policy-observe:chat.message",
      "orchestrator-contextual-injector:chat.message",
      "bridge:claude-code-hooks:chat.message"
    )

    expectBetween(
      nodes,
      "internal:policy-enforce:chat.message",
      "auto-slash-command:chat.message",
      "start-work:chat.message"
    )
  })

  test("experimental.session.compacting policy nodes are inserted at fixed anchors", () => {
    const nodes = EVENT_TOTAL_ORDER["experimental.session.compacting"]
    const observeIndex = nodes.indexOf(
      "internal:policy-observe:experimental.session.compacting"
    )
    const bridgeIndex = nodes.indexOf(
      "bridge:claude-code-hooks:experimental.session.compacting"
    )
    const enforceIndex = nodes.indexOf(
      "internal:policy-enforce:experimental.session.compacting"
    )

    expect(observeIndex).toBeGreaterThanOrEqual(0)
    expect(bridgeIndex).toBeGreaterThanOrEqual(0)
    expect(enforceIndex).toBeGreaterThanOrEqual(0)
    expect(observeIndex).toBeLessThan(bridgeIndex)
    expect(bridgeIndex).toBeLessThan(enforceIndex)
  })
})
