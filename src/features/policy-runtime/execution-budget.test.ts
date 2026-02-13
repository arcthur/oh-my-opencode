import { describe, expect, test } from "bun:test"
import {
  SessionExecutionBudgetManager,
  type ExecutionBudgetLimits,
} from "./execution-budget"

const LIMITS: ExecutionBudgetLimits = {
  maxToolCalls: 2,
  wallClockMs: 1000,
  contextTokensHardLimit: 100,
}

describe("SessionExecutionBudgetManager", () => {
  test("admits tool calls until max_tool_calls limit", () => {
    let now = 0
    const manager = new SessionExecutionBudgetManager({
      now: () => now,
    })

    const first = manager.admitToolCall("s1", LIMITS)
    const second = manager.admitToolCall("s1", LIMITS)
    const third = manager.admitToolCall("s1", LIMITS)

    expect(first.allowed).toBe(true)
    expect(second.allowed).toBe(true)
    expect(third.allowed).toBe(false)
    expect(third.reasonCode).toBe("MAX_TOOL_CALLS_EXCEEDED")
    expect(third.snapshot.toolCalls).toBe(2)
  })

  test("denies tool call when wall clock budget is exceeded", () => {
    let now = 0
    const manager = new SessionExecutionBudgetManager({
      now: () => now,
    })
    manager.admitToolCall("s2", LIMITS)

    now = 1001
    const result = manager.admitToolCall("s2", LIMITS)

    expect(result.allowed).toBe(false)
    expect(result.reasonCode).toBe("WALL_CLOCK_BUDGET_EXCEEDED")
    expect(result.snapshot.elapsedMs).toBe(1001)
  })

  test("marks context pressure and throttles compaction hints", () => {
    let now = 0
    const manager = new SessionExecutionBudgetManager({
      now: () => now,
      compactionHintCooldownMs: 5000,
      pressureRatio: 0.9,
    })

    const relaxed = manager.snapshot("s3", LIMITS, 50)
    const pressured = manager.snapshot("s3", LIMITS, 95)

    expect(relaxed.tokenPressure).toBe(false)
    expect(pressured.tokenPressure).toBe(true)
    expect(manager.shouldEmitCompactionHint("s3", pressured)).toBe(true)
    expect(manager.shouldEmitCompactionHint("s3", pressured)).toBe(false)

    now = 5001
    expect(manager.shouldEmitCompactionHint("s3", pressured)).toBe(true)
  })

  test("snapshot returns clamped contextTokensHardLimit not raw value", () => {
    const mgr = new SessionExecutionBudgetManager()
    const snap = mgr.snapshot("s1", { maxToolCalls: 10, wallClockMs: 60000, contextTokensHardLimit: 0 }, 100)
    expect(snap.contextTokensHardLimit).toBe(1) // clamped, not 0
    expect(snap.estimatedRecentTokens).toBe(100)
    expect(snap.tokenPressure).toBe(true) // 100/1 >= 0.9
  })
})
