import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import type { PluginInput } from "@opencode-ai/plugin"
import { existsSync, mkdirSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { ORCHESTRATOR_PROJECT_ROOT_ENV } from "../../../src/features/orchestrator-tasks/storage"
import {
  acquireSlot,
  getRuntimeSnapshot,
  releaseSlot,
  resolveParallelRuntimeConfig,
} from "../../../src/features/parallel-runtime"
import { BackgroundManager } from "../../../src/features/background-agent/manager"
import { waitFor } from "../helpers/wait-for"

function createMockClient(
  directory: string,
  options?: { messages?: Array<{ info?: { role?: string }; parts?: Array<Record<string, unknown>> }> }
) {
  return {
    session: {
      status: async () => ({ data: {} }),
      messages: async () => ({ data: options?.messages ?? [] }),
      todo: async () => ({ data: [] }),
      abort: async () => ({}),
      prompt: async () => ({}),
      get: async () => ({ data: { directory } }),
      create: async () => ({ data: { id: `bg-session-${Date.now()}` } }),
    },
  }
}

describe("background-agent manager parallel-runtime integration", () => {
  let projectRoot: string
  let previousRoot: string | undefined

  beforeEach(() => {
    previousRoot = process.env[ORCHESTRATOR_PROJECT_ROOT_ENV]
    projectRoot = join(tmpdir(), `background-parallel-runtime-${Date.now()}-${Math.random().toString(16).slice(2)}`)
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
      rmSync(projectRoot, { recursive: true })
    }
  })

  test("enforce mode marks task error when global slot admission times out", async () => {
    // #given
    const runtimeConfig = resolveParallelRuntimeConfig({
      enabled: true,
      mode: "enforce",
      global_slots: 1,
      lease_ttl_ms: 30_000,
      heartbeat_ms: 1_000,
      acquire_timeout_ms: 120,
      lock_timeout_ms: 2_000,
    })

    const heldLease = await acquireSlot(
      {
        subsystem: "background",
        runId: "held-background-slot",
      },
      runtimeConfig
    )
    expect(heldLease).not.toBeNull()

    const client = createMockClient(projectRoot)
    const manager = new BackgroundManager(
      {
        client,
        directory: projectRoot,
      } as unknown as PluginInput,
      { defaultConcurrency: 1 },
      {
        parallelRuntimeConfig: runtimeConfig,
      }
    )

    // #when
    const task = await manager.launch({
      description: "blocked background task",
      prompt: "run the task",
      agent: "navigator",
      parentSessionID: "parent-session",
      parentMessageID: "parent-message",
    })

    await waitFor(() => {
      expect(task.status).not.toBe("pending")
    }, {
      timeoutMs: 2_000,
      intervalMs: 25,
      description: "background task status transition",
    })

    // #then
    expect(task.status).toBe("error")
    expect(task.error).toContain("Global parallel slots exhausted")

    if (heldLease) {
      await releaseSlot(heldLease.leaseId, runtimeConfig)
    }
    manager.shutdown()
  })

  test("enforce mode acquires and releases global slot for a successful tracked task", async () => {
    // #given
    const runtimeConfig = resolveParallelRuntimeConfig({
      enabled: true,
      mode: "enforce",
      global_slots: 1,
      lease_ttl_ms: 30_000,
      heartbeat_ms: 500,
      acquire_timeout_ms: 120,
      lock_timeout_ms: 2_000,
    })

    const client = createMockClient(projectRoot, {
      messages: [
        {
          info: { role: "assistant" },
          parts: [{ type: "text", text: "Background task completed" }],
        },
      ],
    })
    const manager = new BackgroundManager(
      {
        client,
        directory: projectRoot,
      } as unknown as PluginInput,
      { defaultConcurrency: 1 },
      {
        parallelRuntimeConfig: runtimeConfig,
      }
    )

    // #when
    const task = await manager.trackTask({
      taskId: "bg-success-task",
      sessionID: "bg-session-success",
      parentSessionID: "parent-session",
      description: "successful tracked background task",
      agent: "navigator",
    })
    const runId = task.parallelRunId ?? `background:${task.id}`

    await waitFor(async () => {
      const snapshot = await getRuntimeSnapshot(runtimeConfig)
      expect(snapshot.leases.some((lease) => lease.runId === runId)).toBe(true)
    }, {
      timeoutMs: 2_000,
      intervalMs: 25,
      description: "background tracked task lease acquired",
    })

    // Make the task old enough so session.idle can complete it immediately.
    task.startedAt = new Date(Date.now() - 6_000)
    manager.handleEvent({
      type: "session.idle",
      properties: {
        sessionID: "bg-session-success",
      },
    })

    // #then
    await waitFor(() => {
      expect(task.status).toBe("completed")
    }, {
      timeoutMs: 3_000,
      intervalMs: 25,
      description: "background tracked task completed",
    })

    await waitFor(async () => {
      const snapshot = await getRuntimeSnapshot(runtimeConfig)
      expect(snapshot.leases.some((lease) => lease.runId === runId)).toBe(false)
    }, {
      timeoutMs: 3_000,
      intervalMs: 25,
      description: "background tracked task lease released",
    })

    manager.shutdown()
  })
})
