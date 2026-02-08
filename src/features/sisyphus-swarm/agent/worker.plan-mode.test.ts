import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { mkdirSync, rmSync, existsSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import type { OhMyOpenCodeConfig } from "../../../config/schema"
import { createTeam, createAgentIdentity } from "../team/manifest"
import { createInbox, sendMessage } from "../mailbox/writer"
import { readByType } from "../mailbox/reader"
import { createWorker } from "./worker"

describe("agent/worker plan approval + mode control", () => {
  let testDir: string
  let config: Partial<OhMyOpenCodeConfig>
  const teamName = "test-team"

  beforeEach(() => {
    testDir = join(tmpdir(), `swarm-worker-plan-mode-test-${Date.now()}`)
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
})
