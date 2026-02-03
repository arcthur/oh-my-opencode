import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { mkdirSync, rmSync, existsSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import type { OhMyOpenCodeConfig } from "../../../config/schema"
import { createTeam, createAgentIdentity, addMember } from "./manifest"
import { createInbox, sendMessage } from "../mailbox"
import { requestJoin, getPendingJoinRequests, getPendingShutdownRequests } from "./membership"

describe("team/membership", () => {
  let testDir: string
  let config: Partial<OhMyOpenCodeConfig>
  const teamName = "test-team"

  beforeEach(() => {
    testDir = join(tmpdir(), `swarm-membership-test-${Date.now()}`)
    mkdirSync(testDir, { recursive: true })

    config = {
      sisyphus: {
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

    // Simulate coordinator rejecting after join_request is sent
    setTimeout(() => {
      sendMessage(teamName, coordinator.id, worker.id, { type: "join_rejected", reason: "no capacity" }, config)
    }, 50)

    // when
    const result = await requestJoin(teamName, worker, config, { timeoutMs: 2000 })

    // then
    expect(result.approved).toBe(false)
    expect(result.reason).toBe("no capacity")
  })

  // Issue 3: Test deduplication of pending requests
  describe("getPendingJoinRequests deduplication", () => {
    test("marks requests as read to prevent duplicate processing", () => {
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
      createInbox(teamName, worker.id, config)

      // Send a join request
      sendMessage(teamName, worker.id, coordinator.id, {
        type: "join_request",
        agentName: worker.name,
        sessionId: worker.sessionId,
      }, config)

      // First call should return the request
      const first = getPendingJoinRequests(teamName, coordinator.id, config)
      expect(first.length).toBe(1)
      expect(first[0].agentName).toBe("worker-1")

      // Second call should return empty (already marked as read)
      const second = getPendingJoinRequests(teamName, coordinator.id, config)
      expect(second.length).toBe(0)
    })

    // Issue B fix test: capabilities are forwarded in join_request
    test("extracts capabilities from join_request message", () => {
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
        capabilities: ["research", "design"],
      })
      createInbox(teamName, worker.id, config)

      // Send a join request with capabilities
      sendMessage(teamName, worker.id, coordinator.id, {
        type: "join_request",
        agentName: worker.name,
        sessionId: worker.sessionId,
        capabilities: worker.capabilities,
        tmuxPane: "swarm:1.2",
        worktreePath: "/tmp/worktree-1",
      }, config)

      const requests = getPendingJoinRequests(teamName, coordinator.id, config)
      expect(requests.length).toBe(1)
      expect(requests[0].capabilities).toEqual(["research", "design"])
      expect(requests[0].tmuxPane).toBe("swarm:1.2")
      expect(requests[0].worktreePath).toBe("/tmp/worktree-1")
    })

    test("returns undefined capabilities for old-format messages", () => {
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
      createInbox(teamName, worker.id, config)

      // Send old-format join request without capabilities
      sendMessage(teamName, worker.id, coordinator.id, {
        type: "join_request",
        agentName: worker.name,
        sessionId: worker.sessionId,
      }, config)

      const requests = getPendingJoinRequests(teamName, coordinator.id, config)
      expect(requests.length).toBe(1)
      expect(requests[0].capabilities).toBeUndefined()
    })
  })

  describe("getPendingShutdownRequests deduplication", () => {
    test("marks requests as read to prevent duplicate processing", () => {
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
      addMember(teamName, worker, config)
      createInbox(teamName, worker.id, config)

      // Send a shutdown request
      sendMessage(teamName, worker.id, coordinator.id, {
        type: "shutdown_request",
      }, config)

      // First call should return the request
      const first = getPendingShutdownRequests(teamName, coordinator.id, config)
      expect(first.length).toBe(1)
      expect(first[0].agentId).toBe(worker.id)

      // Second call should return empty (already marked as read)
      const second = getPendingShutdownRequests(teamName, coordinator.id, config)
      expect(second.length).toBe(0)
    })
  })
})

