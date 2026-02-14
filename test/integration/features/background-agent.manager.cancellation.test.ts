import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import type { PluginInput } from "@opencode-ai/plugin"
import { existsSync, mkdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { BackgroundTask } from "../../../src/features/background-agent/types"
import { ORCHESTRATOR_PROJECT_ROOT_ENV } from "../../../src/features/orchestrator-tasks/storage"
import {
  acquireSlot,
  getRuntimeSnapshot,
  releaseSlot,
  resolveParallelRuntimeConfig,
} from "../../../src/features/parallel-runtime"
import { BackgroundManager } from "../../../src/features/background-agent/manager"
import { waitFor } from "../helpers/wait-for"

interface MockClientOptions {
  abortSpy?: ReturnType<typeof mock>
  messages?: Array<{ info?: { role?: string }; parts?: Array<Record<string, unknown>> }>
}

function createMockClient(directory: string, options: MockClientOptions = {}) {
  const abort = options.abortSpy ?? mock(async () => ({}))
  let sessionCounter = 0

  return {
    session: {
      status: async () => ({ data: {} }),
      messages: async () => ({ data: options.messages ?? [] }),
      todo: async () => ({ data: [] }),
      abort,
      prompt: async () => ({}),
      get: async () => ({ data: { directory } }),
      create: async () => ({ data: { id: `bg-session-${sessionCounter++}` } }),
    },
  }
}

function getRunId(task: BackgroundTask): string {
  return task.parallelRunId ?? `background:${task.id}`
}

describe("background-agent manager cancellation flows", () => {
  let projectRoot: string
  let previousRoot: string | undefined

  beforeEach(() => {
    previousRoot = process.env[ORCHESTRATOR_PROJECT_ROOT_ENV]
    projectRoot = join(
      tmpdir(),
      `background-cancellation-${Date.now()}-${Math.random().toString(16).slice(2)}`
    )
    mkdirSync(projectRoot, { recursive: true })
    process.env[ORCHESTRATOR_PROJECT_ROOT_ENV] = projectRoot
  })

  afterEach(() => {
    if (previousRoot) {
      process.env[ORCHESTRATOR_PROJECT_ROOT_ENV] = previousRoot
    } else {
      delete process.env[ORCHESTRATOR_PROJECT_ROOT_ENV]
    }
    if (existsSync(projectRoot)) {
      rmSync(projectRoot, { recursive: true, force: true })
    }
  })

  test("cancelTask cancels a pending task without aborting a session", async () => {
    // #given
    const abortSpy = mock(async () => ({}))
    const manager = new BackgroundManager(
      {
        client: createMockClient(projectRoot, { abortSpy }),
        directory: projectRoot,
      } as unknown as PluginInput,
      { defaultConcurrency: 1 }
    )

    const first = await manager.launch({
      description: "first task",
      prompt: "first prompt",
      agent: "navigator",
      parentSessionID: "parent-session",
      parentMessageID: "msg-1",
    })
    const second = await manager.launch({
      description: "second task",
      prompt: "second prompt",
      agent: "navigator",
      parentSessionID: "parent-session",
      parentMessageID: "msg-2",
    })

    await waitFor(() => {
      expect(first.status).toBe("running")
      expect(second.status).toBe("pending")
    }, {
      timeoutMs: 2_000,
      intervalMs: 25,
      description: "pending task queued behind first running task",
    })

    // #when
    const cancelled = await manager.cancelTask(second.id, "Cancelled from integration test")

    // #then
    expect(cancelled).toBe(true)
    expect(second.status).toBe("cancelled")
    expect(second.error).toBe("Cancelled from integration test")
    expect(second.completedAt).toBeInstanceOf(Date)
    expect(second.sessionID).toBeUndefined()
    expect(manager.getPendingNotifications("parent-session").some((task) => task.id === second.id)).toBe(true)
    expect(abortSpy.mock.calls.length).toBe(0)

    manager.shutdown()
  })

  test("cancelTask aborts a running task session and marks notification", async () => {
    // #given
    const abortSpy = mock(async () => ({}))
    const manager = new BackgroundManager(
      {
        client: createMockClient(projectRoot, { abortSpy }),
        directory: projectRoot,
      } as unknown as PluginInput,
      { defaultConcurrency: 1 }
    )

    const task = await manager.launch({
      description: "running task",
      prompt: "run",
      agent: "navigator",
      parentSessionID: "parent-session",
      parentMessageID: "msg-running",
    })

    await waitFor(() => {
      expect(task.status).toBe("running")
      expect(typeof task.sessionID).toBe("string")
    }, {
      timeoutMs: 2_000,
      intervalMs: 25,
      description: "task transitions to running",
    })

    // #when
    const cancelled = await manager.cancelTask(task.id, "Cancelled while running")

    // #then
    expect(cancelled).toBe(true)
    expect(task.status).toBe("cancelled")
    expect(task.error).toBe("Cancelled while running")
    expect(task.completedAt).toBeInstanceOf(Date)
    expect(task.concurrencyKey).toBeUndefined()
    expect(manager.getPendingNotifications("parent-session").some((pending) => pending.id === task.id)).toBe(true)
    expect(abortSpy.mock.calls.length).toBe(1)
    expect(abortSpy.mock.calls[0]?.[0]).toEqual({
      path: { id: task.sessionID },
    })

    manager.shutdown()
  })

  test("session.deleted cancels descendants and releases global leases", async () => {
    // #given
    const runtimeConfig = resolveParallelRuntimeConfig({
      enabled: true,
      mode: "enforce",
      global_slots: 6,
      lease_ttl_ms: 30_000,
      heartbeat_ms: 500,
      acquire_timeout_ms: 400,
      lock_timeout_ms: 2_000,
    })
    const manager = new BackgroundManager(
      {
        client: createMockClient(projectRoot),
        directory: projectRoot,
      } as unknown as PluginInput,
      { defaultConcurrency: 4 },
      { parallelRuntimeConfig: runtimeConfig }
    )

    const root = await manager.trackTask({
      taskId: "task-root",
      sessionID: "session-root",
      parentSessionID: "session-parent",
      description: "root",
      agent: "navigator",
    })
    const child = await manager.trackTask({
      taskId: "task-child",
      sessionID: "session-child",
      parentSessionID: "session-root",
      description: "child",
      agent: "navigator",
    })
    const grandchild = await manager.trackTask({
      taskId: "task-grandchild",
      sessionID: "session-grandchild",
      parentSessionID: "session-child",
      description: "grandchild",
      agent: "navigator",
    })

    const trackedRunIds = [getRunId(root), getRunId(child), getRunId(grandchild)]
    await waitFor(async () => {
      const snapshot = await getRuntimeSnapshot(runtimeConfig)
      for (const runId of trackedRunIds) {
        expect(snapshot.leases.some((lease) => lease.runId === runId)).toBe(true)
      }
    }, {
      timeoutMs: 3_000,
      intervalMs: 25,
      description: "leases acquired for tracked tasks",
    })

    // #when
    manager.handleEvent({
      type: "session.deleted",
      properties: {
        info: { id: "session-root" },
      },
    })

    // #then
    expect(manager.getTask(root.id)).toBeUndefined()
    expect(manager.getTask(child.id)).toBeUndefined()
    expect(manager.getTask(grandchild.id)).toBeUndefined()

    await waitFor(async () => {
      const snapshot = await getRuntimeSnapshot(runtimeConfig)
      for (const runId of trackedRunIds) {
        expect(snapshot.leases.some((lease) => lease.runId === runId)).toBe(false)
      }
    }, {
      timeoutMs: 3_000,
      intervalMs: 25,
      description: "leases released for deleted session graph",
    })

    manager.shutdown()
  })

  test("resume fails with admission timeout when global slots are exhausted", async () => {
    // #given
    const runtimeConfig = resolveParallelRuntimeConfig({
      enabled: true,
      mode: "enforce",
      global_slots: 2,
      lease_ttl_ms: 30_000,
      heartbeat_ms: 500,
      acquire_timeout_ms: 120,
      lock_timeout_ms: 2_000,
    })

    const heldLeaseA = await acquireSlot(
      {
        subsystem: "background",
        runId: "held-slot-a",
      },
      runtimeConfig
    )
    expect(heldLeaseA).not.toBeNull()

    const manager = new BackgroundManager(
      {
        client: createMockClient(projectRoot),
        directory: projectRoot,
      } as unknown as PluginInput,
      { defaultConcurrency: 1 },
      { parallelRuntimeConfig: runtimeConfig }
    )

    const trackedTask = await manager.trackTask({
      taskId: "resume-target-task",
      sessionID: "resume-target-session",
      parentSessionID: "resume-parent-session",
      description: "resume target",
      agent: "navigator",
    })
    expect(trackedTask.parallelLeaseId).toBeDefined()

    if (trackedTask.parallelLeaseId) {
      await releaseSlot(trackedTask.parallelLeaseId, runtimeConfig)
      trackedTask.parallelLeaseId = undefined
    }
    trackedTask.status = "completed"
    trackedTask.completedAt = new Date()

    const heldLeaseB = await acquireSlot(
      {
        subsystem: "background",
        runId: "held-slot-b",
      },
      runtimeConfig
    )
    expect(heldLeaseB).not.toBeNull()

    // #when / #then
    await expect(manager.resume({
      sessionId: "resume-target-session",
      parentSessionID: "resume-parent-session",
      parentMessageID: "resume-parent-message",
      prompt: "resume task",
      model: "test-model",
    })).rejects.toThrow("Global parallel slots exhausted (resume admission timeout)")

    if (heldLeaseB) {
      await releaseSlot(heldLeaseB.leaseId, runtimeConfig)
    }
    if (heldLeaseA) {
      await releaseSlot(heldLeaseA.leaseId, runtimeConfig)
    }
    manager.shutdown()
  })
})
