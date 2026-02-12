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
  addMemberAsync,
  removeMemberAsync,
  updateMemberAsync,
  heartbeat,
  getMember,
  getCoordinator,
  getWorkers,
  isCoordinator,
  listTeams,
  deleteTeam,
  takeoverAsCoordinatorAsync,
  markWorkerIdle,
  markWorkerBusy,
  getIdleWorkersFromManifest,
} from "./manifest"
import { writeHeartbeat } from "./heartbeat-store"

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

  test("generateAgentId creates unique IDs", async () => {
    const id1 = generateAgentId()
    const id2 = generateAgentId()

    expect(id1).toMatch(/^agent_[a-z0-9-]{8}$/)
    expect(id2).toMatch(/^agent_[a-z0-9-]{8}$/)
    expect(id1).not.toBe(id2)
  })

  test("createAgentIdentity creates valid identity", async () => {
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

  test("createTeam creates team with coordinator", async () => {
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

  test("createTeam fails if team exists", async () => {
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

  test("addMemberAsync adds worker to team", async () => {
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

    const manifest = await addMemberAsync("test-team", worker, config)

    expect(manifest.members.length).toBe(2)
    expect(manifest.members[1].id).toBe(worker.id)
  })

  test("addMemberAsync is idempotent for duplicate member", async () => {
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

    await addMemberAsync("test-team", worker, config)

    // Second call should be idempotent (no error)
    const manifest = await addMemberAsync("test-team", worker, config)
    expect(manifest.members.length).toBe(2) // Still 2 members
    expect(manifest.members.filter(m => m.id === worker.id).length).toBe(1)
  })

  test("addMemberAsync updates existing member fields on duplicate", async () => {
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

    await addMemberAsync("test-team", worker, config)

    // Update with new capabilities
    const updatedWorker = { ...worker, capabilities: ["code", "research"] as ("code" | "research" | "design" | "review")[] }
    const manifest = await addMemberAsync("test-team", updatedWorker, config)

    const found = manifest.members.find(m => m.id === worker.id)
    expect(found?.capabilities).toContain("research")
  })

  // Issue A fix test: maxMembers enforcement
  test("addMemberAsync throws when maxMembers reached", async () => {
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
    await expect(addMemberAsync("test-team", worker, config)).rejects.toThrow("reached maximum members")
  })

  test("addMemberAsync succeeds when under maxMembers limit", async () => {
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
    const manifest = await addMemberAsync("test-team", worker, config)
    expect(manifest.members.length).toBe(2)

    // Adding another should fail
    const worker2 = createAgentIdentity({
      name: "worker-2",
      sessionId: "sess_worker2",
      role: "worker",
    })

    await expect(addMemberAsync("test-team", worker2, config)).rejects.toThrow("reached maximum members")
  })

  test("removeMemberAsync is idempotent for already removed member", async () => {
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

    await addMemberAsync("test-team", worker, config)
    await removeMemberAsync("test-team", worker.id, config)

    // Second call should be idempotent (no error)
    const manifest = await removeMemberAsync("test-team", worker.id, config)
    expect(manifest.members.length).toBe(1) // Only coordinator
    expect(manifest.members.find(m => m.id === worker.id)).toBeUndefined()
  })

  test("removeMemberAsync removes worker", async () => {
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

    await addMemberAsync("test-team", worker, config)
    const manifest = await removeMemberAsync("test-team", worker.id, config)

    expect(manifest.members.length).toBe(1)
    expect(manifest.members[0].id).toBe(coord.id)
  })

  test("removeMemberAsync fails for coordinator", async () => {
    const coord = createAgentIdentity({
      name: "coordinator",
      sessionId: "sess_coord",
      role: "coordinator",
    })

    createTeam("test-team", coord, config)

    await expect(removeMemberAsync("test-team", coord.id, config)).rejects.toThrow("Cannot remove coordinator")
  })

  test("updateMemberAsync updates heartbeat", async () => {
    const coord = createAgentIdentity({
      name: "coordinator",
      sessionId: "sess_coord",
      role: "coordinator",
    })

    createTeam("test-team", coord, config)

    const newHeartbeat = Date.now() + 1000
    const manifest = await updateMemberAsync("test-team", coord.id, { lastHeartbeat: newHeartbeat }, config)

    expect(manifest.members[0].lastHeartbeat).toBe(newHeartbeat)
  })

  test("heartbeat updates member timestamp", async () => {
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

  test("readManifest can skip heartbeat hydration on hot paths", async () => {
    // #given
    const coord = createAgentIdentity({
      name: "coordinator",
      sessionId: "sess_coord",
      role: "coordinator",
    })
    const created = createTeam("test-team", coord, config)
    const initial = created.members[0].lastHeartbeat
    const freshHeartbeat = Date.now() + 5000
    writeHeartbeat("test-team", coord.id, config, freshHeartbeat)

    // #when
    const hydrated = readManifest("test-team", config)
    const raw = readManifest("test-team", config, { includeHeartbeats: false })

    // #then
    expect(hydrated).not.toBeNull()
    expect(raw).not.toBeNull()
    expect(hydrated!.members[0].lastHeartbeat).toBe(freshHeartbeat)
    expect(raw!.members[0].lastHeartbeat).toBe(initial)
  })

  test("getMember returns member by ID", async () => {
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

  test("getCoordinator returns coordinator", async () => {
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

  test("getWorkers returns non-coordinator members", async () => {
    const coord = createAgentIdentity({
      name: "coordinator",
      sessionId: "sess_coord",
      role: "coordinator",
    })

    createTeam("test-team", coord, config)

    const worker1 = createAgentIdentity({ name: "worker-1", sessionId: "sess_1", role: "worker" })
    const worker2 = createAgentIdentity({ name: "worker-2", sessionId: "sess_2", role: "worker" })

    await addMemberAsync("test-team", worker1, config)
    await addMemberAsync("test-team", worker2, config)

    const workers = getWorkers("test-team", config)
    expect(workers.length).toBe(2)
    expect(workers.find(w => w.id === worker1.id)).toBeDefined()
    expect(workers.find(w => w.id === worker2.id)).toBeDefined()
    expect(workers.find(w => w.id === coord.id)).toBeUndefined()
  })

  test("isCoordinator checks coordinator status", async () => {
    const coord = createAgentIdentity({
      name: "coordinator",
      sessionId: "sess_coord",
      role: "coordinator",
    })

    createTeam("test-team", coord, config)

    const worker = createAgentIdentity({ name: "worker", sessionId: "sess_w", role: "worker" })
    await addMemberAsync("test-team", worker, config)

    expect(isCoordinator("test-team", coord.id, config)).toBe(true)
    expect(isCoordinator("test-team", worker.id, config)).toBe(false)
  })

  test("listTeams returns all teams", async () => {
    const coord1 = createAgentIdentity({ name: "coord1", sessionId: "s1", role: "coordinator" })
    const coord2 = createAgentIdentity({ name: "coord2", sessionId: "s2", role: "coordinator" })

    createTeam("team-alpha", coord1, config)
    createTeam("team-beta", coord2, config)

    const teams = listTeams(config)
    expect(teams).toContain("team-alpha")
    expect(teams).toContain("team-beta")
  })

  test("deleteTeam removes team", async () => {
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
  describe("takeoverAsCoordinatorAsync", () => {
    test("takeover succeeds when old coordinator heartbeat timed out", async () => {
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

      const result = await takeoverAsCoordinatorAsync("test-team", newCoord, config)
      expect(result.success).toBe(true)
      expect(result.previousCoordinatorId).toBe(oldCoord.id)

      const manifest = readManifest("test-team", config)
      expect(manifest!.coordinatorId).toBe(newCoord.id)
      expect(manifest!.members.find(m => m.id === newCoord.id)?.role).toBe("coordinator")
      expect(manifest!.members.find(m => m.id === oldCoord.id)?.role).toBe("worker")
    })

    test("takeover fails when old coordinator is still alive", async () => {
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

      const result = await takeoverAsCoordinatorAsync("test-team", newCoord, config)
      expect(result.success).toBe(false)
      expect(result.reason).toContain("still alive")

      const manifest = readManifest("test-team", config)
      expect(manifest!.coordinatorId).toBe(oldCoord.id)
    })

    test("takeover succeeds with force option", async () => {
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

      const result = await takeoverAsCoordinatorAsync("test-team", newCoord, config, { force: true })
      expect(result.success).toBe(true)

      const manifest = readManifest("test-team", config)
      expect(manifest!.coordinatorId).toBe(newCoord.id)
    })

    test("takeover is no-op for same coordinator", async () => {
      const coord = createAgentIdentity({
        name: "coordinator",
        sessionId: "sess_coord",
        role: "coordinator",
      })

      createTeam("test-team", coord, config)

      const result = await takeoverAsCoordinatorAsync("test-team", coord, config)
      expect(result.success).toBe(true)
      expect(result.previousCoordinatorId).toBe(coord.id)
    })
  })

  // P0-2: Level-triggered idle workers tests
  describe("idleWorkers", () => {
    test("markWorkerIdle adds worker to idle list", async () => {
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
      await addMemberAsync("test-team", worker, config)

      markWorkerIdle("test-team", worker.id, config)

      const idleWorkers = getIdleWorkersFromManifest("test-team", config)
      expect(idleWorkers).toContain(worker.id)
    })

    test("markWorkerIdle is idempotent", async () => {
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
      await addMemberAsync("test-team", worker, config)

      markWorkerIdle("test-team", worker.id, config)
      markWorkerIdle("test-team", worker.id, config)

      const idleWorkers = getIdleWorkersFromManifest("test-team", config)
      expect(idleWorkers.filter(id => id === worker.id).length).toBe(1)
    })

    test("markWorkerBusy removes worker from idle list", async () => {
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
      await addMemberAsync("test-team", worker, config)

      markWorkerIdle("test-team", worker.id, config)
      expect(getIdleWorkersFromManifest("test-team", config)).toContain(worker.id)

      markWorkerBusy("test-team", worker.id, config)
      expect(getIdleWorkersFromManifest("test-team", config)).not.toContain(worker.id)
    })

  })
})
