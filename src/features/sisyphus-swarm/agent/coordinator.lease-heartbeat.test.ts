import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import type { OhMyOpenCodeConfig } from "../../../config/schema"
import { SISYPHUS_PROJECT_ROOT_ENV } from "../../sisyphus-tasks/storage"
import {
  getRuntimeSnapshot,
  resolveParallelRuntimeConfig,
} from "../../parallel-runtime"
import {
  createAgentIdentity,
  addMember,
  markWorkerIdle,
} from "../team"
import { createTask } from "../task-pool/pool"
import { createCoordinator } from "./coordinator"

describe("coordinator lease heartbeat", () => {
  let projectRoot: string
  let previousRoot: string | undefined
  let config: Partial<OhMyOpenCodeConfig>

  beforeEach(() => {
    previousRoot = process.env[SISYPHUS_PROJECT_ROOT_ENV]
    projectRoot = join(
      tmpdir(),
      `coordinator-heartbeat-${Date.now()}-${Math.random().toString(16).slice(2)}`
    )
    mkdirSync(projectRoot, { recursive: true })
    process.env[SISYPHUS_PROJECT_ROOT_ENV] = projectRoot

    config = {
      sisyphus: {
        tasks: {
          enabled: true,
          storage_path: join(projectRoot, "tasks"),
        },
        swarm: {
          enabled: true,
          storage_path: join(projectRoot, "teams"),
          ui_mode: "toast",
          swarm_first: false,
          worker_count: 0,
        },
      },
      parallel_runtime: {
        enabled: true,
        mode: "enforce",
        global_slots: 4,
        // Short TTL so we can observe renewal effects quickly
        lease_ttl_ms: 3_000,
        heartbeat_ms: 500,
        acquire_timeout_ms: 500,
        lock_timeout_ms: 2_000,
      },
    }

    mkdirSync(join(projectRoot, "tasks"), { recursive: true })
    mkdirSync(join(projectRoot, "teams"), { recursive: true })
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

  test("coordinator coordination loop renews leases for in-progress tasks", async () => {
    // #given — start coordinator (it creates the team itself)
    const teamName = "team-heartbeat"

    const coordinator = await createCoordinator(
      {
        teamName,
        name: "coordinator",
        sessionId: "sess-coordinator",
        autoApprove: true,
        // Fast loop so auto-assign + renewal happen quickly
        loopIntervalMs: 300,
        onError: (err) => console.error("coordinator error:", err),
      },
      config
    )
    expect(coordinator).not.toBeNull()

    // Add a worker externally and mark idle
    const workerIdentity = createAgentIdentity({
      name: "worker-1",
      sessionId: "sess-worker-1",
      role: "worker",
      capabilities: ["code"],
    })
    addMember(teamName, workerIdentity, config)
    markWorkerIdle(teamName, workerIdentity.id, config)

    // Create a task for auto-assignment
    createTask(
      teamName,
      { subject: "Long-running task", description: "Takes > TTL" },
      config
    )

    const runtimeConfig = resolveParallelRuntimeConfig(config.parallel_runtime)

    // Wait for coordination loop to auto-assign the task (acquires a lease)
    await new Promise((resolve) => setTimeout(resolve, 800))

    // Verify the lease was created by auto-assignment
    const snap0 = await getRuntimeSnapshot(runtimeConfig)
    expect(snap0.activeLeases).toBeGreaterThanOrEqual(1)
    const initialLease = snap0.leases.find((l) => l.subsystem === "swarm")
    expect(initialLease).toBeDefined()
    const initialExpiry = initialLease!.expiresAt

    // #when — wait for subsequent coordination loop iterations to renew the lease
    await new Promise((resolve) => setTimeout(resolve, 800))

    // #then — the lease expiry should have been extended by renewSwarmLeases()
    const snap1 = await getRuntimeSnapshot(runtimeConfig)
    const renewedLease = snap1.leases.find((l) => l.subsystem === "swarm")
    expect(renewedLease).toBeDefined()
    expect(renewedLease!.expiresAt).toBeGreaterThan(initialExpiry)

    // Cleanup
    await coordinator!.stop({ deleteTeam: true })
  })
})
