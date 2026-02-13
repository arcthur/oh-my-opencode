import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import type { OhMyOpenCodeConfig } from "../../../config/schema"
import { ORCHESTRATOR_PROJECT_ROOT_ENV } from "../../orchestrator-tasks/storage"
import {
  acquireSlot,
  getRuntimeSnapshot,
  releaseSlot,
  resolveParallelRuntimeConfig,
} from "../../parallel-runtime"
import {
  createAgentIdentity,
  createTeam,
  addMemberAsync,
  markWorkerIdle,
} from "../team"
import { createSwarmTask, readSwarmTaskNode } from "./pool"
import { autoAssignTasksWithRuntime } from "./assignment"

describe("task-graph/assignment parallel-runtime integration", () => {
  let projectRoot: string
  let tasksDir: string
  let teamsDir: string
  let previousRoot: string | undefined
  let config: Partial<OhMyOpenCodeConfig>

  beforeEach(() => {
    previousRoot = process.env[ORCHESTRATOR_PROJECT_ROOT_ENV]
    projectRoot = join(
      tmpdir(),
      `assignment-parallel-runtime-${Date.now()}-${Math.random().toString(16).slice(2)}`
    )
    tasksDir = join(projectRoot, "tasks")
    teamsDir = join(projectRoot, "teams")
    mkdirSync(tasksDir, { recursive: true })
    mkdirSync(teamsDir, { recursive: true })
    process.env[ORCHESTRATOR_PROJECT_ROOT_ENV] = projectRoot

    config = {
      orchestrator: {
        tasks: {
          enabled: true,
          storage_path: tasksDir,
        },
        swarm: {
          enabled: true,
          storage_path: teamsDir,
          ui_mode: "toast",
          swarm_first: false,
          worker_count: 0,
        },
      },
      parallel_runtime: {
        enabled: true,
        mode: "enforce",
        global_slots: 1,
        lease_ttl_ms: 30_000,
        heartbeat_ms: 1_000,
        acquire_timeout_ms: 120,
        lock_timeout_ms: 2_000,
      },
    }
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

  test("enforce mode blocks assignment while global slots are full", async () => {
    // #given
    const teamName = "team-enforce"
    const coordinator = createAgentIdentity({
      name: "coordinator",
      sessionId: "sess-coordinator",
      role: "coordinator",
    })
    const worker = createAgentIdentity({
      name: "worker-1",
      sessionId: "sess-worker-1",
      role: "worker",
      capabilities: ["code"],
    })

    createTeam(teamName, coordinator, config)
    await addMemberAsync(teamName, worker, config)
    markWorkerIdle(teamName, worker.id, config)

    const created = createSwarmTask(
      teamName,
      {
        title: "Task 1",
        description: "Implement Task 1",
      },
      config
    )

    const runtimeConfig = resolveParallelRuntimeConfig(config.parallel_runtime)
    const heldLease = await acquireSlot(
      {
        subsystem: "background",
        runId: "hold-capacity",
      },
      runtimeConfig
    )
    expect(heldLease).not.toBeNull()

    // #when
    const firstAttempt = await autoAssignTasksWithRuntime(teamName, coordinator.id, config)
    const afterFirstAttempt = readSwarmTaskNode(teamName, created.id, config)
    const snapAfterFirstAttempt = await getRuntimeSnapshot(runtimeConfig)

    // #then
    expect(firstAttempt).toHaveLength(0)
    expect(afterFirstAttempt?.state).toBe("open")
    expect(afterFirstAttempt?.owner).toBeUndefined()
    expect(
      snapAfterFirstAttempt.recentEvents.some(
        (event) =>
          event.type === "would_block" && event.runId === `swarm:${teamName}:${created.id}`
      )
    ).toBe(true)
    expect(
      snapAfterFirstAttempt.recentEvents.some(
        (event) =>
          event.type === "timed_out" && event.runId === `swarm:${teamName}:${created.id}`
      )
    ).toBe(false)

    if (heldLease) {
      await releaseSlot(heldLease.leaseId, runtimeConfig)
    }

    // #when
    const secondAttempt = await autoAssignTasksWithRuntime(teamName, coordinator.id, config)
    const afterSecondAttempt = readSwarmTaskNode(teamName, created.id, config)

    // #then
    expect(secondAttempt).toHaveLength(1)
    expect(secondAttempt[0]?.success).toBe(true)
    expect(afterSecondAttempt?.state).toBe("in_progress")
    expect(afterSecondAttempt?.owner).toBe(worker.id)
    expect(typeof afterSecondAttempt?.lease?.lease_id).toBe("string")
    expect(afterSecondAttempt?.lease?.run_id).toBe(`swarm:${teamName}:${created.id}`)
    expect(afterSecondAttempt?.lease?.subsystem).toBe("swarm")
  })
})
