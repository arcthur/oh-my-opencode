import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { mkdirSync, rmSync, existsSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import type { OhMyOpenCodeConfig } from "../../../config/schema"
import {
  generateAgentId,
  teamExists,
  readManifest,
  createAgentIdentity,
  createTeam,
  addMember,
  removeMember,
  updateMember,
  heartbeat,
  transferCoordinator,
  getMember,
  getCoordinator,
  getWorkers,
  isCoordinator,
  listTeams,
  deleteTeam,
  takeoverAsCoordinator,
  markWorkerIdle,
  markWorkerBusy,
  getIdleWorkersFromManifest,
} from "./manifest"

describe("team/manifest", () => {
  let testDir: string
  let config: Partial<OhMyOpenCodeConfig>

  beforeEach(() => {
    testDir = join(tmpdir(), `swarm-manifest-test-${Date.now()}`)
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

  test("generateAgentId creates unique IDs", () => {
    const id1 = generateAgentId()
    const id2 = generateAgentId()

    expect(id1).toMatch(/^agent_[a-z0-9-]{8}$/)
    expect(id2).toMatch(/^agent_[a-z0-9-]{8}$/)
    expect(id1).not.toBe(id2)
  })

  test("createAgentIdentity creates valid identity", () => {
    const identity = createAgentIdentity({
      name: "test-agent",
      sessionId: "sess_123",
      role: "worker",
      capabilities: ["code", "research"],
    })

    expect(identity.id).toMatch(/^agent_/)
    expect(identity.name).toBe("test-agent")
    expect(identity.sessionId).toBe("sess_123")
    expect(identity.role).toBe("worker")
    expect(identity.capabilities).toContain("code")
    expect(identity.capabilities).toContain("research")
    expect(identity.joinedAt).toBeGreaterThan(0)
  })

  test("createTeam creates team with coordinator", () => {
    const coord = createAgentIdentity({
      name: "coordinator",
      sessionId: "sess_coord",
      role: "coordinator",
    })

    const manifest = createTeam("test-team", coord, config, {
      description: "Test team",
    })

    expect(manifest.name).toBe("test-team")
    expect(manifest.description).toBe("Test team")
    expect(manifest.coordinatorId).toBe(coord.id)
    expect(manifest.members.length).toBe(1)
    expect(manifest.members[0].id).toBe(coord.id)
    expect(teamExists("test-team", config)).toBe(true)
  })

  test("createTeam fails if team exists", () => {
    const coord = createAgentIdentity({
      name: "coordinator",
      sessionId: "sess_coord",
      role: "coordinator",
    })

    createTeam("test-team", coord, config)

    expect(() => {
      createTeam("test-team", coord, config)
    }).toThrow("already exists")
  })

  test("addMember adds worker to team", () => {
    const coord = createAgentIdentity({
      name: "coordinator",
      sessionId: "sess_coord",
      role: "coordinator",
    })

    createTeam("test-team", coord, config)

    const worker = createAgentIdentity({
      name: "worker-1",
      sessionId: "sess_worker",
      role: "worker",
    })

    const manifest = addMember("test-team", worker, config)

    expect(manifest.members.length).toBe(2)
    expect(manifest.members[1].id).toBe(worker.id)
  })

  test("addMember is idempotent for duplicate member", () => {
    const coord = createAgentIdentity({
      name: "coordinator",
      sessionId: "sess_coord",
      role: "coordinator",
    })

    createTeam("test-team", coord, config)

    const worker = createAgentIdentity({
      name: "worker-1",
      sessionId: "sess_worker",
      role: "worker",
      capabilities: ["code"],
    })

    addMember("test-team", worker, config)

    // Second call should be idempotent (no error)
    const manifest = addMember("test-team", worker, config)
    expect(manifest.members.length).toBe(2) // Still 2 members
    expect(manifest.members.filter(m => m.id === worker.id).length).toBe(1)
  })

  test("addMember updates existing member fields on duplicate", () => {
    const coord = createAgentIdentity({
      name: "coordinator",
      sessionId: "sess_coord",
      role: "coordinator",
    })

    createTeam("test-team", coord, config)

    const worker = createAgentIdentity({
      name: "worker-1",
      sessionId: "sess_worker",
      role: "worker",
      capabilities: ["code"],
    })

    addMember("test-team", worker, config)

    // Update with new capabilities
    const updatedWorker = { ...worker, capabilities: ["code", "research"] as ("code" | "research" | "design" | "review")[] }
    const manifest = addMember("test-team", updatedWorker, config)

    const found = manifest.members.find(m => m.id === worker.id)
    expect(found?.capabilities).toContain("research")
  })

  // Issue A fix test: maxMembers enforcement
  test("addMember throws when maxMembers reached", () => {
    const coord = createAgentIdentity({
      name: "coordinator",
      sessionId: "sess_coord",
      role: "coordinator",
    })

    // Create team with maxMembers=1 (only coordinator allowed)
    createTeam("test-team", coord, config, {
      settings: { maxMembers: 1 },
    })

    const worker = createAgentIdentity({
      name: "worker-1",
      sessionId: "sess_worker",
      role: "worker",
    })

    // Should throw because maxMembers=1 and coordinator already fills it
    expect(() => {
      addMember("test-team", worker, config)
    }).toThrow("reached maximum members")
  })

  test("addMember succeeds when under maxMembers limit", () => {
    const coord = createAgentIdentity({
      name: "coordinator",
      sessionId: "sess_coord",
      role: "coordinator",
    })

    // Create team with maxMembers=2
    createTeam("test-team", coord, config, {
      settings: { maxMembers: 2 },
    })

    const worker = createAgentIdentity({
      name: "worker-1",
      sessionId: "sess_worker",
      role: "worker",
    })

    // Should succeed (coordinator + 1 worker = 2, at limit)
    const manifest = addMember("test-team", worker, config)
    expect(manifest.members.length).toBe(2)

    // Adding another should fail
    const worker2 = createAgentIdentity({
      name: "worker-2",
      sessionId: "sess_worker2",
      role: "worker",
    })

    expect(() => {
      addMember("test-team", worker2, config)
    }).toThrow("reached maximum members")
  })

  test("removeMember is idempotent for already removed member", () => {
    const coord = createAgentIdentity({
      name: "coordinator",
      sessionId: "sess_coord",
      role: "coordinator",
    })

    createTeam("test-team", coord, config)

    const worker = createAgentIdentity({
      name: "worker-1",
      sessionId: "sess_worker",
      role: "worker",
    })

    addMember("test-team", worker, config)
    removeMember("test-team", worker.id, config)

    // Second call should be idempotent (no error)
    const manifest = removeMember("test-team", worker.id, config)
    expect(manifest.members.length).toBe(1) // Only coordinator
    expect(manifest.members.find(m => m.id === worker.id)).toBeUndefined()
  })

  test("removeMember removes worker", () => {
    const coord = createAgentIdentity({
      name: "coordinator",
      sessionId: "sess_coord",
      role: "coordinator",
    })

    createTeam("test-team", coord, config)

    const worker = createAgentIdentity({
      name: "worker-1",
      sessionId: "sess_worker",
      role: "worker",
    })

    addMember("test-team", worker, config)
    const manifest = removeMember("test-team", worker.id, config)

    expect(manifest.members.length).toBe(1)
    expect(manifest.members[0].id).toBe(coord.id)
  })

  test("removeMember fails for coordinator", () => {
    const coord = createAgentIdentity({
      name: "coordinator",
      sessionId: "sess_coord",
      role: "coordinator",
    })

    createTeam("test-team", coord, config)

    expect(() => {
      removeMember("test-team", coord.id, config)
    }).toThrow("Cannot remove coordinator")
  })

  test("updateMember updates heartbeat", () => {
    const coord = createAgentIdentity({
      name: "coordinator",
      sessionId: "sess_coord",
      role: "coordinator",
    })

    createTeam("test-team", coord, config)

    const newHeartbeat = Date.now() + 1000
    const manifest = updateMember("test-team", coord.id, { lastHeartbeat: newHeartbeat }, config)

    expect(manifest.members[0].lastHeartbeat).toBe(newHeartbeat)
  })

  test("heartbeat updates member timestamp", () => {
    const coord = createAgentIdentity({
      name: "coordinator",
      sessionId: "sess_coord",
      role: "coordinator",
    })

    createTeam("test-team", coord, config)

    const before = Date.now()
    Bun.sleepSync(10)
    heartbeat("test-team", coord.id, config)

    const manifest = readManifest("test-team", config)
    expect(manifest!.members[0].lastHeartbeat).toBeGreaterThan(before)
  })

  test("transferCoordinator changes coordinator", () => {
    const coord = createAgentIdentity({
      name: "coordinator",
      sessionId: "sess_coord",
      role: "coordinator",
    })

    createTeam("test-team", coord, config)

    const worker = createAgentIdentity({
      name: "worker-1",
      sessionId: "sess_worker",
      role: "worker",
    })

    addMember("test-team", worker, config)
    const manifest = transferCoordinator("test-team", worker.id, config)

    expect(manifest.coordinatorId).toBe(worker.id)
    expect(manifest.members.find(m => m.id === worker.id)?.role).toBe("coordinator")
    expect(manifest.members.find(m => m.id === coord.id)?.role).toBe("worker")
  })

  test("getMember returns member by ID", () => {
    const coord = createAgentIdentity({
      name: "coordinator",
      sessionId: "sess_coord",
      role: "coordinator",
    })

    createTeam("test-team", coord, config)

    const member = getMember("test-team", coord.id, config)
    expect(member).not.toBeNull()
    expect(member!.name).toBe("coordinator")

    const notFound = getMember("test-team", "nonexistent", config)
    expect(notFound).toBeNull()
  })

  test("getCoordinator returns coordinator", () => {
    const coord = createAgentIdentity({
      name: "coordinator",
      sessionId: "sess_coord",
      role: "coordinator",
    })

    createTeam("test-team", coord, config)

    const coordinator = getCoordinator("test-team", config)
    expect(coordinator).not.toBeNull()
    expect(coordinator!.id).toBe(coord.id)
  })

  test("getWorkers returns non-coordinator members", () => {
    const coord = createAgentIdentity({
      name: "coordinator",
      sessionId: "sess_coord",
      role: "coordinator",
    })

    createTeam("test-team", coord, config)

    const worker1 = createAgentIdentity({ name: "worker-1", sessionId: "sess_1", role: "worker" })
    const worker2 = createAgentIdentity({ name: "worker-2", sessionId: "sess_2", role: "worker" })

    addMember("test-team", worker1, config)
    addMember("test-team", worker2, config)

    const workers = getWorkers("test-team", config)
    expect(workers.length).toBe(2)
    expect(workers.find(w => w.id === worker1.id)).toBeDefined()
    expect(workers.find(w => w.id === worker2.id)).toBeDefined()
    expect(workers.find(w => w.id === coord.id)).toBeUndefined()
  })

  test("isCoordinator checks coordinator status", () => {
    const coord = createAgentIdentity({
      name: "coordinator",
      sessionId: "sess_coord",
      role: "coordinator",
    })

    createTeam("test-team", coord, config)

    const worker = createAgentIdentity({ name: "worker", sessionId: "sess_w", role: "worker" })
    addMember("test-team", worker, config)

    expect(isCoordinator("test-team", coord.id, config)).toBe(true)
    expect(isCoordinator("test-team", worker.id, config)).toBe(false)
  })

  test("listTeams returns all teams", () => {
    const coord1 = createAgentIdentity({ name: "coord1", sessionId: "s1", role: "coordinator" })
    const coord2 = createAgentIdentity({ name: "coord2", sessionId: "s2", role: "coordinator" })

    createTeam("team-alpha", coord1, config)
    createTeam("team-beta", coord2, config)

    const teams = listTeams(config)
    expect(teams).toContain("team-alpha")
    expect(teams).toContain("team-beta")
  })

  test("deleteTeam removes team", () => {
    const coord = createAgentIdentity({
      name: "coordinator",
      sessionId: "sess_coord",
      role: "coordinator",
    })

    createTeam("test-team", coord, config)
    expect(teamExists("test-team", config)).toBe(true)

    deleteTeam("test-team", config)
    expect(teamExists("test-team", config)).toBe(false)
  })

  // P0-1: Coordinator takeover tests
  describe("takeoverAsCoordinator", () => {
    test("takeover succeeds when old coordinator heartbeat timed out", () => {
      const oldCoord = createAgentIdentity({
        name: "old-coordinator",
        sessionId: "sess_old",
        role: "coordinator",
      })

      createTeam("test-team", oldCoord, config, {
        settings: { heartbeatTimeoutMs: 100 },
      })

      // Simulate old coordinator heartbeat timing out
      Bun.sleepSync(150)

      const newCoord = createAgentIdentity({
        name: "new-coordinator",
        sessionId: "sess_new",
        role: "coordinator",
      })

      const result = takeoverAsCoordinator("test-team", newCoord, config)
      expect(result.success).toBe(true)
      expect(result.previousCoordinatorId).toBe(oldCoord.id)

      const manifest = readManifest("test-team", config)
      expect(manifest!.coordinatorId).toBe(newCoord.id)
      expect(manifest!.members.find(m => m.id === newCoord.id)?.role).toBe("coordinator")
      expect(manifest!.members.find(m => m.id === oldCoord.id)?.role).toBe("worker")
    })

    test("takeover fails when old coordinator is still alive", () => {
      const oldCoord = createAgentIdentity({
        name: "old-coordinator",
        sessionId: "sess_old",
        role: "coordinator",
      })

      createTeam("test-team", oldCoord, config, {
        settings: { heartbeatTimeoutMs: 30000 },
      })

      // Update heartbeat to keep coordinator alive
      heartbeat("test-team", oldCoord.id, config)

      const newCoord = createAgentIdentity({
        name: "new-coordinator",
        sessionId: "sess_new",
        role: "coordinator",
      })

      const result = takeoverAsCoordinator("test-team", newCoord, config)
      expect(result.success).toBe(false)
      expect(result.reason).toContain("still alive")

      const manifest = readManifest("test-team", config)
      expect(manifest!.coordinatorId).toBe(oldCoord.id)
    })

    test("takeover succeeds with force option", () => {
      const oldCoord = createAgentIdentity({
        name: "old-coordinator",
        sessionId: "sess_old",
        role: "coordinator",
      })

      createTeam("test-team", oldCoord, config)
      heartbeat("test-team", oldCoord.id, config)

      const newCoord = createAgentIdentity({
        name: "new-coordinator",
        sessionId: "sess_new",
        role: "coordinator",
      })

      const result = takeoverAsCoordinator("test-team", newCoord, config, { force: true })
      expect(result.success).toBe(true)

      const manifest = readManifest("test-team", config)
      expect(manifest!.coordinatorId).toBe(newCoord.id)
    })

    test("takeover is no-op for same coordinator", () => {
      const coord = createAgentIdentity({
        name: "coordinator",
        sessionId: "sess_coord",
        role: "coordinator",
      })

      createTeam("test-team", coord, config)

      const result = takeoverAsCoordinator("test-team", coord, config)
      expect(result.success).toBe(true)
      expect(result.previousCoordinatorId).toBe(coord.id)
    })
  })

  // P0-2: Level-triggered idle workers tests
  describe("idleWorkers", () => {
    test("markWorkerIdle adds worker to idle list", () => {
      const coord = createAgentIdentity({
        name: "coordinator",
        sessionId: "sess_coord",
        role: "coordinator",
      })
      createTeam("test-team", coord, config)

      const worker = createAgentIdentity({
        name: "worker-1",
        sessionId: "sess_worker",
        role: "worker",
      })
      addMember("test-team", worker, config)

      markWorkerIdle("test-team", worker.id, config)

      const idleWorkers = getIdleWorkersFromManifest("test-team", config)
      expect(idleWorkers).toContain(worker.id)
    })

    test("markWorkerIdle is idempotent", () => {
      const coord = createAgentIdentity({
        name: "coordinator",
        sessionId: "sess_coord",
        role: "coordinator",
      })
      createTeam("test-team", coord, config)

      const worker = createAgentIdentity({
        name: "worker-1",
        sessionId: "sess_worker",
        role: "worker",
      })
      addMember("test-team", worker, config)

      markWorkerIdle("test-team", worker.id, config)
      markWorkerIdle("test-team", worker.id, config)

      const manifest = readManifest("test-team", config)
      expect(manifest!.idleWorkers.filter(id => id === worker.id).length).toBe(1)
    })

    test("markWorkerBusy removes worker from idle list", () => {
      const coord = createAgentIdentity({
        name: "coordinator",
        sessionId: "sess_coord",
        role: "coordinator",
      })
      createTeam("test-team", coord, config)

      const worker = createAgentIdentity({
        name: "worker-1",
        sessionId: "sess_worker",
        role: "worker",
      })
      addMember("test-team", worker, config)

      markWorkerIdle("test-team", worker.id, config)
      expect(getIdleWorkersFromManifest("test-team", config)).toContain(worker.id)

      markWorkerBusy("test-team", worker.id, config)
      expect(getIdleWorkersFromManifest("test-team", config)).not.toContain(worker.id)
    })

    test("createTeam initializes empty idleWorkers", () => {
      const coord = createAgentIdentity({
        name: "coordinator",
        sessionId: "sess_coord",
        role: "coordinator",
      })

      const manifest = createTeam("test-team", coord, config)
      expect(manifest.idleWorkers).toEqual([])
    })
  })
})
