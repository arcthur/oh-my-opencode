import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { OhMyOpenCodeConfig } from "../../../src/config/schema"
import { createCoordinator } from "../../../src/features/orchestrator-swarm/agent/coordinator"
import { createWorker } from "../../../src/features/orchestrator-swarm/agent/worker"
import { sendMessage } from "../../../src/features/orchestrator-swarm/mailbox/writer"
import { createSwarmRuntimeService } from "../../../src/features/orchestrator-swarm/runtime"
import { getCoordinatorEpoch } from "../../../src/features/orchestrator-swarm/team"
import { createSwarmTool } from "../../../src/tools/swarm"
import { waitFor } from "../helpers/wait-for"

type SwarmIntegrationHarness = {
  workspace: string
  config: Partial<OhMyOpenCodeConfig>
  runtime: ReturnType<typeof createSwarmRuntimeService>
}

function parseFirstPlanRequestId(listOutput: string): string | null {
  for (const line of listOutput.split("\n")) {
    const trimmed = line.trim()
    const match = trimmed.match(/^- (plan_[a-z0-9-]{12})\b/i)
    if (match?.[1]) return match[1]
  }
  return null
}

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

function createHarness(): SwarmIntegrationHarness {
  const workspace = join(tmpdir(), `swarm-tool-plan-${Date.now()}-${Math.random().toString(16).slice(2)}`)
  const config: Partial<OhMyOpenCodeConfig> = {
    orchestrator: {
      swarm: {
        enabled: true,
        storage_path: join(workspace, "teams"),
        ui_mode: "toast",
        worker_count: 0,
        enforce_signature: false,
      },
      tasks: {
        enabled: true,
        storage_path: join(workspace, "tasks"),
      },
    },
  }
  mkdirSync(join(workspace, "teams"), { recursive: true })
  mkdirSync(join(workspace, "tasks"), { recursive: true })
  return {
    workspace,
    config,
    runtime: createSwarmRuntimeService(),
  }
}

describe("swarm plan lifecycle via swarm tool", () => {
  const createdWorkspaces: string[] = []

  beforeEach(() => {
    createdWorkspaces.length = 0
  })

  afterEach(() => {
    for (const workspace of createdWorkspaces) {
      if (existsSync(workspace)) {
        rmSync(workspace, { recursive: true, force: true })
      }
    }
  })

  test("submit -> list -> revise returns revision_requested to worker", async () => {
    // #given
    const harness = createHarness()
    createdWorkspaces.push(harness.workspace)
    const teamName = `swarm-tool-revise-${Date.now()}-${Math.random().toString(16).slice(2)}`

    const coordinatorSessionId = `sess-tool-coordinator-${Math.random().toString(16).slice(2)}`
    const workerSessionId = `sess-tool-worker-${Math.random().toString(16).slice(2)}`

    const coordinator = await createCoordinator(
      {
        teamName,
        name: "coordinator",
        sessionId: coordinatorSessionId,
        autoApprove: true,
        loopIntervalMs: 120,
      },
      harness.config
    )
    expect(coordinator).not.toBeNull()

    const worker = await createWorker(
      {
        teamName,
        name: "worker-1",
        sessionId: workerSessionId,
        onTaskAssigned: async () => true,
      },
      harness.config
    )
    expect(worker).not.toBeNull()

    harness.runtime.bindSessionToTeam(coordinatorSessionId, harness.workspace, teamName)
    harness.runtime.bindSessionToTeam(workerSessionId, harness.workspace, teamName)
    harness.runtime.registerCoordinator(coordinatorSessionId, coordinator!)
    harness.runtime.registerWorker(workerSessionId, worker!)

    const coordinatorTool = createSwarmTool({
      directory: harness.workspace,
      config: harness.config,
      runtime: harness.runtime,
      getSessionId: () => coordinatorSessionId,
    })
    const workerTool = createSwarmTool({
      directory: harness.workspace,
      config: harness.config,
      runtime: harness.runtime,
      getSessionId: () => workerSessionId,
    })
    const toolContext = {} as unknown as Parameters<typeof coordinatorTool.execute>[1]

    try {
      assignTaskToWorker(
        teamName,
        coordinator!.getIdentity().id,
        worker!.getIdentity().id,
        "task-plan-revise-tool",
        harness.config
      )
      await waitFor(() => {
        expect(worker!.isWorking()).toBe(true)
      }, {
        timeoutMs: 4_000,
        intervalMs: 25,
        description: "worker enters working state",
      })

      // #when
      const submitPromise = workerTool.execute(
        { command: "plan submit 1) Analyze API impacts\n2) Implement changes\n3) Validate rollback path" },
        toolContext
      )

      let requestId: string | null = null
      await waitFor(async () => {
        const listResult = await coordinatorTool.execute({ command: "plan list" }, toolContext)
        expect(listResult).toContain("Pending plan approvals:")
        requestId = parseFirstPlanRequestId(listResult)
        expect(requestId).not.toBeNull()
      }, {
        timeoutMs: 4_000,
        intervalMs: 50,
        description: "plan list includes requestId",
      })
      if (!requestId) {
        expect.unreachable("missing plan requestId in plan list output")
      }

      const reviseResult = await coordinatorTool.execute(
        { command: `plan revise ${requestId} Add explicit smoke-check steps` },
        toolContext
      )
      expect(reviseResult).toContain(`Requested revision for plan ${requestId}`)

      // #then
      const submitResult = await submitPromise
      expect(submitResult).toContain("Plan approval decision: revision_requested")
      expect(submitResult).toContain("Feedback: Add explicit smoke-check steps")
      await waitFor(() => {
        return coordinatorTool.execute({ command: "plan list" }, toolContext).then((listResult) => {
          expect(listResult).toContain("No pending plan approvals.")
        })
      }, {
        timeoutMs: 2_000,
        intervalMs: 50,
        description: "pending plan approvals cleared",
      })

      await waitFor(() => {
        expect(worker!.isWorking()).toBe(true)
      }, {
        timeoutMs: 2_000,
        intervalMs: 25,
        description: "worker resumes after revision request",
      })
    } finally {
      await worker?.stop({ force: true })
      await coordinator?.stop({ deleteTeam: true })
    }
  })

  test("submit -> approve/reject returns coordinator decision through tool output", async () => {
    // #given
    const harness = createHarness()
    createdWorkspaces.push(harness.workspace)
    const teamName = `swarm-tool-approve-reject-${Date.now()}-${Math.random().toString(16).slice(2)}`

    const coordinatorSessionId = `sess-tool-coordinator-2-${Math.random().toString(16).slice(2)}`
    const workerSessionId = `sess-tool-worker-2-${Math.random().toString(16).slice(2)}`

    const coordinator = await createCoordinator(
      {
        teamName,
        name: "coordinator",
        sessionId: coordinatorSessionId,
        autoApprove: true,
        loopIntervalMs: 120,
      },
      harness.config
    )
    expect(coordinator).not.toBeNull()

    const worker = await createWorker(
      {
        teamName,
        name: "worker-1",
        sessionId: workerSessionId,
        onTaskAssigned: async () => true,
      },
      harness.config
    )
    expect(worker).not.toBeNull()

    harness.runtime.bindSessionToTeam(coordinatorSessionId, harness.workspace, teamName)
    harness.runtime.bindSessionToTeam(workerSessionId, harness.workspace, teamName)
    harness.runtime.registerCoordinator(coordinatorSessionId, coordinator!)
    harness.runtime.registerWorker(workerSessionId, worker!)

    const coordinatorTool = createSwarmTool({
      directory: harness.workspace,
      config: harness.config,
      runtime: harness.runtime,
      getSessionId: () => coordinatorSessionId,
    })
    const workerTool = createSwarmTool({
      directory: harness.workspace,
      config: harness.config,
      runtime: harness.runtime,
      getSessionId: () => workerSessionId,
    })
    const toolContext = {} as unknown as Parameters<typeof coordinatorTool.execute>[1]

    try {
      assignTaskToWorker(
        teamName,
        coordinator!.getIdentity().id,
        worker!.getIdentity().id,
        "task-plan-approve-reject-tool",
        harness.config
      )
      await waitFor(() => {
        expect(worker!.isWorking()).toBe(true)
      }, {
        timeoutMs: 4_000,
        intervalMs: 25,
        description: "worker enters working state",
      })

      // #when - approve flow
      const approveSubmitPromise = workerTool.execute(
        { command: "plan submit 1) Implement approval path" },
        toolContext
      )
      let approveRequestId: string | null = null
      await waitFor(async () => {
        const listResult = await coordinatorTool.execute({ command: "plan list" }, toolContext)
        expect(listResult).toContain("Pending plan approvals:")
        approveRequestId = parseFirstPlanRequestId(listResult)
        expect(approveRequestId).not.toBeNull()
      }, {
        timeoutMs: 4_000,
        intervalMs: 50,
        description: "approve requestId appears in plan list",
      })
      if (!approveRequestId) {
        expect.unreachable("missing plan requestId for approve flow")
      }

      const approveResult = await coordinatorTool.execute(
        { command: `plan approve ${approveRequestId} Looks good` },
        toolContext
      )
      expect(approveResult).toContain(`Approved plan ${approveRequestId}`)

      const approveSubmitResult = await approveSubmitPromise
      expect(approveSubmitResult).toContain("Plan approval decision: approved")
      expect(approveSubmitResult).toContain("Feedback: Looks good")

      // #when - reject flow
      const rejectSubmitPromise = workerTool.execute(
        { command: "plan submit 1) Unsafe migration without rollback" },
        toolContext
      )
      let rejectRequestId: string | null = null
      await waitFor(async () => {
        const listResult = await coordinatorTool.execute({ command: "plan list" }, toolContext)
        expect(listResult).toContain("Pending plan approvals:")
        rejectRequestId = parseFirstPlanRequestId(listResult)
        expect(rejectRequestId).not.toBeNull()
      }, {
        timeoutMs: 4_000,
        intervalMs: 50,
        description: "reject requestId appears in plan list",
      })
      if (!rejectRequestId) {
        expect.unreachable("missing plan requestId for reject flow")
      }

      const rejectResult = await coordinatorTool.execute(
        { command: `plan reject ${rejectRequestId} Missing rollback plan` },
        toolContext
      )
      expect(rejectResult).toContain(`Rejected plan ${rejectRequestId}`)

      // #then
      const rejectSubmitResult = await rejectSubmitPromise
      expect(rejectSubmitResult).toContain("Plan approval decision: rejected")
      expect(rejectSubmitResult).toContain("Feedback: Missing rollback plan")
      await waitFor(() => {
        return coordinatorTool.execute({ command: "plan list" }, toolContext).then((listResult) => {
          expect(listResult).toContain("No pending plan approvals.")
        })
      }, {
        timeoutMs: 2_000,
        intervalMs: 50,
        description: "pending approvals cleared after reject",
      })

      await waitFor(() => {
        expect(worker!.isWorking()).toBe(true)
      }, {
        timeoutMs: 2_000,
        intervalMs: 25,
        description: "worker resumes after approval decision",
      })
    } finally {
      await worker?.stop({ force: true })
      await coordinator?.stop({ deleteTeam: true })
    }
  })

  test("plan submit times out when coordinator does not respond and worker resumes", async () => {
    // #given
    const harness = createHarness()
    createdWorkspaces.push(harness.workspace)
    const teamName = `swarm-tool-timeout-${Date.now()}-${Math.random().toString(16).slice(2)}`

    const coordinatorSessionId = `sess-tool-coordinator-timeout-${Math.random().toString(16).slice(2)}`
    const workerSessionId = `sess-tool-worker-timeout-${Math.random().toString(16).slice(2)}`

    const coordinator = await createCoordinator(
      {
        teamName,
        name: "coordinator",
        sessionId: coordinatorSessionId,
        autoApprove: true,
        loopIntervalMs: 120,
      },
      harness.config
    )
    expect(coordinator).not.toBeNull()

    const worker = await createWorker(
      {
        teamName,
        name: "worker-1",
        sessionId: workerSessionId,
        onTaskAssigned: async () => true,
      },
      harness.config
    )
    expect(worker).not.toBeNull()

    harness.runtime.bindSessionToTeam(coordinatorSessionId, harness.workspace, teamName)
    harness.runtime.bindSessionToTeam(workerSessionId, harness.workspace, teamName)
    harness.runtime.registerCoordinator(coordinatorSessionId, coordinator!)
    harness.runtime.registerWorker(workerSessionId, worker!)

    const workerTool = createSwarmTool({
      directory: harness.workspace,
      config: harness.config,
      runtime: harness.runtime,
      getSessionId: () => workerSessionId,
    })
    const toolContext = {} as unknown as Parameters<typeof workerTool.execute>[1]

    try {
      assignTaskToWorker(
        teamName,
        coordinator!.getIdentity().id,
        worker!.getIdentity().id,
        "task-plan-timeout-tool",
        harness.config
      )
      await waitFor(() => {
        expect(worker!.isWorking()).toBe(true)
      }, {
        timeoutMs: 4_000,
        intervalMs: 25,
        description: "worker enters working state",
      })

      // #when
      const result = await workerTool.execute(
        { command: "plan submit 1) Long-running plan that requires review --timeoutMs=200" },
        toolContext
      )

      // #then
      expect(result).toContain("Plan approval decision: rejected")
      expect(result).toContain("timed out")

      await waitFor(() => {
        expect(worker!.isWorking()).toBe(true)
      }, {
        timeoutMs: 2_000,
        intervalMs: 25,
        description: "worker resumes after timeout",
      })
    } finally {
      await worker?.stop({ force: true })
      await coordinator?.stop({ deleteTeam: true })
    }
  })

  test("plan submit strips tool flags from plan text before sending approval request", async () => {
    // #given
    const harness = createHarness()
    createdWorkspaces.push(harness.workspace)
    const teamName = `swarm-tool-submit-flags-${Date.now()}-${Math.random().toString(16).slice(2)}`

    const coordinatorSessionId = `sess-tool-coordinator-flags-${Math.random().toString(16).slice(2)}`
    const workerSessionId = `sess-tool-worker-flags-${Math.random().toString(16).slice(2)}`

    const coordinator = await createCoordinator(
      {
        teamName,
        name: "coordinator",
        sessionId: coordinatorSessionId,
        autoApprove: true,
        loopIntervalMs: 120,
      },
      harness.config
    )
    expect(coordinator).not.toBeNull()

    const worker = await createWorker(
      {
        teamName,
        name: "worker-1",
        sessionId: workerSessionId,
        onTaskAssigned: async () => true,
      },
      harness.config
    )
    expect(worker).not.toBeNull()

    harness.runtime.bindSessionToTeam(coordinatorSessionId, harness.workspace, teamName)
    harness.runtime.bindSessionToTeam(workerSessionId, harness.workspace, teamName)
    harness.runtime.registerCoordinator(coordinatorSessionId, coordinator!)
    harness.runtime.registerWorker(workerSessionId, worker!)

    const coordinatorTool = createSwarmTool({
      directory: harness.workspace,
      config: harness.config,
      runtime: harness.runtime,
      getSessionId: () => coordinatorSessionId,
    })
    const workerTool = createSwarmTool({
      directory: harness.workspace,
      config: harness.config,
      runtime: harness.runtime,
      getSessionId: () => workerSessionId,
    })
    const toolContext = {} as unknown as Parameters<typeof coordinatorTool.execute>[1]

    try {
      assignTaskToWorker(
        teamName,
        coordinator!.getIdentity().id,
        worker!.getIdentity().id,
        "task-plan-submit-flags",
        harness.config
      )
      await waitFor(() => {
        expect(worker!.isWorking()).toBe(true)
      }, {
        timeoutMs: 4_000,
        intervalMs: 25,
        description: "worker enters working state",
      })

      // #when
      const submitPromise = workerTool.execute(
        {
          command:
            "plan submit 1) Verify flags stripped --timeoutMs=60000 --planFile=.orchestrator/plans/demo/plan.md",
        },
        toolContext
      )

      let requestId = ""
      await waitFor(() => {
        const pending = coordinator!.getPendingPlanApprovals()
        expect(pending.length).toBe(1)
        const request = pending[0]!
        expect(request.plan).toContain("1) Verify flags stripped")
        expect(request.plan).not.toContain("--timeoutMs")
        expect(request.plan).not.toContain("--planFile")
        requestId = request.requestId
      }, {
        timeoutMs: 4_000,
        intervalMs: 25,
        description: "coordinator receives sanitized plan approval request",
      })

      await coordinatorTool.execute({ command: `plan reject ${requestId} ok` }, toolContext)

      // #then
      const submitResult = await submitPromise
      expect(submitResult).toContain("Plan approval decision: rejected")
      expect(submitResult).toContain("Feedback: ok")
    } finally {
      await worker?.stop({ force: true })
      await coordinator?.stop({ deleteTeam: true })
    }
  })

  test("overlapping plan submit is rejected while an approval request is pending", async () => {
    // #given
    const harness = createHarness()
    createdWorkspaces.push(harness.workspace)
    const teamName = `swarm-tool-overlap-${Date.now()}-${Math.random().toString(16).slice(2)}`

    const coordinatorSessionId = `sess-tool-coordinator-overlap-${Math.random().toString(16).slice(2)}`
    const workerSessionId = `sess-tool-worker-overlap-${Math.random().toString(16).slice(2)}`

    const coordinator = await createCoordinator(
      {
        teamName,
        name: "coordinator",
        sessionId: coordinatorSessionId,
        autoApprove: true,
        loopIntervalMs: 120,
      },
      harness.config
    )
    expect(coordinator).not.toBeNull()

    const worker = await createWorker(
      {
        teamName,
        name: "worker-1",
        sessionId: workerSessionId,
        onTaskAssigned: async () => true,
      },
      harness.config
    )
    expect(worker).not.toBeNull()

    harness.runtime.bindSessionToTeam(coordinatorSessionId, harness.workspace, teamName)
    harness.runtime.bindSessionToTeam(workerSessionId, harness.workspace, teamName)
    harness.runtime.registerCoordinator(coordinatorSessionId, coordinator!)
    harness.runtime.registerWorker(workerSessionId, worker!)

    const workerTool = createSwarmTool({
      directory: harness.workspace,
      config: harness.config,
      runtime: harness.runtime,
      getSessionId: () => workerSessionId,
    })
    const toolContext = {} as unknown as Parameters<typeof workerTool.execute>[1]

    try {
      assignTaskToWorker(
        teamName,
        coordinator!.getIdentity().id,
        worker!.getIdentity().id,
        "task-plan-overlap-tool",
        harness.config
      )
      await waitFor(() => {
        expect(worker!.isWorking()).toBe(true)
      }, {
        timeoutMs: 4_000,
        intervalMs: 25,
        description: "worker enters working state",
      })

      // #when
      const first = workerTool.execute(
        { command: "plan submit 1) First plan --timeoutMs=250" },
        toolContext
      )
      const second = await workerTool.execute(
        { command: "plan submit 1) Second plan should be rejected" },
        toolContext
      )

      // #then
      expect(second).toContain("Plan approval decision: rejected")
      expect(
        second.includes("Worker not in working state")
          || second.includes("Plan approval request already pending")
      ).toBe(true)

      const firstResult = await first
      expect(firstResult).toContain("Plan approval decision: rejected")
      expect(firstResult).toContain("timed out")

      await waitFor(() => {
        expect(worker!.isWorking()).toBe(true)
      }, {
        timeoutMs: 2_000,
        intervalMs: 25,
        description: "worker resumes after overlapping requests",
      })
    } finally {
      await worker?.stop({ force: true })
      await coordinator?.stop({ deleteTeam: true })
    }
  })

  test("plan submit is rejected when worker has no current task and does not create pending approvals", async () => {
    // #given
    const harness = createHarness()
    createdWorkspaces.push(harness.workspace)
    const teamName = `swarm-tool-not-working-${Date.now()}-${Math.random().toString(16).slice(2)}`

    const coordinatorSessionId = `sess-tool-coordinator-not-working-${Math.random().toString(16).slice(2)}`
    const workerSessionId = `sess-tool-worker-not-working-${Math.random().toString(16).slice(2)}`

    const coordinator = await createCoordinator(
      {
        teamName,
        name: "coordinator",
        sessionId: coordinatorSessionId,
        autoApprove: true,
        loopIntervalMs: 120,
      },
      harness.config
    )
    expect(coordinator).not.toBeNull()

    const worker = await createWorker(
      {
        teamName,
        name: "worker-1",
        sessionId: workerSessionId,
        onTaskAssigned: async () => true,
      },
      harness.config
    )
    expect(worker).not.toBeNull()

    harness.runtime.bindSessionToTeam(coordinatorSessionId, harness.workspace, teamName)
    harness.runtime.bindSessionToTeam(workerSessionId, harness.workspace, teamName)
    harness.runtime.registerCoordinator(coordinatorSessionId, coordinator!)
    harness.runtime.registerWorker(workerSessionId, worker!)

    const coordinatorTool = createSwarmTool({
      directory: harness.workspace,
      config: harness.config,
      runtime: harness.runtime,
      getSessionId: () => coordinatorSessionId,
    })
    const workerTool = createSwarmTool({
      directory: harness.workspace,
      config: harness.config,
      runtime: harness.runtime,
      getSessionId: () => workerSessionId,
    })
    const toolContext = {} as unknown as Parameters<typeof workerTool.execute>[1]

    try {
      // #when
      const result = await workerTool.execute({ command: "plan submit 1) Plan without assignment" }, toolContext)

      // #then
      expect(result).toContain("Plan approval decision: rejected")
      expect(result).toContain("Worker not in working state")

      const listResult = await coordinatorTool.execute({ command: "plan list" }, toolContext)
      expect(listResult).toContain("No pending plan approvals.")
    } finally {
      await worker?.stop({ force: true })
      await coordinator?.stop({ deleteTeam: true })
    }
  })

  test("plan management returns not found for unknown requestId", async () => {
    // #given
    const harness = createHarness()
    createdWorkspaces.push(harness.workspace)
    const teamName = `swarm-tool-unknown-request-${Date.now()}-${Math.random().toString(16).slice(2)}`

    const coordinatorSessionId = `sess-tool-coordinator-unknown-${Math.random().toString(16).slice(2)}`

    const coordinator = await createCoordinator(
      {
        teamName,
        name: "coordinator",
        sessionId: coordinatorSessionId,
        autoApprove: true,
        loopIntervalMs: 120,
      },
      harness.config
    )
    expect(coordinator).not.toBeNull()

    harness.runtime.bindSessionToTeam(coordinatorSessionId, harness.workspace, teamName)
    harness.runtime.registerCoordinator(coordinatorSessionId, coordinator!)

    const coordinatorTool = createSwarmTool({
      directory: harness.workspace,
      config: harness.config,
      runtime: harness.runtime,
      getSessionId: () => coordinatorSessionId,
    })
    const toolContext = {} as unknown as Parameters<typeof coordinatorTool.execute>[1]

    try {
      // #when / #then
      const approve = await coordinatorTool.execute({ command: "plan approve req_missing" }, toolContext)
      expect(approve).toContain("Plan request not found: req_missing")

      const reject = await coordinatorTool.execute({ command: "plan reject req_missing" }, toolContext)
      expect(reject).toContain("Plan request not found: req_missing")

      const revise = await coordinatorTool.execute({ command: "plan revise req_missing feedback" }, toolContext)
      expect(revise).toContain("Plan request not found: req_missing")
    } finally {
      await coordinator?.stop({ deleteTeam: true })
    }
  })
})
