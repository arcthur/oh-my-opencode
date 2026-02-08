import { describe, expect, mock, test } from "bun:test"
import { createContinuationControl, type ContinuationControlConfig, type ContinuationIntentOutcome } from "./index"

function createConfig(overrides?: Partial<ContinuationControlConfig>): ContinuationControlConfig {
  return {
    post_compaction_grace_ms: 1500,
    priority: {
      "execution-orchestrator": 400,
      "ralph-loop": 300,
      "todo-auto-continuation": 200,
      "planning-with-files": 100,
    },
    ...overrides,
  }
}

describe("continuation-control", () => {
  test("arbitrates by priority for intents reported outside idle round", async () => {
    // #given
    const promptCalls: string[] = []
    const promptAsync = mock(async (args: any) => {
      promptCalls.push(args.body.parts[0].text)
      return {}
    })

    const outcomes: Record<string, ContinuationIntentOutcome> = {}

    const control = createContinuationControl(
      {
        directory: "/tmp/test",
        client: { session: { promptAsync } },
      } as any,
      {
        config: createConfig(),
        isContinuationStopped: () => false,
      }
    )

    // #when - report lower-priority first, then higher-priority
    void control.reportIntent({
      sessionID: "session-immediate",
      source: "todo-auto-continuation",
      reason: "todo",
      prompt: { text: "todo continuation" },
      onResult: (result) => {
        outcomes.todo = result
      },
    })

    void control.reportIntent({
      sessionID: "session-immediate",
      source: "execution-orchestrator",
      reason: "execution",
      prompt: { text: "execution continuation", agent: "sisyphus" },
      onResult: (result) => {
        outcomes.execution = result
      },
    })

    // Allow queued dispatch to run.
    await new Promise((resolve) => setTimeout(resolve, 0))

    // #then
    expect(promptAsync).toHaveBeenCalledTimes(1)
    expect(promptCalls).toEqual(["execution continuation"])
    expect(outcomes.execution?.status).toBe("accepted")
    expect(outcomes.todo?.status).toBe("rejected")
    expect(outcomes.todo?.rejectReason).toBe("lower_priority")
  })

  test("arbitrates to single writer by priority in one idle round", async () => {
    // #given
    const promptCalls: string[] = []
    const promptAsync = mock(async (args: any) => {
      promptCalls.push(args.body.parts[0].text)
      return {}
    })

    const outcomes: Record<string, ContinuationIntentOutcome> = {}

    const control = createContinuationControl(
      {
        directory: "/tmp/test",
        client: { session: { promptAsync } },
      } as any,
      {
        config: createConfig(),
        isContinuationStopped: () => false,
      }
    )

    control.beginEvent({
      event: {
        type: "session.idle",
        properties: { sessionID: "session-1" },
      },
    })

    const round = control.getCurrentRound("session-1")

    // #when
    await control.reportIntent({
      sessionID: "session-1",
      round,
      source: "todo-auto-continuation",
      reason: "todo",
      prompt: { text: "todo continuation" },
      onResult: (result) => {
        outcomes.todo = result
      },
    })

    await control.reportIntent({
      sessionID: "session-1",
      round,
      source: "execution-orchestrator",
      reason: "execution",
      prompt: { text: "execution continuation", agent: "sisyphus" },
      onResult: (result) => {
        outcomes.execution = result
      },
    })

    await control.flushEvent({
      event: {
        type: "session.idle",
        properties: { sessionID: "session-1" },
      },
    })

    // #then
    expect(promptAsync).toHaveBeenCalledTimes(1)
    expect(promptCalls).toEqual(["execution continuation"])
    expect(outcomes.execution?.status).toBe("accepted")
    expect(outcomes.todo?.status).toBe("rejected")
    expect(outcomes.todo?.rejectReason).toBe("lower_priority")
  })

  test("rejects all continuation intents when stop guard is active", async () => {
    // #given
    const promptAsync = mock(async () => ({}))
    const outcomes: ContinuationIntentOutcome[] = []

    const control = createContinuationControl(
      {
        directory: "/tmp/test",
        client: { session: { promptAsync } },
      } as any,
      {
        config: createConfig(),
        isContinuationStopped: () => true,
      }
    )

    control.beginEvent({
      event: {
        type: "session.idle",
        properties: { sessionID: "session-stop" },
      },
    })

    const round = control.getCurrentRound("session-stop")

    // #when
    await control.reportIntent({
      sessionID: "session-stop",
      round,
      source: "ralph-loop",
      reason: "loop",
      prompt: { text: "continue" },
      onResult: (result) => outcomes.push(result),
    })

    await control.flushEvent({
      event: {
        type: "session.idle",
        properties: { sessionID: "session-stop" },
      },
    })

    // #then
    expect(promptAsync).toHaveBeenCalledTimes(0)
    expect(outcomes).toHaveLength(1)
    expect(outcomes[0].status).toBe("rejected")
    expect(outcomes[0].rejectReason).toBe("stop_guard")
  })

  test("blocks continuation for post-compaction grace window", async () => {
    // #given
    const promptAsync = mock(async () => ({}))
    const outcomes: ContinuationIntentOutcome[] = []

    const control = createContinuationControl(
      {
        directory: "/tmp/test",
        client: { session: { promptAsync } },
      } as any,
      {
        config: createConfig({ post_compaction_grace_ms: 1500 }),
        isContinuationStopped: () => false,
      }
    )

    const originalNow = Date.now
    let now = 10_000
    Date.now = () => now

    try {
      control.beginEvent({
        event: {
          type: "session.compacted",
          properties: { sessionID: "session-grace" },
        },
      })

      control.beginEvent({
        event: {
          type: "session.idle",
          properties: { sessionID: "session-grace" },
        },
      })

      const round = control.getCurrentRound("session-grace")

      // #when
      await control.reportIntent({
        sessionID: "session-grace",
        round,
        source: "todo-auto-continuation",
        reason: "todo",
        prompt: { text: "todo continuation" },
        onResult: (result) => outcomes.push(result),
      })

      await control.flushEvent({
        event: {
          type: "session.idle",
          properties: { sessionID: "session-grace" },
        },
      })

      // #then
      expect(promptAsync).toHaveBeenCalledTimes(0)
      expect(outcomes).toHaveLength(1)
      expect(outcomes[0].status).toBe("rejected")
      expect(outcomes[0].rejectReason).toBe("post_compaction_grace")
    } finally {
      Date.now = originalNow
    }
  })

  test("does not fallback to second writer when winner prompt fails", async () => {
    // #given
    const promptAsync = mock(async () => {
      throw new Error("boom")
    })

    const outcomes: Record<string, ContinuationIntentOutcome> = {}

    const control = createContinuationControl(
      {
        directory: "/tmp/test",
        client: { session: { promptAsync } },
      } as any,
      {
        config: createConfig(),
        isContinuationStopped: () => false,
      }
    )

    control.beginEvent({
      event: {
        type: "session.idle",
        properties: { sessionID: "session-failure" },
      },
    })

    const round = control.getCurrentRound("session-failure")

    // #when
    await control.reportIntent({
      sessionID: "session-failure",
      round,
      source: "execution-orchestrator",
      reason: "execution",
      prompt: { text: "execution continuation" },
      onResult: (result) => {
        outcomes.execution = result
      },
    })

    await control.reportIntent({
      sessionID: "session-failure",
      round,
      source: "todo-auto-continuation",
      reason: "todo",
      prompt: { text: "todo continuation" },
      onResult: (result) => {
        outcomes.todo = result
      },
    })

    await control.flushEvent({
      event: {
        type: "session.idle",
        properties: { sessionID: "session-failure" },
      },
    })

    // #then
    expect(promptAsync).toHaveBeenCalledTimes(1)
    expect(outcomes.execution?.status).toBe("accepted")
    expect(String(outcomes.execution?.error)).toContain("boom")
    expect(outcomes.todo?.status).toBe("rejected")
    expect(outcomes.todo?.rejectReason).toBe("lower_priority")
  })
})
