import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import type { OhMyOpenCodeConfig } from "../../../config/schema"
import { ORCHESTRATOR_PROJECT_ROOT_ENV } from "../../orchestrator-tasks/storage"
import { sendMessage } from "../mailbox/writer"
import { readByType } from "../mailbox/reader"
import { createFsMailboxTransport, type MailboxTransport } from "../mailbox"
import { addMemberAsync, createAgentIdentity, getCoordinatorEpoch, readManifest } from "../team"
import { assignSwarmTask, createSwarmTask, readSwarmTaskNode } from "../task-graph"
import { createCoordinator } from "./coordinator"

describe("agent/coordinator sender validation", () => {
  let projectRoot: string
  let previousRoot: string | undefined
  let config: Partial<OhMyOpenCodeConfig>

  beforeEach(() => {
    previousRoot = process.env[ORCHESTRATOR_PROJECT_ROOT_ENV]
    projectRoot = join(
      tmpdir(),
      `coordinator-security-${Date.now()}-${Math.random().toString(16).slice(2)}`
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
        },
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

  test("ignores task_completed when payload agentId does not match sender", async () => {
    // #given
    const teamName = "team-security"
    let completedCount = 0
    const coordinator = await createCoordinator(
      {
        teamName,
        name: "coordinator",
        sessionId: "sess-coordinator",
        autoApprove: true,
        onTaskCompleted: () => {
          completedCount++
        },
      },
      config
    )
    expect(coordinator).not.toBeNull()
    const coord = coordinator!

    const workerA = createAgentIdentity({
      name: "worker-a",
      sessionId: "sess-worker-a",
      role: "worker",
      capabilities: ["code"],
    })
    const workerB = createAgentIdentity({
      name: "worker-b",
      sessionId: "sess-worker-b",
      role: "worker",
      capabilities: ["code"],
    })
    await addMemberAsync(teamName, workerA, config)
    await addMemberAsync(teamName, workerB, config)

    const task = createSwarmTask(
      teamName,
      {
        title: "Security task",
        description: "Verify completion message identity",
      },
      config
    )
    const assigned = assignSwarmTask(teamName, task.id, workerA.id, config)
    expect(assigned).not.toBeNull()

    // #when: workerB forges completion for workerA
    sendMessage(
      teamName,
      workerB.id,
      coord.getIdentity().id,
      {
        type: "task_completed",
        taskId: task.id,
        agentId: workerA.id,
        timestamp: Date.now(),
      },
      config,
      {
        epoch: getCoordinatorEpoch(teamName, config) ?? undefined,
      }
    )
    await Bun.sleep(220)

    // #then
    expect(completedCount).toBe(0)
    const node = readSwarmTaskNode(teamName, task.id, config)
    expect(node?.state).toBe("in_progress")

    await coord.stop({ deleteTeam: true })
  })

  test("ignores task_completed from stale epoch", async () => {
    // #given
    const teamName = "team-epoch-fencing"
    let completedCount = 0
    const coordinator = await createCoordinator(
      {
        teamName,
        name: "coordinator",
        sessionId: "sess-coordinator",
        autoApprove: true,
        onTaskCompleted: () => {
          completedCount++
        },
      },
      config
    )
    expect(coordinator).not.toBeNull()
    const coord = coordinator!

    const worker = createAgentIdentity({
      name: "worker-a",
      sessionId: "sess-worker-a",
      role: "worker",
      capabilities: ["code"],
    })
    await addMemberAsync(teamName, worker, config)

    const task = createSwarmTask(
      teamName,
      {
        title: "Epoch task",
        description: "Verify stale epochs are fenced",
      },
      config
    )
    const assigned = assignSwarmTask(teamName, task.id, worker.id, config)
    expect(assigned).not.toBeNull()

    const currentEpoch = getCoordinatorEpoch(teamName, config) ?? 1
    const staleEpoch = Math.max(0, currentEpoch - 1)

    // #when
    sendMessage(
      teamName,
      worker.id,
      coord.getIdentity().id,
      {
        type: "task_completed",
        taskId: task.id,
        agentId: worker.id,
        timestamp: Date.now(),
      },
      config,
      { epoch: staleEpoch }
    )
    await Bun.sleep(220)

    // #then
    expect(completedCount).toBe(0)
    const node = readSwarmTaskNode(teamName, task.id, config)
    expect(node?.state).toBe("in_progress")

    await coord.stop({ deleteTeam: true })
  })

  test("uses injected MailboxTransport for control messages", async () => {
    // #given
    const teamName = "team-transport"
    const sentTypes: string[] = []
    const baseTransport = createFsMailboxTransport(config)
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

    const coordinator = await createCoordinator(
      {
        teamName,
        name: "coordinator",
        sessionId: "sess-coordinator",
        autoApprove: true,
        mailboxTransport: transport,
      },
      config
    )
    expect(coordinator).not.toBeNull()
    const coord = coordinator!

    const worker = createAgentIdentity({
      name: "worker",
      sessionId: "sess-worker",
      role: "worker",
      capabilities: ["code"],
    })
    await addMemberAsync(teamName, worker, config)
    baseTransport.createInbox(teamName, worker.id)
    await Bun.sleep(250)

    // #when
    const sent = coord.setWorkerMode(worker.id, "plan")

    // #then
    expect(sent).toBe(true)
    expect(sentTypes.includes("mode_set_request")).toBe(true)

    await coord.stop({ deleteTeam: true })
  })

  test("rejects join_request with missing capabilities and keeps manifest valid", async () => {
    // #given
    const teamName = "team-join-validation"
    const coordinator = await createCoordinator(
      {
        teamName,
        name: "coordinator",
        sessionId: "sess-coordinator",
        autoApprove: true,
      },
      config
    )
    expect(coordinator).not.toBeNull()
    const coord = coordinator!
    const legacyAgentId = "agent_legacy"

    // #when: send malformed join_request without capabilities
    sendMessage(
      teamName,
      legacyAgentId,
      coord.getIdentity().id,
      {
        type: "join_request",
        agentName: "legacy-worker",
        sessionId: "sess-legacy",
      } as unknown as Parameters<typeof sendMessage>[3],
      config
    )
    await Bun.sleep(260)

    // #then
    const rejections = readByType(teamName, legacyAgentId, "join_rejected", config)
    expect(rejections.length).toBeGreaterThan(0)
    expect(rejections[0].payload.type).toBe("join_rejected")
    expect(rejections[0].payload.reason).toContain("capabilities")

    const manifest = readManifest(teamName, config)
    expect(manifest).not.toBeNull()
    expect(manifest!.members.length).toBe(1)
    expect(manifest!.coordinatorId).toBe(coord.getIdentity().id)

    await coord.stop({ deleteTeam: true })
  })
})
