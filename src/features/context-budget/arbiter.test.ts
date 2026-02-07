import { beforeEach, describe, expect, test } from "bun:test"
import { ContextBudgetArbiter } from "./arbiter"
import type { BudgetRequest } from "./types"

function createRequest(overrides: Partial<BudgetRequest> = {}): BudgetRequest {
  return {
    sessionID: "session-1",
    source: "test-source",
    channel: "tool-output",
    id: "ctx-1",
    priority: "normal",
    content: "hello world",
    ...overrides,
  }
}

describe("ContextBudgetArbiter", () => {
  let arbiter: ContextBudgetArbiter

  beforeEach(() => {
    arbiter = new ContextBudgetArbiter()
    arbiter.setBudgetConfig({
      total_budget: 100,
      reserved_budget: 20,
      overflow_strategy: "drop-low-priority",
    })
  })

  test("enforces hard total budget", () => {
    // #given
    arbiter.setBudgetConfig({ reserved_budget: 0 })
    const chunk = "x".repeat(200) // 50 tokens

    // #when
    const first = arbiter.decide(createRequest({ id: "a", content: chunk }))
    const second = arbiter.decide(createRequest({ id: "b", content: chunk }))
    const third = arbiter.decide(createRequest({ id: "c", content: chunk }))

    // #then
    expect(first.accepted).toBe(true)
    expect(second.accepted).toBe(true)
    expect(third.accepted).toBe(false)
    expect(third.reason).toBe("dropped_total")
  })

  test("protects reserve for high/critical priorities", () => {
    // #given
    const normalChunk = "n".repeat(320) // 80 tokens
    const highChunk = "h".repeat(80) // 20 tokens

    // #when
    const normal = arbiter.decide(createRequest({
      id: "normal",
      priority: "normal",
      content: normalChunk,
    }))
    const high = arbiter.decide(createRequest({
      id: "high",
      priority: "high",
      content: highChunk,
    }))

    // #then
    expect(normal.accepted).toBe(true)
    expect(high.accepted).toBe(true)
    expect(high.finalTokens).toBeGreaterThan(0)
  })

  test("applies source limits", () => {
    // #given
    arbiter.setBudgetConfig({
      source_limits: {
        "test-source": 10,
      },
    })
    const chunk = "z".repeat(80) // 20 tokens

    // #when
    const normal = arbiter.decide(createRequest({ id: "normal-limit", content: chunk }))
    const high = arbiter.decide(createRequest({
      id: "high-limit",
      priority: "high",
      content: chunk,
    }))

    // #then
    expect(normal.accepted).toBe(false)
    expect(normal.reason).toBe("dropped_source")
    expect(high.accepted).toBe(true)
    expect(high.reason).toBe("truncated")
    expect(high.finalTokens).toBe(10)
  })

  test("applies channel limits", () => {
    // #given
    arbiter.setBudgetConfig({
      channel_limits: {
        "tool-output": 10,
      },
      overflow_strategy: "truncate",
    })
    const chunk = "a".repeat(80) // 20 tokens

    // #when
    const decision = arbiter.decide(createRequest({ id: "channel-limit", content: chunk }))

    // #then
    expect(decision.accepted).toBe(true)
    expect(decision.reason).toBe("truncated")
    expect(decision.finalTokens).toBe(10)
  })

  test("enforces once-per-session", () => {
    // #given
    const request = createRequest({
      id: "once",
      oncePerSession: true,
    })

    // #when
    const first = arbiter.decide(request)
    const second = arbiter.decide(request)

    // #then
    expect(first.accepted).toBe(true)
    expect(second.accepted).toBe(false)
    expect(second.reason).toBe("once_per_session")
  })

  test("resets turn usage on beginTurn", () => {
    // #given
    const chunk = "x".repeat(400) // 100 tokens
    const first = arbiter.decide(createRequest({ id: "before-reset", content: chunk }))

    // #when
    arbiter.beginTurn("session-1")
    const afterReset = arbiter.decide(createRequest({ id: "after-reset", content: chunk }))

    // #then
    expect(first.accepted).toBe(false)
    expect(afterReset.accepted).toBe(false)
    // switch to truncate to verify reset allows a fresh allocation path
    arbiter.setBudgetConfig({ overflow_strategy: "truncate" })
    arbiter.beginTurn("session-1")
    const truncated = arbiter.decide(createRequest({ id: "after-reset-2", content: chunk }))
    expect(truncated.accepted).toBe(true)
    expect(truncated.finalTokens).toBeGreaterThan(0)
  })
})
