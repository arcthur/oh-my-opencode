import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import type { OhMyOpenCodeConfig } from "../../../src/config/schema"
import { ORCHESTRATOR_PROJECT_ROOT_ENV } from "../../../src/features/orchestrator-tasks/storage"
import {
  getRuntimeSnapshot,
  resolveParallelRuntimeConfig,
} from "../../../src/features/parallel-runtime"
import {
  createAgentIdentity,
  addMemberAsync,
  markWorkerIdle,
} from "../../../src/features/orchestrator-swarm/team"
import { createSwarmTask } from "../../../src/features/orchestrator-swarm/task-graph"
import { createCoordinator } from "../../../src/features/orchestrator-swarm/agent/coordinator"
import { waitFor } from "../helpers/wait-for"

describe("coordinator lease heartbeat", () => {
  let projectRoot: string
  let previousRoot: string | undefined
  let config: Partial<OhMyOpenCodeConfig>

  beforeEach(() => {
    previousRoot = process.env[ORCHESTRATOR_PROJECT_ROOT_ENV]
    projectRoot = join(
      tmpdir(),
      `coordinator-heartbeat-${Date.now()}-${Math.random().toString(16).slice(2)}`
    )
    mkdirSync(projectRoot, { recursive: true })
    process.env[ORCHESTRATOR_PROJECT_ROOT_ENV] = projectRoot

    config = {
      orchestrator: {
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
          coordinator_lease_renew_ms: 300,
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
      process.env[ORCHESTRATOR_PROJECT_ROOT_ENV] = previousRoot
    } else {
      delete process.env[ORCHESTRATOR_PROJECT_ROOT_ENV]
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
    await addMemberAsync(teamName, workerIdentity, config)
    markWorkerIdle(teamName, workerIdentity.id, config)

    // Create a task for auto-assignment
    createSwarmTask(teamName, { title: "Long-running task", description: "Takes > TTL" }, config)

    const runtimeConfig = resolveParallelRuntimeConfig(config.parallel_runtime)

    let initialExpiry = 0
    await waitFor(async () => {
      const snapshot = await getRuntimeSnapshot(runtimeConfig)
      expect(snapshot.activeLeases).toBeGreaterThanOrEqual(1)
      const initialLease = snapshot.leases.find((lease) => lease.subsystem === "swarm")
      expect(initialLease).toBeDefined()
      initialExpiry = initialLease!.expiresAt
    }, {
      timeoutMs: 4_000,
      intervalMs: 100,
      description: "initial swarm lease acquisition",
    })

    // #when / #then — lease expiry should be extended by renewSwarmLeases()
    await waitFor(async () => {
      const snapshot = await getRuntimeSnapshot(runtimeConfig)
      const renewedLease = snapshot.leases.find((lease) => lease.subsystem === "swarm")
      expect(renewedLease).toBeDefined()
      expect(renewedLease!.expiresAt).toBeGreaterThan(initialExpiry)
    }, {
      timeoutMs: 4_000,
      intervalMs: 100,
      description: "swarm lease renewal",
    })

    // Cleanup
    await coordinator!.stop({ deleteTeam: true })
  })

  test("lease expires after coordinator stops renewing", async () => {
    // #given
    const teamName = "team-heartbeat-stop"
    const coordinator = await createCoordinator(
      {
        teamName,
        name: "coordinator",
        sessionId: "sess-coordinator-stop",
        autoApprove: true,
        loopIntervalMs: 300,
      },
      config
    )
    expect(coordinator).not.toBeNull()

    const workerIdentity = createAgentIdentity({
      name: "worker-stop-1",
      sessionId: "sess-worker-stop-1",
      role: "worker",
      capabilities: ["code"],
    })
    await addMemberAsync(teamName, workerIdentity, config)
    markWorkerIdle(teamName, workerIdentity.id, config)
    createSwarmTask(teamName, { title: "Lease expiry task", description: "observe ttl" }, config)

    const runtimeConfig = resolveParallelRuntimeConfig(config.parallel_runtime)
    let runId = ""

    await waitFor(async () => {
      const snapshot = await getRuntimeSnapshot(runtimeConfig)
      const activeLease = snapshot.leases.find((lease) => lease.subsystem === "swarm")
      expect(activeLease).toBeDefined()
      runId = activeLease!.runId
    }, {
      timeoutMs: 4_000,
      intervalMs: 100,
      description: "swarm lease acquired before stop",
    })

    // #when
    await coordinator!.stop()

    // #then
    await waitFor(async () => {
      const snapshot = await getRuntimeSnapshot(runtimeConfig)
      expect(snapshot.leases.some((lease) => lease.runId === runId)).toBe(false)
    }, {
      timeoutMs: 8_000,
      intervalMs: 100,
      description: "lease expires after coordinator stop",
    })
  })
})
