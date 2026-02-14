import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { OhMyOpenCodeConfig } from "../../../src/config/schema"
import { createCoordinator } from "../../../src/features/orchestrator-swarm/agent/coordinator"
import { createWorker } from "../../../src/features/orchestrator-swarm/agent/worker"
import { sendMessage } from "../../../src/features/orchestrator-swarm/mailbox/writer"
import { getCoordinatorEpoch } from "../../../src/features/orchestrator-swarm/team"
import { waitFor } from "../helpers/wait-for"

function assignTaskToWorker(
  teamName: string,
  coordinatorId: string,
  workerId: string,
  taskId: string,
  config: Partial<OhMyOpenCodeConfig>
): void {
  sendMessage(
    teamName,
    coordinatorId,
    workerId,
    {
      type: "task_assignment",
      taskId,
      title: `Task ${taskId}`,
      description: `Assigned task ${taskId}`,
      assignedBy: coordinatorId,
      timestamp: Date.now(),
    },
    config,
    {
      epoch: getCoordinatorEpoch(teamName, config) ?? undefined,
    }
  )
}

describe("orchestrator-swarm coordinator approvals", () => {
  let workspace: string
  let config: Partial<OhMyOpenCodeConfig>

  beforeEach(() => {
    workspace = join(tmpdir(), `coordinator-approval-${Date.now()}-${Math.random().toString(16).slice(2)}`)
    mkdirSync(workspace, { recursive: true })

    config = {
      orchestrator: {
        tasks: {
          enabled: true,
          storage_path: join(workspace, "tasks"),
        },
        swarm: {
          enabled: true,
          storage_path: join(workspace, "teams"),
          ui_mode: "toast",
          worker_count: 0,
          enforce_signature: false,
        },
      },
    }

    mkdirSync(join(workspace, "tasks"), { recursive: true })
    mkdirSync(join(workspace, "teams"), { recursive: true })
  })

  afterEach(() => {
    if (existsSync(workspace)) {
      rmSync(workspace, { recursive: true, force: true })
    }
  })

  test("queues high-risk permission requests and applies manual approval decision", async () => {
    // #given
    const teamName = `swarm-permission-${Date.now()}`
    const coordinator = await createCoordinator(
      {
        teamName,
        name: "coordinator",
        sessionId: "sess-coordinator",
        autoApprove: true,
        autoApproveLowRisk: false,
        loopIntervalMs: 120,
      },
      config
    )
    expect(coordinator).not.toBeNull()

    const worker = await createWorker(
      {
        teamName,
        name: "worker-1",
        sessionId: "sess-worker-1",
        onTaskAssigned: async () => true,
      },
      config
    )
    expect(worker).not.toBeNull()

    try {
      assignTaskToWorker(
        teamName,
        coordinator!.getIdentity().id,
        worker!.getIdentity().id,
        "task-permission",
        config
      )
      await waitFor(() => {
        expect(worker!.isWorking()).toBe(true)
      }, {
        timeoutMs: 4_000,
        intervalMs: 25,
        description: "worker enters working state",
      })

      // #when
      const permissionPromise = worker!.requestPermission(
        "Bash",
        { command: "echo sensitive command" },
        { timeoutMs: 3_000 }
      )

      await waitFor(() => {
        expect(coordinator!.getPendingPermissions().length).toBe(1)
      }, {
        timeoutMs: 4_000,
        intervalMs: 25,
        description: "coordinator receives pending permission request",
      })

      const [pending] = coordinator!.getPendingPermissions()
      expect(pending?.toolName).toBe("Bash")
      expect(typeof pending?.requestId).toBe("string")

      const approved = coordinator!.approvePermission(
        pending!.requestId,
        { updatedInput: { command: "echo sanitized command" } }
      )
      expect(approved).toBe(true)

      // #then
      const permissionResult = await permissionPromise
      expect(permissionResult).toEqual({
        approved: true,
        updatedInput: { command: "echo sanitized command" },
      })
      expect(coordinator!.getPendingPermissions()).toEqual([])
      expect(worker!.isWorking()).toBe(true)
    } finally {
      await worker?.stop({ force: true })
      await coordinator?.stop({ deleteTeam: true })
    }
  })

  test("auto-approves low-risk permission requests by default and does not queue", async () => {
    // #given
    const teamName = `swarm-permission-lowrisk-${Date.now()}`
    const coordinator = await createCoordinator(
      {
        teamName,
        name: "coordinator",
        sessionId: "sess-coordinator-lowrisk",
        autoApprove: true,
        autoApproveLowRisk: true,
        loopIntervalMs: 120,
      },
      config
    )
    expect(coordinator).not.toBeNull()

    const worker = await createWorker(
      {
        teamName,
        name: "worker-1",
        sessionId: "sess-worker-lowrisk",
        onTaskAssigned: async () => true,
      },
      config
    )
    expect(worker).not.toBeNull()

    try {
      assignTaskToWorker(
        teamName,
        coordinator!.getIdentity().id,
        worker!.getIdentity().id,
        "task-permission-lowrisk",
        config
      )
      await waitFor(() => {
        expect(worker!.isWorking()).toBe(true)
      }, {
        timeoutMs: 4_000,
        intervalMs: 25,
        description: "worker enters working state",
      })

      // #when
      const result = await worker!.requestPermission(
        "Read",
        { file_path: "/tmp/demo.txt" },
        { timeoutMs: 3_000 }
      )

      // #then
      expect(result).toEqual({ approved: true })
      expect(coordinator!.getPendingPermissions()).toEqual([])
      expect(worker!.isWorking()).toBe(true)
    } finally {
      await worker?.stop({ force: true })
      await coordinator?.stop({ deleteTeam: true })
    }
  })

  test("queues low-risk permission requests when autoApproveLowRisk is disabled", async () => {
    // #given
    const teamName = `swarm-permission-lowrisk-manual-${Date.now()}`
    const coordinator = await createCoordinator(
      {
        teamName,
        name: "coordinator",
        sessionId: "sess-coordinator-lowrisk-manual",
        autoApprove: true,
        autoApproveLowRisk: false,
        loopIntervalMs: 120,
      },
      config
    )
    expect(coordinator).not.toBeNull()

    const worker = await createWorker(
      {
        teamName,
        name: "worker-1",
        sessionId: "sess-worker-lowrisk-manual",
        onTaskAssigned: async () => true,
      },
      config
    )
    expect(worker).not.toBeNull()

    try {
      assignTaskToWorker(
        teamName,
        coordinator!.getIdentity().id,
        worker!.getIdentity().id,
        "task-permission-lowrisk-manual",
        config
      )
      await waitFor(() => {
        expect(worker!.isWorking()).toBe(true)
      }, {
        timeoutMs: 4_000,
        intervalMs: 25,
        description: "worker enters working state",
      })

      // #when
      const permissionPromise = worker!.requestPermission(
        "Read",
        { file_path: "/tmp/demo.txt" },
        { timeoutMs: 3_000 }
      )

      await waitFor(() => {
        expect(coordinator!.getPendingPermissions().length).toBe(1)
      }, {
        timeoutMs: 4_000,
        intervalMs: 25,
        description: "coordinator receives pending low-risk permission request",
      })

      const [pending] = coordinator!.getPendingPermissions()
      expect(pending?.toolName).toBe("Read")
      expect(typeof pending?.requestId).toBe("string")

      const approved = coordinator!.approvePermission(pending!.requestId)
      expect(approved).toBe(true)

      // #then
      const result = await permissionPromise
      expect(result).toEqual({ approved: true })
      expect(coordinator!.getPendingPermissions()).toEqual([])
      expect(worker!.isWorking()).toBe(true)
    } finally {
      await worker?.stop({ force: true })
      await coordinator?.stop({ deleteTeam: true })
    }
  })

  test("manual plan revision request returns revision_requested to worker", async () => {
    // #given
    const teamName = `swarm-plan-revise-${Date.now()}`
    const coordinator = await createCoordinator(
      {
        teamName,
        name: "coordinator",
        sessionId: "sess-coordinator",
        autoApprove: true,
        loopIntervalMs: 120,
      },
      config
    )
    expect(coordinator).not.toBeNull()

    const worker = await createWorker(
      {
        teamName,
        name: "worker-1",
        sessionId: "sess-worker-1",
        onTaskAssigned: async () => true,
      },
      config
    )
    expect(worker).not.toBeNull()

    try {
      assignTaskToWorker(
        teamName,
        coordinator!.getIdentity().id,
        worker!.getIdentity().id,
        "task-plan-revise",
        config
      )
      await waitFor(() => {
        expect(worker!.isWorking()).toBe(true)
      }, {
        timeoutMs: 4_000,
        intervalMs: 25,
        description: "worker receives task assignment",
      })

      // #when
      const planPromise = worker!.requestPlanApproval(
        "# Plan\n- 1. Analyze\n- 2. Implement",
        { timeoutMs: 3_000, planFile: ".orchestrator/plans/demo/plan.md" }
      )

      await waitFor(() => {
        expect(coordinator!.getPendingPlanApprovals().length).toBe(1)
      }, {
        timeoutMs: 4_000,
        intervalMs: 25,
        description: "coordinator queues plan approval request",
      })

      const [pending] = coordinator!.getPendingPlanApprovals()
      expect(pending?.taskId).toBe(worker!.getCurrentTask()?.id)
      expect(pending?.planFile).toBe(".orchestrator/plans/demo/plan.md")

      const revised = coordinator!.requestPlanRevision(
        pending!.requestId,
        "Please include rollback and validation steps"
      )
      expect(revised).toBe(true)

      // #then
      const planResult = await planPromise
      expect(planResult).toEqual({
        decision: "revision_requested",
        feedback: "Please include rollback and validation steps",
      })
      expect(worker!.isWorking()).toBe(true)
      expect(worker!.isPlanApprovedForCurrentTask()).toBe(false)
      expect(coordinator!.getPendingPlanApprovals()).toEqual([])
    } finally {
      await worker?.stop({ force: true })
      await coordinator?.stop({ deleteTeam: true })
    }
  })

  test("manual plan approval marks worker task as approved", async () => {
    // #given
    const teamName = `swarm-plan-approve-${Date.now()}`
    const coordinator = await createCoordinator(
      {
        teamName,
        name: "coordinator",
        sessionId: "sess-coordinator",
        autoApprove: true,
        loopIntervalMs: 120,
      },
      config
    )
    expect(coordinator).not.toBeNull()

    const worker = await createWorker(
      {
        teamName,
        name: "worker-1",
        sessionId: "sess-worker-1",
        onTaskAssigned: async () => true,
      },
      config
    )
    expect(worker).not.toBeNull()

    try {
      assignTaskToWorker(
        teamName,
        coordinator!.getIdentity().id,
        worker!.getIdentity().id,
        "task-plan-approve",
        config
      )
      await waitFor(() => {
        expect(worker!.isWorking()).toBe(true)
      }, {
        timeoutMs: 4_000,
        intervalMs: 25,
        description: "worker enters working state",
      })

      // #when
      const planPromise = worker!.requestPlanApproval(
        "# Plan\n- Validate contracts",
        { timeoutMs: 3_000 }
      )

      await waitFor(() => {
        expect(coordinator!.getPendingPlanApprovals().length).toBe(1)
      }, {
        timeoutMs: 4_000,
        intervalMs: 25,
        description: "plan approval queued",
      })
      const requestId = coordinator!.getPendingPlanApprovals()[0]!.requestId
      const approved = coordinator!.approvePlan(requestId, "Looks good")
      expect(approved).toBe(true)

      // #then
      const planResult = await planPromise
      expect(planResult).toEqual({
        decision: "approved",
        feedback: "Looks good",
      })
      expect(worker!.isPlanApprovedForCurrentTask()).toBe(true)
      expect(coordinator!.getPendingPlanApprovals()).toEqual([])
    } finally {
      await worker?.stop({ force: true })
      await coordinator?.stop({ deleteTeam: true })
    }
  })
})
