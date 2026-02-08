import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import type { OhMyOpenCodeConfig } from "../config/schema"
import { createTaskNode, transitionTaskNode } from "../features/task-system"
import {
  _resetForTesting,
  markSubagentSession,
  setMainSession,
} from "../features/claude-code-session-state"
import { createDirectContinuationReporterForTesting } from "./continuation-control"
import { createTaskAutoContinuationHook } from "./task-auto-continuation"

type TimerCallback = (...args: any[]) => void

interface FakeTimers {
  advanceBy: (ms: number, advanceClock?: boolean) => Promise<void>
  restore: () => void
}

function createFakeTimers(): FakeTimers {
  const originalNow = Date.now()
  let clockNow = originalNow
  let timerNow = 0
  let nextId = 1
  const timers = new Map<number, { id: number; time: number; interval: number | null; callback: TimerCallback; args: any[] }>()
  const cleared = new Set<number>()

  const original = {
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
    setInterval: globalThis.setInterval,
    clearInterval: globalThis.clearInterval,
    dateNow: Date.now,
  }

  const normalizeDelay = (delay?: number) => {
    if (typeof delay !== "number" || !Number.isFinite(delay)) return 0
    return delay < 0 ? 0 : delay
  }

  const schedule = (callback: TimerCallback, delay: number | undefined, interval: number | null, args: any[]) => {
    const id = nextId++
    timers.set(id, {
      id,
      time: timerNow + normalizeDelay(delay),
      interval,
      callback,
      args,
    })
    return id
  }

  const clear = (id: number | undefined) => {
    if (typeof id !== "number") return
    cleared.add(id)
    timers.delete(id)
  }

  globalThis.setTimeout = ((callback: TimerCallback, delay?: number, ...args: any[]) => {
    return schedule(callback, delay, null, args) as unknown as ReturnType<typeof setTimeout>
  }) as typeof setTimeout

  globalThis.setInterval = ((callback: TimerCallback, delay?: number, ...args: any[]) => {
    const interval = normalizeDelay(delay)
    return schedule(callback, delay, interval, args) as unknown as ReturnType<typeof setInterval>
  }) as typeof setInterval

  globalThis.clearTimeout = ((id?: number) => {
    clear(id)
  }) as typeof clearTimeout

  globalThis.clearInterval = ((id?: number) => {
    clear(id)
  }) as typeof clearInterval

  Date.now = () => clockNow

  const advanceBy = async (ms: number, advanceClock = true) => {
    const clamped = Math.max(0, ms)
    const target = timerNow + clamped
    if (advanceClock) {
      clockNow += clamped
    }

    while (true) {
      let next: { id: number; time: number; interval: number | null; callback: TimerCallback; args: any[] } | undefined
      for (const timer of timers.values()) {
        if (timer.time <= target && (!next || timer.time < next.time)) {
          next = timer
        }
      }
      if (!next) break

      timerNow = next.time
      timers.delete(next.id)
      next.callback(...next.args)

      if (next.interval !== null && !cleared.has(next.id)) {
        timers.set(next.id, {
          id: next.id,
          time: timerNow + next.interval,
          interval: next.interval,
          callback: next.callback,
          args: next.args,
        })
      } else {
        cleared.delete(next.id)
      }

      await Promise.resolve()
    }

    timerNow = target
    await Promise.resolve()
  }

  const restore = () => {
    globalThis.setTimeout = original.setTimeout
    globalThis.clearTimeout = original.clearTimeout
    globalThis.setInterval = original.setInterval
    globalThis.clearInterval = original.clearInterval
    Date.now = original.dateNow
  }

  return { advanceBy, restore }
}

describe("task-auto-continuation", () => {
  let workspace: string
  let config: Partial<OhMyOpenCodeConfig>
  let timers: FakeTimers
  let promptCalls: Array<{ sessionID: string; text: string; agent?: string }>
  let toastCalls: string[]
  let mockMessages: Array<{ info?: Record<string, unknown> }>

  function createMockPluginInput() {
    return {
      client: {
        session: {
          messages: async () => ({ data: mockMessages }),
          prompt: async (opts: any) => {
            promptCalls.push({
              sessionID: opts.path.id,
              text: opts.body.parts[0].text,
              agent: opts.body.agent,
            })
            return {}
          },
        },
        tui: {
          showToast: async (opts: any) => {
            toastCalls.push(String(opts.body.message))
            return {}
          },
        },
      },
      directory: workspace,
    } as any
  }

  beforeEach(() => {
    timers = createFakeTimers()
    workspace = join(tmpdir(), `task-auto-cont-${Date.now()}-${Math.random().toString(16).slice(2)}`)
    mkdirSync(workspace, { recursive: true })
    config = {
      sisyphus: {
        tasks: {
          enabled: true,
          storage_path: workspace,
        },
      },
    }
    promptCalls = []
    toastCalls = []
    mockMessages = []
    _resetForTesting()
  })

  afterEach(() => {
    timers.restore()
    _resetForTesting()
    if (existsSync(workspace)) {
      rmSync(workspace, { recursive: true, force: true })
    }
  })

  test("injects continuation when session is idle and has incomplete tasks", async () => {
    // #given
    const sessionID = "main-1"
    setMainSession(sessionID)
    createTaskNode(
      {
        scope: "session",
        container_id: sessionID,
        title: "Implement feature",
      },
      config
    )

    const input = createMockPluginInput()
    const hook = createTaskAutoContinuationHook(input, {
      taskConfig: config,
      reportContinuationIntent: createDirectContinuationReporterForTesting(input),
    })

    // #when
    await hook.handler({
      event: { type: "session.idle", properties: { sessionID } },
    })
    await timers.advanceBy(2500)

    // #then
    expect(toastCalls.length).toBeGreaterThan(0)
    expect(promptCalls).toHaveLength(1)
    expect(promptCalls[0]?.text).toContain("TASK CONTINUATION")
  })

  test("does not inject when all tasks are completed", async () => {
    // #given
    const sessionID = "main-2"
    setMainSession(sessionID)
    const created = createTaskNode(
      {
        scope: "session",
        container_id: sessionID,
        title: "Done task",
      },
      config
    )
    transitionTaskNode(
      {
        scope: "session",
        container_id: sessionID,
        id: created.id,
        expected_revision: created.revision,
        next_state: "completed",
      },
      config
    )

    const input = createMockPluginInput()
    const hook = createTaskAutoContinuationHook(input, {
      taskConfig: config,
      reportContinuationIntent: createDirectContinuationReporterForTesting(input),
    })

    // #when
    await hook.handler({
      event: { type: "session.idle", properties: { sessionID } },
    })
    await timers.advanceBy(3000)

    // #then
    expect(promptCalls).toHaveLength(0)
  })

  test("skips injection when background tasks are running", async () => {
    // #given
    const sessionID = "main-3"
    setMainSession(sessionID)
    createTaskNode(
      {
        scope: "session",
        container_id: sessionID,
        title: "Still open",
      },
      config
    )

    const input = createMockPluginInput()
    const hook = createTaskAutoContinuationHook(input, {
      taskConfig: config,
      backgroundManager: {
        getTasksByParentSession: () => [{ status: "running" }],
      } as any,
      reportContinuationIntent: createDirectContinuationReporterForTesting(input),
    })

    // #when
    await hook.handler({
      event: { type: "session.idle", properties: { sessionID } },
    })
    await timers.advanceBy(3000)

    // #then
    expect(promptCalls).toHaveLength(0)
  })

  test("cancels countdown after user activity", async () => {
    // #given
    const sessionID = "main-4"
    setMainSession(sessionID)
    createTaskNode(
      {
        scope: "session",
        container_id: sessionID,
        title: "Needs work",
      },
      config
    )

    const input = createMockPluginInput()
    const hook = createTaskAutoContinuationHook(input, {
      taskConfig: config,
      reportContinuationIntent: createDirectContinuationReporterForTesting(input),
    })

    // #when
    await hook.handler({
      event: { type: "session.idle", properties: { sessionID } },
    })
    await timers.advanceBy(700)
    await hook.handler({
      event: {
        type: "message.updated",
        properties: {
          info: { sessionID, role: "user" },
        },
      },
    })
    await timers.advanceBy(3000)

    // #then
    expect(promptCalls).toHaveLength(0)
  })

  test("allows background subagent session continuation", async () => {
    // #given
    const mainSessionID = "main-5"
    const subagentSessionID = "sub-5"
    setMainSession(mainSessionID)
    markSubagentSession(subagentSessionID, mainSessionID)

    createTaskNode(
      {
        scope: "session",
        container_id: subagentSessionID,
        title: "Subagent task",
      },
      config
    )

    const input = createMockPluginInput()
    const hook = createTaskAutoContinuationHook(input, {
      taskConfig: config,
      reportContinuationIntent: createDirectContinuationReporterForTesting(input),
    })

    // #when
    await hook.handler({
      event: { type: "session.idle", properties: { sessionID: subagentSessionID } },
    })
    await timers.advanceBy(2500)

    // #then
    expect(promptCalls).toHaveLength(1)
    expect(promptCalls[0]?.sessionID).toBe(subagentSessionID)
  })

  test("reports continuation intent when custom reporter is used", async () => {
    // #given
    const sessionID = "main-6"
    setMainSession(sessionID)
    createTaskNode(
      {
        scope: "session",
        container_id: sessionID,
        title: "Needs continuation",
      },
      config
    )

    const input = createMockPluginInput()
    const intents: Array<{ source: string; text: string }> = []
    const hook = createTaskAutoContinuationHook(input, {
      taskConfig: config,
      reportContinuationIntent: async (intent) => {
        intents.push({ source: intent.source, text: intent.prompt.text })
      },
    })

    // #when
    await hook.handler({
      event: { type: "session.idle", properties: { sessionID } },
    })
    await timers.advanceBy(2500)

    // #then
    expect(promptCalls).toHaveLength(0)
    expect(intents).toHaveLength(1)
    expect(intents[0]?.source).toBe("task-auto-continuation")
    expect(intents[0]?.text).toContain("TASK CONTINUATION")
  })
})
