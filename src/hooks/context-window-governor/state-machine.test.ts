import { describe, expect, test } from "bun:test"
import { createContextWindowStateMachine } from "./state-machine"

describe("context-window state machine", () => {
  test("triggers warning and preemptive only on boundary transitions", () => {
    // #given
    const machine = createContextWindowStateMachine({
      warningRatio: 0.7,
      preemptiveRatio: 0.78,
      warningResetRatio: 0.65,
      preemptiveResetRatio: 0.73,
    })

    // #when
    const warned = machine.onUsage("s1", 0.71)
    const warnedAgain = machine.onUsage("s1", 0.75)
    const preemptive = machine.onUsage("s1", 0.79)
    const preemptiveAgain = machine.onUsage("s1", 0.82)

    // #then
    expect(warned.shouldWarn).toBe(true)
    expect(warnedAgain.shouldWarn).toBe(false)
    expect(preemptive.shouldPreemptiveCompact).toBe(true)
    expect(preemptiveAgain.shouldPreemptiveCompact).toBe(false)
  })

  test("supports re-entry after ratio drops below reset thresholds", () => {
    // #given
    const machine = createContextWindowStateMachine({
      warningRatio: 0.7,
      preemptiveRatio: 0.78,
      warningResetRatio: 0.65,
      preemptiveResetRatio: 0.73,
    })

    machine.onUsage("s2", 0.8)

    // #when
    machine.onCompactionFinished("s2")
    machine.onUsage("s2", 0.64)
    const warnedAgain = machine.onUsage("s2", 0.71)
    const preemptiveAgain = machine.onUsage("s2", 0.79)

    // #then
    expect(warnedAgain.shouldWarn).toBe(true)
    expect(preemptiveAgain.shouldPreemptiveCompact).toBe(true)
  })

  test("does not emit warning while still in preemptive band", () => {
    // #given
    const machine = createContextWindowStateMachine({
      warningRatio: 0.7,
      preemptiveRatio: 0.78,
      warningResetRatio: 0.65,
      preemptiveResetRatio: 0.73,
    })

    // #when
    const first = machine.onUsage("s3", 0.8)
    const second = machine.onUsage("s3", 0.8)

    // #then
    expect(first.shouldPreemptiveCompact).toBe(true)
    expect(second.shouldWarn).toBe(false)
  })

  test("stops scheduling recovery after exhaustion until reset thresholds re-arm", () => {
    // #given
    const machine = createContextWindowStateMachine({
      warningRatio: 0.7,
      preemptiveRatio: 0.78,
      warningResetRatio: 0.65,
      preemptiveResetRatio: 0.73,
      limitRatio: 1.0,
    })

    // #when
    machine.onRecoveryExhausted("s4")
    const blocked = machine.onUsage("s4", 1.0)
    machine.onUsage("s4", 0.64)
    const rearmed = machine.onUsage("s4", 1.0)

    // #then
    expect(blocked.shouldRecover).toBe(false)
    expect(rearmed.shouldRecover).toBe(true)
  })
})
