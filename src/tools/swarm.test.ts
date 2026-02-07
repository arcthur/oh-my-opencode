import { describe, expect, mock, test } from "bun:test"
import type { CoordinatorAgent, WorkerAgent } from "../features/sisyphus-swarm/agent"
import { createSwarmRuntimeService } from "../features/sisyphus-swarm/runtime"
import type { SwarmOrchestrator } from "../features/sisyphus-swarm/tmux"
import { createSwarmTool } from "./swarm"

describe("swarm tool runtime integration", () => {
  test("routes plan submit to worker bound to current session", async () => {
    // #given
    const runtime = createSwarmRuntimeService()
    const requestPlanApproval = mock(async () => ({ decision: "approved" as const, feedback: "ok" }))

    runtime.registerWorker(
      "sess-worker",
      { requestPlanApproval } as unknown as WorkerAgent
    )

    const tool = createSwarmTool({
      directory: "/repo",
      config: {},
      getSessionId: () => "sess-worker",
      runtime,
    })
    const toolContext = {} as unknown as Parameters<typeof tool.execute>[1]

    // #when
    const result = await tool.execute({ command: "plan submit Ship it" }, toolContext)

    // #then
    expect(result).toContain("Plan approval decision: approved")
    expect(result).toContain("Feedback: ok")
    expect(requestPlanApproval).toHaveBeenCalledTimes(1)
  })

  test("routes plan list to coordinator bound to current session", async () => {
    // #given
    const runtime = createSwarmRuntimeService()
    const getPendingPlanApprovals = mock(() => [
      {
        requestId: "req_1",
        from: "worker-1",
        taskId: "task_1",
        requestedAt: Date.now() - 3000,
      },
    ])

    runtime.registerCoordinator(
      "sess-coord",
      {
        getPendingPlanApprovals,
        approvePlan: mock(() => true),
        rejectPlan: mock(() => true),
        requestPlanRevision: mock(() => true),
      } as unknown as CoordinatorAgent
    )

    const tool = createSwarmTool({
      directory: "/repo",
      config: {},
      getSessionId: () => "sess-coord",
      runtime,
    })
    const toolContext = {} as unknown as Parameters<typeof tool.execute>[1]

    // #when
    const result = await tool.execute({ command: "plan list" }, toolContext)

    // #then
    expect(result).toContain("Pending plan approvals")
    expect(result).toContain("req_1")
    expect(getPendingPlanApprovals).toHaveBeenCalledTimes(1)
  })

  test("stop uses session-team binding from runtime service", async () => {
    // #given
    const runtime = createSwarmRuntimeService()
    runtime.bindSessionToTeam("sess-main", "/repo", "team-a")
    runtime.setOrchestrator(
      "/repo",
      "team-a",
      { cleanup: mock(() => {}) } as unknown as SwarmOrchestrator
    )

    const tool = createSwarmTool({
      directory: "/repo",
      config: {},
      getSessionId: () => "sess-main",
      runtime,
    })
    const toolContext = {} as unknown as Parameters<typeof tool.execute>[1]

    // #when
    const result = await tool.execute({ command: "stop" }, toolContext)

    // #then
    expect(result).toContain('Stopped all workers for team "team-a"')
    expect(runtime.getSessionTeam("sess-main")).toBeUndefined()
  })

  test("stop does not dead-end when team is bound but orchestrator handle is missing", async () => {
    // #given
    const runtime = createSwarmRuntimeService()
    runtime.bindSessionToTeam("sess-main", "/repo", "team-a")

    const tool = createSwarmTool({
      directory: "/repo",
      config: {},
      getSessionId: () => "sess-main",
      runtime,
    })
    const toolContext = {} as unknown as Parameters<typeof tool.execute>[1]

    // #when
    const result = await tool.execute({ command: "stop" }, toolContext)

    // #then
    expect(result).toContain('Stopped all workers for team "team-a"')
    expect(result).toContain("No in-memory orchestrator handle was found")
    expect(runtime.getSessionTeam("sess-main")).toBeUndefined()
  })
})
