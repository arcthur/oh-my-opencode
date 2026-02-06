import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import type { PluginInput } from "@opencode-ai/plugin"
import { existsSync, mkdirSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { SISYPHUS_PROJECT_ROOT_ENV } from "../sisyphus-tasks/storage"
import { acquireSlot, releaseSlot, resolveParallelRuntimeConfig } from "../parallel-runtime"
import { BackgroundManager } from "./manager"

function createMockClient(directory: string) {
  return {
    session: {
      status: async () => ({ data: {} }),
      messages: async () => ({ data: [] }),
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
    previousRoot = process.env[SISYPHUS_PROJECT_ROOT_ENV]
    projectRoot = join(tmpdir(), `background-parallel-runtime-${Date.now()}-${Math.random().toString(16).slice(2)}`)
    mkdirSync(projectRoot, { recursive: true })
    process.env[SISYPHUS_PROJECT_ROOT_ENV] = projectRoot
  })

  afterEach(() => {
    if (previousRoot) {
      process.env[SISYPHUS_PROJECT_ROOT_ENV] = previousRoot
    } else {
      delete process.env[SISYPHUS_PROJECT_ROOT_ENV]
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
      agent: "explore",
      parentSessionID: "parent-session",
      parentMessageID: "parent-message",
    })

    const timeoutAt = Date.now() + 2_000
    while (task.status === "pending" && Date.now() < timeoutAt) {
      await new Promise((resolve) => setTimeout(resolve, 25))
    }

    // #then
    expect(task.status).toBe("error")
    expect(task.error).toContain("Global parallel slots exhausted")

    if (heldLease) {
      await releaseSlot(heldLease.leaseId, runtimeConfig)
    }
    manager.shutdown()
  })
})
