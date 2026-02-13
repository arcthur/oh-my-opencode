import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { mkdirSync, rmSync, existsSync, readdirSync, readFileSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import type { OhMyOpenCodeConfig } from "../../../config/schema"
import { createTeam, createAgentIdentity } from "../team/manifest"
import { createInbox, sendMessage } from "../mailbox/writer"
import { readByType } from "../mailbox/reader"
import { signControlMessage } from "../security/control-message-signature"
import {
  createFsMailboxTransport,
  type MailboxTransport,
} from "../mailbox"
import { createWorker } from "./worker"

describe("agent/worker plan approval + mode control", () => {
  let testDir: string
  let config: Partial<OhMyOpenCodeConfig>
  const teamName = "test-team"

  beforeEach(() => {
    testDir = join(tmpdir(), `swarm-worker-plan-mode-test-${Date.now()}`)
    mkdirSync(testDir, { recursive: true })

    config = {
      orchestrator: {
        swarm: {
          enabled: true,
          storage_path: testDir,
          ui_mode: "toast",
          enforce_signature: false,
        },
      },
    }
  })

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true })
    }
  })

  async function waitUntil(fn: () => boolean, timeoutMs = 3000): Promise<void> {
    const start = Date.now()
    while (Date.now() - start < timeoutMs) {
      if (fn()) return
      await Bun.sleep(25)
    }
    throw new Error("timeout waiting for condition")
  }

  test("plan approval timeout resumes to WORKING (does not orphan task)", async () => {
    // given
    const coordinator = createAgentIdentity({
      name: "coordinator",
      sessionId: "sess_coord",
      role: "coordinator",
    })
    createTeam(teamName, coordinator, config, {
      settings: { autoApprove: true },
    })
    createInbox(teamName, coordinator.id, config)

    const worker = await createWorker(
      {
        teamName,
        name: "worker-1",
        sessionId: "sess_worker",
        onTaskAssigned: async () => true,
      },
      config
    )
    expect(worker).not.toBeNull()
    const w = worker!

    // assign a task to get into WORKING state
    sendMessage(
      teamName,
      coordinator.id,
      w.getIdentity().id,
      {
        type: "task_assignment",
        taskId: "task_001",
        title: "Test task",
        description: "Do thing",
        assignedBy: coordinator.id,
        timestamp: Date.now(),
      },
      config
    )

    await waitUntil(() => w.isWorking())

    // when
    const result = await w.requestPlanApproval("# Plan", { timeoutMs: 150 })

    // then
    expect(result.decision).toBe("rejected")
    expect(w.getState().status).toBe("working")
    expect(w.getCurrentTask()?.id).toBe("task_001")
  })

  test("mode acceptEdits causes requestPermission(Edit) to auto-approve without coordinator message", async () => {
    // given
    const coordinator = createAgentIdentity({
      name: "coordinator",
      sessionId: "sess_coord",
      role: "coordinator",
    })
    createTeam(teamName, coordinator, config, {
      settings: { autoApprove: true },
    })
    createInbox(teamName, coordinator.id, config)

    const worker = await createWorker(
      {
        teamName,
        name: "worker-1",
        sessionId: "sess_worker",
        onTaskAssigned: async () => true,
      },
      config
    )
    expect(worker).not.toBeNull()
    const w = worker!

    sendMessage(
      teamName,
      coordinator.id,
      w.getIdentity().id,
      {
        type: "task_assignment",
        taskId: "task_001",
        title: "Test task",
        description: "Do thing",
        assignedBy: coordinator.id,
        timestamp: Date.now(),
      },
      config
    )
    await waitUntil(() => w.isWorking())

    // Set mode via message
    sendMessage(
      teamName,
      coordinator.id,
      w.getIdentity().id,
      { type: "mode_set_request", mode: "acceptEdits" },
      config
    )

    await waitUntil(() => w.getCurrentMode() === "acceptEdits")

    // when
    const result = await w.requestPermission("Edit", { filePath: "x" }, { timeoutMs: 200 })

    // then
    expect(result.approved).toBe(true)

    // Coordinator should NOT receive a permission_request in this mode
    const permissionRequests = readByType(teamName, coordinator.id, "permission_request", config)
    expect(permissionRequests.length).toBe(0)
  })

  test("mode bypassPermissions causes requestPermission(Bash) to auto-approve without coordinator message", async () => {
    // given
    const coordinator = createAgentIdentity({
      name: "coordinator",
      sessionId: "sess_coord",
      role: "coordinator",
    })
    createTeam(teamName, coordinator, config, {
      settings: { autoApprove: true },
    })
    createInbox(teamName, coordinator.id, config)

    const worker = await createWorker(
      {
        teamName,
        name: "worker-1",
        sessionId: "sess_worker",
        onTaskAssigned: async () => true,
      },
      config
    )
    expect(worker).not.toBeNull()
    const w = worker!

    sendMessage(
      teamName,
      coordinator.id,
      w.getIdentity().id,
      {
        type: "task_assignment",
        taskId: "task_001",
        title: "Test task",
        description: "Do thing",
        assignedBy: coordinator.id,
        timestamp: Date.now(),
      },
      config
    )
    await waitUntil(() => w.isWorking())

    sendMessage(
      teamName,
      coordinator.id,
      w.getIdentity().id,
      { type: "mode_set_request", mode: "bypassPermissions" },
      config
    )
    await waitUntil(() => w.getCurrentMode() === "bypassPermissions")

    // when
    const result = await w.requestPermission("Bash", { command: "echo hi" }, { timeoutMs: 200 })

    // then
    expect(result.approved).toBe(true)
    const permissionRequests = readByType(teamName, coordinator.id, "permission_request", config)
    expect(permissionRequests.length).toBe(0)
  })

  test("plan approval approval marks task as approved for plan-mode gate", async () => {
    // given
    const coordinator = createAgentIdentity({
      name: "coordinator",
      sessionId: "sess_coord",
      role: "coordinator",
    })
    createTeam(teamName, coordinator, config, {
      settings: { autoApprove: true },
    })
    createInbox(teamName, coordinator.id, config)

    const worker = await createWorker(
      {
        teamName,
        name: "worker-1",
        sessionId: "sess_worker",
        onTaskAssigned: async () => true,
      },
      config
    )
    expect(worker).not.toBeNull()
    const w = worker!

    // put into plan mode
    sendMessage(
      teamName,
      coordinator.id,
      w.getIdentity().id,
      { type: "mode_set_request", mode: "plan" },
      config
    )
    await waitUntil(() => w.getCurrentMode() === "plan")

    // assign a task
    sendMessage(
      teamName,
      coordinator.id,
      w.getIdentity().id,
      {
        type: "task_assignment",
        taskId: "task_001",
        title: "Test task",
        description: "Do thing",
        assignedBy: coordinator.id,
        timestamp: Date.now(),
      },
      config
    )
    await waitUntil(() => w.isWorking())

    // when: request approval and simulate coordinator response
    const p = w.requestPlanApproval("# Plan", { timeoutMs: 2000 })

    // Wait until worker actually sent the request so we can read requestId
    await waitUntil(() => readByType(teamName, coordinator.id, "plan_approval_request", config).length > 0)
    const req = readByType(teamName, coordinator.id, "plan_approval_request", config)[0]
    expect(req).toBeDefined()
    expect(req.payload.type).toBe("plan_approval_request")

    sendMessage(
      teamName,
      coordinator.id,
      w.getIdentity().id,
      {
        type: "plan_approval_response",
        requestId: (req.payload as { requestId: string }).requestId,
        decision: "approved",
        feedback: "ok",
      },
      config
    )

    const result = await p
    expect(result.decision).toBe("approved")
    expect(w.isPlanApprovedForCurrentTask()).toBe(true)
  })

  test("ignores mode_set_request from non-coordinator sender", async () => {
    // given
    const coordinator = createAgentIdentity({
      name: "coordinator",
      sessionId: "sess_coord",
      role: "coordinator",
    })
    createTeam(teamName, coordinator, config, {
      settings: { autoApprove: true },
    })
    createInbox(teamName, coordinator.id, config)

    const errors: string[] = []
    const worker = await createWorker(
      {
        teamName,
        name: "worker-1",
        sessionId: "sess_worker",
        onError: (err) => errors.push(err.message),
      },
      config
    )
    expect(worker).not.toBeNull()
    const w = worker!

    const attacker = createAgentIdentity({
      name: "attacker",
      sessionId: "sess_attacker",
      role: "worker",
    })
    createInbox(teamName, attacker.id, config)

    // when
    sendMessage(
      teamName,
      attacker.id,
      w.getIdentity().id,
      {
        type: "mode_set_request",
        mode: "bypassPermissions",
      },
      config
    )

    // then
    await Bun.sleep(200)
    expect(w.getCurrentMode()).toBe("default")
    expect(errors.some((m) => m.includes("sender_validation_failed"))).toBe(true)
  })

  test("records late permission_response after timeout", async () => {
    // given
    const coordinator = createAgentIdentity({
      name: "coordinator",
      sessionId: "sess_coord",
      role: "coordinator",
    })
    createTeam(teamName, coordinator, config, {
      settings: { autoApprove: true },
    })
    createInbox(teamName, coordinator.id, config)

    const worker = await createWorker(
      {
        teamName,
        name: "worker-1",
        sessionId: "sess_worker",
        onTaskAssigned: async () => true,
      },
      config
    )
    expect(worker).not.toBeNull()
    const w = worker!

    sendMessage(
      teamName,
      coordinator.id,
      w.getIdentity().id,
      {
        type: "task_assignment",
        taskId: "task_late_perm",
        title: "Test task",
        description: "Do thing",
        assignedBy: coordinator.id,
        timestamp: Date.now(),
      },
      config
    )
    await waitUntil(() => w.isWorking())

    const requestPromise = w.requestPermission("Bash", { command: "echo hi" }, { timeoutMs: 150 })
    await waitUntil(() => readByType(teamName, coordinator.id, "permission_request", config).length > 0)
    const request = readByType(teamName, coordinator.id, "permission_request", config)[0]
    expect(request).toBeDefined()
    expect(request.payload.type).toBe("permission_request")

    const timeoutResult = await requestPromise
    expect(timeoutResult.approved).toBe(false)

    // when: delayed response arrives after timeout
    sendMessage(
      teamName,
      coordinator.id,
      w.getIdentity().id,
      {
        type: "permission_response",
        requestId: (request.payload as { requestId: string }).requestId,
        decision: "approved",
      },
      config
    )

    // then: late-response diagnostics file is written
    await Bun.sleep(750)
    const lateDir = join(testDir, teamName, "diagnostics", "late-responses")
    expect(existsSync(lateDir)).toBe(true)
    const files = readdirSync(lateDir).filter((name) => name.endsWith(".json"))
    expect(files.length).toBeGreaterThan(0)
    const diagnostic = JSON.parse(readFileSync(join(lateDir, files[0]!), "utf-8")) as {
      type?: string
      requestId?: string
    }
    expect(diagnostic.type).toBe("late_permission_response")
    expect(diagnostic.requestId).toBe((request.payload as { requestId: string }).requestId)
  })

  test("rejects unsigned privileged message when enforce_signature is enabled", async () => {
    // #given
    const signedConfig: Partial<OhMyOpenCodeConfig> = {
      ...config,
      orchestrator: {
        ...config.orchestrator,
        swarm: {
          ...config.orchestrator?.swarm,
          enforce_signature: true,
        },
      },
    }

    const coordinator = createAgentIdentity({
      name: "coordinator",
      sessionId: "sess_coord",
      role: "coordinator",
    })
    createTeam(teamName, coordinator, signedConfig, {
      settings: { autoApprove: true },
    })
    createInbox(teamName, coordinator.id, signedConfig)

    const errors: string[] = []
    const worker = await createWorker(
      {
        teamName,
        name: "worker-1",
        sessionId: "sess_worker",
        onError: (err) => errors.push(err.message),
      },
      signedConfig
    )
    expect(worker).not.toBeNull()
    const w = worker!

    // #when
    sendMessage(
      teamName,
      coordinator.id,
      w.getIdentity().id,
      { type: "mode_set_request", mode: "acceptEdits" },
      signedConfig
    )
    await Bun.sleep(250)

    // #then
    expect(w.getCurrentMode()).toBe("default")
    expect(errors.some((m) => m.includes("signature_validation_failed"))).toBe(true)
  })

  test("accepts signed privileged message when enforce_signature is enabled", async () => {
    // #given
    const signedConfig: Partial<OhMyOpenCodeConfig> = {
      ...config,
      orchestrator: {
        ...config.orchestrator,
        swarm: {
          ...config.orchestrator?.swarm,
          enforce_signature: true,
        },
      },
    }

    const coordinator = createAgentIdentity({
      name: "coordinator",
      sessionId: "sess_coord",
      role: "coordinator",
    })
    createTeam(teamName, coordinator, signedConfig, {
      settings: { autoApprove: true },
    })
    createInbox(teamName, coordinator.id, signedConfig)

    const worker = await createWorker(
      {
        teamName,
        name: "worker-1",
        sessionId: "sess_worker",
      },
      signedConfig
    )
    expect(worker).not.toBeNull()
    const w = worker!

    const payload = { type: "mode_set_request", mode: "acceptEdits" } as const
    const auth = signControlMessage({
      teamName,
      fromAgentId: coordinator.id,
      toAgentId: w.getIdentity().id,
      payload,
      config: signedConfig,
    })
    expect(auth).toBeDefined()

    // #when
    sendMessage(
      teamName,
      coordinator.id,
      w.getIdentity().id,
      payload,
      signedConfig,
      { auth }
    )
    await waitUntil(() => w.getCurrentMode() === "acceptEdits")

    // #then
    expect(w.getCurrentMode()).toBe("acceptEdits")
  })

  test("uses injected MailboxTransport for coordinator-bound sends", async () => {
    // #given
    const coordinator = createAgentIdentity({
      name: "coordinator",
      sessionId: "sess_coord",
      role: "coordinator",
    })
    createTeam(teamName, coordinator, config, {
      settings: { autoApprove: true },
    })
    createInbox(teamName, coordinator.id, config)

    const baseTransport = createFsMailboxTransport(config)
    const sentTypes: string[] = []
    const transport: MailboxTransport = {
      createInbox: (team, agent) => baseTransport.createInbox(team, agent),
      startPolling: (team, agent, handler, options) =>
        baseTransport.startPolling(team, agent, handler, options),
      sendMessage: (team, from, to, payload, options) => {
        sentTypes.push(payload.type)
        return baseTransport.sendMessage(team, from, to, payload, options)
      },
      waitForMessage: (team, agent, messageType, timeoutMs) =>
        baseTransport.waitForMessage(team, agent, messageType, timeoutMs),
    }

    const worker = await createWorker(
      {
        teamName,
        name: "worker-1",
        sessionId: "sess_worker",
        onTaskAssigned: async () => true,
        mailboxTransport: transport,
      },
      config
    )
    expect(worker).not.toBeNull()
    const w = worker!

    sendMessage(
      teamName,
      coordinator.id,
      w.getIdentity().id,
      {
        type: "task_assignment",
        taskId: "task_transport_1",
        title: "Transport task",
        description: "Verify transport path",
        assignedBy: coordinator.id,
        timestamp: Date.now(),
      },
      config
    )
    await waitUntil(() => w.isWorking())

    // #when
    const result = await w.requestPermission("Bash", { command: "echo hi" }, { timeoutMs: 150 })

    // #then
    expect(result.approved).toBe(false)
    expect(sentTypes.includes("permission_request")).toBe(true)
  })
})
