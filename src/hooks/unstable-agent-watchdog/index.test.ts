import { afterEach, describe, expect, mock, test } from "bun:test"
import type { BackgroundTask } from "../../features/background-agent"
import { _resetForTesting, setMainSession } from "../../features/claude-code-session-state"
import { createUnstableAgentWatchdogHook } from "./index"

const projectDir = process.cwd()

type HookContext = Parameters<typeof createUnstableAgentWatchdogHook>[0]
type HookOptions = Parameters<typeof createUnstableAgentWatchdogHook>[1]

function createTask(overrides: Partial<BackgroundTask> = {}): BackgroundTask {
  return {
    id: "task-1",
    sessionID: "bg-1",
    parentSessionID: "main-1",
    parentMessageID: "msg-1",
    description: "unstable task",
    prompt: "run work",
    agent: "navigator",
    status: "running",
    progress: {
      toolCalls: 0,
      lastUpdate: new Date(),
      lastMessage: "still working",
      lastMessageAt: new Date(Date.now() - 130_000),
    },
    model: { providerID: "google", modelID: "gemini-2.5-pro" },
    ...overrides,
  }
}

function createContext(messagesBySession: Record<string, unknown[]>): HookContext {
  return {
    directory: projectDir,
    client: {
      session: {
        messages: async ({ path }: { path: { id: string } }) => ({
          data: messagesBySession[path.id] ?? [],
        }),
      },
    },
  } as HookContext
}

function createOptions(args: {
  tasks: BackgroundTask[]
  descendantTasks?: BackgroundTask[]
  reportContinuationIntent: HookOptions["reportContinuationIntent"]
  getContinuationRound?: HookOptions["getContinuationRound"]
  isContinuationStopped?: HookOptions["isContinuationStopped"]
  timeoutMs?: number
  cooldownMs?: number
}): HookOptions {
  return {
    backgroundManager: {
      getTasksByParentSession: () => args.tasks,
      getAllDescendantTasks: args.descendantTasks
        ? () => args.descendantTasks as BackgroundTask[]
        : undefined,
    },
    reportContinuationIntent: args.reportContinuationIntent,
    getContinuationRound: args.getContinuationRound,
    isContinuationStopped: args.isContinuationStopped,
    timeoutMs: args.timeoutMs,
    cooldownMs: args.cooldownMs,
  }
}

describe("unstable-agent-watchdog", () => {
  afterEach(() => {
    _resetForTesting()
  })

  test("reports continuation reminder for unstable background task that appears stuck", async () => {
    // #given
    setMainSession("main-1")
    const reportContinuationIntent = mock(async () => {})
    const hook = createUnstableAgentWatchdogHook(
      createContext({
        "main-1": [
          { info: { agent: "orchestrator", model: { providerID: "openai", modelID: "gpt-5" } } },
        ],
        "bg-1": [
          { info: { role: "assistant" }, parts: [{ type: "thinking", thinking: "deep trace" }] },
        ],
      }),
      createOptions({
        tasks: [createTask()],
        reportContinuationIntent,
        getContinuationRound: () => 42,
        timeoutMs: 120_000,
      }),
    )

    // #when
    await hook.event({
      event: { type: "session.idle", properties: { sessionID: "main-1" } },
    })

    // #then
    expect(reportContinuationIntent).toHaveBeenCalledTimes(1)
    const intent = reportContinuationIntent.mock.calls[0]?.[0] as {
      source: string
      round?: number
      prompt?: { text?: string }
    }
    expect(intent.source).toBe("unstable-agent-watchdog")
    expect(intent.round).toBe(42)
    expect(intent.prompt?.text).toContain("background_output")
    expect(intent.prompt?.text).toContain("background_cancel")
    expect(intent.prompt?.text).toContain("deep trace")
  })

  test("skips stable-model tasks", async () => {
    // #given
    setMainSession("main-1")
    const reportContinuationIntent = mock(async () => {})
    const hook = createUnstableAgentWatchdogHook(
      createContext({ "main-1": [] }),
      createOptions({
        tasks: [
          createTask({
            model: { providerID: "openai", modelID: "gpt-5" },
            isUnstableAgent: false,
          }),
        ],
        reportContinuationIntent,
      }),
    )

    // #when
    await hook.event({
      event: { type: "session.idle", properties: { sessionID: "main-1" } },
    })

    // #then
    expect(reportContinuationIntent).toHaveBeenCalledTimes(0)
  })

  test("respects cooldown per task", async () => {
    // #given
    setMainSession("main-1")
    const reportContinuationIntent = mock(async (intent: { onResult?: (result: { status: "accepted" }) => void }) => {
      intent.onResult?.({ status: "accepted" })
    })
    const hook = createUnstableAgentWatchdogHook(
      createContext({ "main-1": [], "bg-1": [] }),
      createOptions({
        tasks: [createTask()],
        reportContinuationIntent,
        timeoutMs: 120_000,
        cooldownMs: 300_000,
      }),
    )

    const now = Date.now()
    const originalNow = Date.now
    Date.now = () => now

    try {
      // #when
      await hook.event({
        event: { type: "session.idle", properties: { sessionID: "main-1" } },
      })
      await hook.event({
        event: { type: "session.idle", properties: { sessionID: "main-1" } },
      })
    } finally {
      Date.now = originalNow
    }

    // #then
    expect(reportContinuationIntent).toHaveBeenCalledTimes(1)
  })

  test("skips when continuation is stopped for the session", async () => {
    // #given
    setMainSession("main-1")
    const reportContinuationIntent = mock(async () => {})
    const hook = createUnstableAgentWatchdogHook(
      createContext({ "main-1": [], "bg-1": [] }),
      createOptions({
        tasks: [createTask()],
        reportContinuationIntent,
        isContinuationStopped: () => true,
      }),
    )

    // #when
    await hook.event({
      event: { type: "session.idle", properties: { sessionID: "main-1" } },
    })

    // #then
    expect(reportContinuationIntent).toHaveBeenCalledTimes(0)
  })

  test("includes descendant background tasks when available", async () => {
    // #given
    setMainSession("main-1")
    const reportContinuationIntent = mock(async () => {})
    const hook = createUnstableAgentWatchdogHook(
      createContext({ "main-1": [], "bg-1": [] }),
      createOptions({
        tasks: [],
        descendantTasks: [createTask()],
        reportContinuationIntent,
      }),
    )

    // #when
    await hook.event({
      event: { type: "session.idle", properties: { sessionID: "main-1" } },
    })

    // #then
    expect(reportContinuationIntent).toHaveBeenCalledTimes(1)
  })
})
