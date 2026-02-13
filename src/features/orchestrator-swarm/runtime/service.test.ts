import { describe, expect, mock, test } from "bun:test"
import type { SwarmOrchestrator } from "../tmux"
import type { CoordinatorAgent, WorkerAgent } from "../agent"
import { createSwarmRuntimeService } from "./service"

describe("SwarmRuntimeService", () => {
  test("isolates orchestrators by teamKey and stopTeam only affects the target team", () => {
    // #given
    const runtime = createSwarmRuntimeService()
    const cleanupA = mock(() => {})
    const cleanupB = mock(() => {})

    runtime.bindSessionToTeam("sess-a", "/repo", "team-a")
    runtime.bindSessionToTeam("sess-b", "/repo", "team-b")
    runtime.bindSessionToTeam("sess-c", "/repo", "team-a")

    runtime.setOrchestrator(
      "/repo",
      "team-a",
      { cleanup: cleanupA } as unknown as SwarmOrchestrator
    )
    runtime.setOrchestrator(
      "/repo",
      "team-b",
      { cleanup: cleanupB } as unknown as SwarmOrchestrator
    )

    // #when
    const stopped = runtime.stopTeam("/repo", "team-a", true)

    // #then
    expect(stopped).toBe(true)
    expect(cleanupA).toHaveBeenCalledWith(true)
    expect(cleanupB).not.toHaveBeenCalled()

    expect(runtime.getSessionTeam("sess-a")?.teamName).toBeUndefined()
    expect(runtime.getSessionTeam("sess-c")?.teamName).toBeUndefined()
    expect(runtime.getSessionTeam("sess-b")?.teamName).toBe("team-b")

    expect(runtime.getOrchestrator("/repo", "team-a")).toBeUndefined()
    expect(runtime.getOrchestrator("/repo", "team-b")).toBeDefined()
  })

  test("bindSessionToTeam overwrites previous team binding for the same session", () => {
    // #given
    const runtime = createSwarmRuntimeService()
    runtime.bindSessionToTeam("sess-main", "/repo", "team-a")

    // #when
    runtime.bindSessionToTeam("sess-main", "/repo", "team-b")

    // #then
    const binding = runtime.getSessionTeam("sess-main")
    expect(binding?.teamName).toBe("team-b")
    expect(binding?.teamKey).toBe("/repo::team-b")
  })

  test("registers and unregisters worker/coordinator handles by session", () => {
    // #given
    const runtime = createSwarmRuntimeService()
    const worker = { requestPlanApproval: mock(async () => ({ decision: "approved" })) } as unknown as WorkerAgent
    const coordinator = {
      getPendingPlanApprovals: mock(() => []),
      approvePlan: mock(() => true),
      rejectPlan: mock(() => true),
      requestPlanRevision: mock(() => true),
    } as unknown as CoordinatorAgent

    // #when
    runtime.registerWorker("sess-worker", worker)
    runtime.registerCoordinator("sess-coord", coordinator)

    // #then
    expect(runtime.getWorker("sess-worker")).toBe(worker)
    expect(runtime.getCoordinator("sess-coord")).toBe(coordinator)

    runtime.unregisterWorker("sess-worker")
    runtime.unregisterCoordinator("sess-coord")

    expect(runtime.getWorker("sess-worker")).toBeUndefined()
    expect(runtime.getCoordinator("sess-coord")).toBeUndefined()
  })
})
