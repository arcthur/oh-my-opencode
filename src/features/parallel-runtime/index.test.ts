import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { SISYPHUS_PROJECT_ROOT_ENV } from "../sisyphus-tasks/storage"
import {
  acquireSlot,
  getRuntimeSnapshot,
  releaseSlot,
  resolveParallelRuntimeConfig,
} from "./index"

describe("parallel-runtime", () => {
  let projectRoot: string
  let prevRoot: string | undefined

  beforeEach(() => {
    prevRoot = process.env[SISYPHUS_PROJECT_ROOT_ENV]
    projectRoot = join(tmpdir(), `parallel-runtime-test-${Date.now()}-${Math.random().toString(16).slice(2)}`)
    mkdirSync(projectRoot, { recursive: true })
    process.env[SISYPHUS_PROJECT_ROOT_ENV] = projectRoot
  })

  afterEach(() => {
    if (prevRoot) {
      process.env[SISYPHUS_PROJECT_ROOT_ENV] = prevRoot
    } else {
      delete process.env[SISYPHUS_PROJECT_ROOT_ENV]
    }
    if (existsSync(projectRoot)) {
      rmSync(projectRoot, { recursive: true })
    }
  })

  test("enforce mode caps active leases at global_slots", async () => {
    // #given
    const config = resolveParallelRuntimeConfig({
      enabled: true,
      mode: "enforce",
      global_slots: 5,
      lease_ttl_ms: 30_000,
      acquire_timeout_ms: 200,
      lock_timeout_ms: 2_000,
    })

    // #when
    const leases = await Promise.all(
      Array.from({ length: 50 }, (_, index) =>
        acquireSlot(
          {
            subsystem: "background",
            runId: `run-${index + 1}`,
          },
          config
        )
      )
    )
    const activeLeases = leases.filter((lease): lease is NonNullable<typeof lease> => lease !== null)
    const snapshot = await getRuntimeSnapshot(config)

    // #then
    expect(activeLeases.length).toBe(5)
    expect(snapshot.activeLeases).toBeLessThanOrEqual(5)

    for (const lease of activeLeases) {
      await releaseSlot(lease.leaseId, config)
    }
  })

  test("expired leases are reclaimed after ttl", async () => {
    // #given
    const config = resolveParallelRuntimeConfig({
      enabled: true,
      mode: "enforce",
      global_slots: 1,
      lease_ttl_ms: 1_000,
      acquire_timeout_ms: 600,
      lock_timeout_ms: 2_000,
    })

    const lease1 = await acquireSlot(
      {
        subsystem: "background",
        runId: "run-old",
      },
      config
    )
    expect(lease1).not.toBeNull()

    // #when
    await new Promise((resolve) => setTimeout(resolve, 1_250))
    const lease2 = await acquireSlot(
      {
        subsystem: "background",
        runId: "run-new",
      },
      config
    )
    const snapshot = await getRuntimeSnapshot(config)

    // #then
    expect(lease2).not.toBeNull()
    expect(snapshot.activeLeases).toBe(1)
    expect(snapshot.leases[0]?.runId).toBe("run-new")

    if (lease2) {
      await releaseSlot(lease2.leaseId, config)
    }
  })

  test("shadow mode records would_block but allows over-capacity execution", async () => {
    // #given
    const config = resolveParallelRuntimeConfig({
      enabled: true,
      mode: "shadow",
      global_slots: 1,
      lease_ttl_ms: 30_000,
      acquire_timeout_ms: 200,
      lock_timeout_ms: 2_000,
    })

    // #when
    const lease1 = await acquireSlot(
      {
        subsystem: "background",
        runId: "shadow-run-1",
      },
      config
    )
    const lease2 = await acquireSlot(
      {
        subsystem: "swarm",
        runId: "shadow-run-2",
      },
      config
    )
    const snapshot = await getRuntimeSnapshot(config)

    // #then
    expect(lease1).not.toBeNull()
    expect(lease2).not.toBeNull()
    expect(snapshot.activeLeases).toBe(2)
    expect(snapshot.oversubscribed).toBe(1)
    expect(
      snapshot.recentEvents.some(
        (event) => event.type === "would_block" && event.runId === "shadow-run-2"
      )
    ).toBe(true)

    if (lease1) {
      await releaseSlot(lease1.leaseId, config)
    }
    if (lease2) {
      await releaseSlot(lease2.leaseId, config)
    }
  })

  test("enforce mode times out when no slot becomes available", async () => {
    // #given
    const config = resolveParallelRuntimeConfig({
      enabled: true,
      mode: "enforce",
      global_slots: 1,
      lease_ttl_ms: 30_000,
      acquire_timeout_ms: 120,
      lock_timeout_ms: 2_000,
    })

    const lease1 = await acquireSlot(
      {
        subsystem: "background",
        runId: "hold-run",
      },
      config
    )
    expect(lease1).not.toBeNull()

    // #when
    const lease2 = await acquireSlot(
      {
        subsystem: "swarm",
        runId: "blocked-run",
      },
      config
    )
    const snapshot = await getRuntimeSnapshot(config)

    // #then
    expect(lease2).toBeNull()
    expect(
      snapshot.recentEvents.some(
        (event) => event.type === "timed_out" && event.runId === "blocked-run"
      )
    ).toBe(true)

    if (lease1) {
      await releaseSlot(lease1.leaseId, config)
    }
  })
})
