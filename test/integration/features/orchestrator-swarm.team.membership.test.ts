import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { mkdirSync, rmSync, existsSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import type { OhMyOpenCodeConfig } from "../../../src/config/schema"
import {
  createTeam,
  createAgentIdentity,
  addMemberAsync,
  getMember,
} from "../../../src/features/orchestrator-swarm/team/manifest"
import { createInbox, sendMessage } from "../../../src/features/orchestrator-swarm/mailbox"
import { readByType } from "../../../src/features/orchestrator-swarm/mailbox/reader"
import {
  requestJoin,
  requestLeave,
  approveShutdown,
} from "../../../src/features/orchestrator-swarm/team/membership"
import { createCoordinator } from "../../../src/features/orchestrator-swarm/agent/coordinator"
import { waitFor } from "../helpers/wait-for"

describe("team/membership", () => {
  let testDir: string
  let config: Partial<OhMyOpenCodeConfig>
  const teamName = "test-team"

  beforeEach(() => {
    testDir = join(tmpdir(), `swarm-membership-test-${Date.now()}`)
    mkdirSync(testDir, { recursive: true })

    config = {
      orchestrator: {
        swarm: {
          enabled: true,
          storage_path: testDir,
          ui_mode: "toast",
        },
      },
    }
  })

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true })
    }
  })

  test("requestJoin approves via coordinator and persists membership before response", async () => {
    // given
    const teamName = `auto-approve-team-${Date.now()}`
    const coordinator = await createCoordinator(
      {
        teamName,
        name: "coordinator",
        sessionId: "sess_coord_auto",
        autoApprove: true,
        loopIntervalMs: 150,
      },
      config
    )
    expect(coordinator).not.toBeNull()

    const worker = createAgentIdentity({
      name: "worker-success",
      sessionId: "sess_worker_success",
      role: "worker",
    })

    try {
      // when
      const result = await requestJoin(teamName, worker, config, { timeoutMs: 2_000 })

      // then
      expect(result.approved).toBe(true)
      const persisted = getMember(teamName, worker.id, config)
      expect(persisted).not.toBeNull()
      expect(persisted?.id).toBe(worker.id)
    } finally {
      await coordinator?.stop({ deleteTeam: true })
    }
  })

  test("requestJoin returns rejection reason when coordinator rejects", async () => {
    // given
    const coordinator = createAgentIdentity({
      name: "coordinator",
      sessionId: "sess_coord",
      role: "coordinator",
    })
    createTeam(teamName, coordinator, config, {
      settings: { autoApprove: false },
    })
    createInbox(teamName, coordinator.id, config)

    const worker = createAgentIdentity({
      name: "worker-1",
      sessionId: "sess_worker",
      role: "worker",
    })

    const joinPromise = requestJoin(teamName, worker, config, { timeoutMs: 2000 })
    await waitFor(() => {
      expect(readByType(teamName, coordinator.id, "join_request", config).length).toBeGreaterThan(0)
    }, { timeoutMs: 2_000, intervalMs: 25, description: "coordinator receives join_request" })
    // Simulate coordinator rejecting after join_request is sent
    {
      sendMessage(teamName, coordinator.id, worker.id, { type: "join_rejected", reason: "no capacity" }, config)
    }

    // when
    const result = await joinPromise

    // then
    expect(result.approved).toBe(false)
    expect(result.reason).toBe("no capacity")
  })

  test("requestJoin rejects spoofed join_approved from non-coordinator", async () => {
    // given
    const coordinator = createAgentIdentity({
      name: "coordinator",
      sessionId: "sess_coord",
      role: "coordinator",
    })
    createTeam(teamName, coordinator, config, {
      settings: { autoApprove: false },
    })
    createInbox(teamName, coordinator.id, config)

    const worker = createAgentIdentity({
      name: "worker-1",
      sessionId: "sess_worker",
      role: "worker",
    })
    const attacker = createAgentIdentity({
      name: "attacker",
      sessionId: "sess_attacker",
      role: "worker",
    })
    createInbox(teamName, attacker.id, config)

    const joinPromise = requestJoin(teamName, worker, config, { timeoutMs: 1000 })
    await waitFor(() => {
      expect(readByType(teamName, coordinator.id, "join_request", config).length).toBeGreaterThan(0)
    }, { timeoutMs: 2_000, intervalMs: 25, description: "coordinator receives join_request" })
    {
      sendMessage(
        teamName,
        attacker.id,
        worker.id,
        { type: "join_approved", agentName: worker.name, teamName },
        config
      )
    }

    // when
    const result = await joinPromise

    // then
    expect(result.approved).toBe(false)
    expect(result.reason).toBe("Invalid join response sender")
  })

  test("requestJoin requires membership update before accepting join_approved", async () => {
    // given
    const coordinator = createAgentIdentity({
      name: "coordinator",
      sessionId: "sess_coord",
      role: "coordinator",
    })
    createTeam(teamName, coordinator, config, {
      settings: { autoApprove: false },
    })
    createInbox(teamName, coordinator.id, config)

    const worker = createAgentIdentity({
      name: "worker-1",
      sessionId: "sess_worker",
      role: "worker",
    })

    const joinPromise = requestJoin(teamName, worker, config, { timeoutMs: 1000 })
    await waitFor(() => {
      expect(readByType(teamName, coordinator.id, "join_request", config).length).toBeGreaterThan(0)
    }, { timeoutMs: 2_000, intervalMs: 25, description: "coordinator receives join_request" })
    {
      // Coordinator sends approval but forgets to add member first.
      sendMessage(
        teamName,
        coordinator.id,
        worker.id,
        { type: "join_approved", agentName: worker.name, teamName },
        config
      )
    }

    // when
    const result = await joinPromise

    // then
    expect(result.approved).toBe(false)
    expect(result.reason).toBe("Join approval without membership update")
  })

  describe("requestLeave signature validation", () => {
    test("rejects unsigned shutdown_approved by default", async () => {
      const coordinator = createAgentIdentity({
        name: "coordinator",
        sessionId: "sess_coord",
        role: "coordinator",
      })
      createTeam(teamName, coordinator, config)
      createInbox(teamName, coordinator.id, config)

      const worker = createAgentIdentity({
        name: "worker-1",
        sessionId: "sess_worker",
        role: "worker",
      })
      await addMemberAsync(teamName, worker, config)
      createInbox(teamName, worker.id, config)

      const leavePromise = requestLeave(teamName, worker.id, config, { timeoutMs: 1000 })
      await waitFor(() => {
        expect(readByType(teamName, coordinator.id, "shutdown_request", config).length).toBeGreaterThan(0)
      }, { timeoutMs: 2_000, intervalMs: 25, description: "coordinator receives shutdown_request" })
      {
        sendMessage(teamName, coordinator.id, worker.id, { type: "shutdown_approved" }, config)
      }

      const result = await leavePromise
      expect(result.approved).toBe(false)
      expect(result.reason).toContain("Invalid shutdown response signature")
    })

    test("accepts signed shutdown_approved sent via approveShutdown", async () => {
      const coordinator = createAgentIdentity({
        name: "coordinator",
        sessionId: "sess_coord",
        role: "coordinator",
      })
      createTeam(teamName, coordinator, config)
      createInbox(teamName, coordinator.id, config)

      const worker = createAgentIdentity({
        name: "worker-1",
        sessionId: "sess_worker",
        role: "worker",
      })
      await addMemberAsync(teamName, worker, config)
      createInbox(teamName, worker.id, config)

      const leavePromise = requestLeave(teamName, worker.id, config, { timeoutMs: 1000 })
      await waitFor(() => {
        expect(readByType(teamName, coordinator.id, "shutdown_request", config).length).toBeGreaterThan(0)
      }, { timeoutMs: 2_000, intervalMs: 25, description: "coordinator receives shutdown_request" })
      {
        approveShutdown(teamName, coordinator.id, worker.id, config)
      }

      const result = await leavePromise
      expect(result.approved).toBe(true)
    })
  })
})
