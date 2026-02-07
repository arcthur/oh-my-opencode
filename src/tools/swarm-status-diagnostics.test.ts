import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import { existsSync, mkdirSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import type { CoordinatorAgent } from "../features/sisyphus-swarm/agent"
import { createAgentIdentity, createTeam } from "../features/sisyphus-swarm/team"
import { createSwarmRuntimeService } from "../features/sisyphus-swarm/runtime"

const mockInspectSwarmWindowsByTeam = mock(() => ({
  scanned: 3,
  matched: 2,
  matchedByOption: 1,
  matchedByPane: 1,
  windowIndexes: ["1", "2"],
}))
const mockGetCurrentSession = mock(() => "main")

mock.module("../features/sisyphus-swarm/tmux", () => ({
  createSwarmOrchestrator: mock(() => null),
  closeSwarmWindowsByTeam: mock(() => ({
    attempted: 0,
    closed: 0,
    matchedByOption: 0,
    matchedByPane: 0,
  })),
  inspectSwarmWindowsByTeam: mockInspectSwarmWindowsByTeam,
  getCurrentSession: mockGetCurrentSession,
  SwarmOrchestrator: class {
    static isAvailable() {
      return false
    }
  },
}))

describe("swarm tool status diagnostics", () => {
  let projectDir: string
  let teamsDir: string

  beforeEach(() => {
    projectDir = join(tmpdir(), `swarm-status-diag-${Date.now()}`)
    teamsDir = join(projectDir, ".sisyphus", "teams")
    mkdirSync(teamsDir, { recursive: true })

    mockInspectSwarmWindowsByTeam.mockReset()
    mockInspectSwarmWindowsByTeam.mockReturnValue({
      scanned: 3,
      matched: 2,
      matchedByOption: 1,
      matchedByPane: 1,
      windowIndexes: ["1", "2"],
    })
    mockGetCurrentSession.mockReset()
    mockGetCurrentSession.mockReturnValue("main")
  })

  afterEach(() => {
    if (existsSync(projectDir)) {
      rmSync(projectDir, { recursive: true })
    }
  })

  test("status includes diagnostics and drift hint when runtime handle is missing", async () => {
    // #given
    const { createSwarmTool } = await import("./swarm")
    const runtime = createSwarmRuntimeService()

    const coordinator = createAgentIdentity({
      name: "coordinator",
      role: "coordinator",
      sessionId: "sess-main",
    })
    createTeam("team-a", coordinator, {
      sisyphus: {
        swarm: {
          enabled: true,
          storage_path: teamsDir,
        },
      },
    })

    runtime.bindSessionToTeam("sess-main", projectDir, "team-a")
    runtime.registerCoordinator(
      "sess-main",
      {
        getPendingPlanApprovals: mock(() => []),
        approvePlan: mock(() => true),
        rejectPlan: mock(() => true),
        requestPlanRevision: mock(() => true),
      } as unknown as CoordinatorAgent
    )

    const tool = createSwarmTool({
      directory: projectDir,
      config: {
        sisyphus: {
          swarm: {
            enabled: true,
            storage_path: teamsDir,
          },
        },
        parallel_runtime: { enabled: false },
      },
      getSessionId: () => "sess-main",
      runtime,
    })
    const toolContext = {} as unknown as Parameters<typeof tool.execute>[1]

    // #when
    const result = await tool.execute({ command: "status team-a" }, toolContext)

    // #then
    expect(mockInspectSwarmWindowsByTeam).toHaveBeenCalledWith("main", "team-a")
    expect(result).toContain("Swarm Diagnostics:")
    expect(result).toContain("Runtime orchestrator: missing")
    expect(result).toContain("Tmux windows for team: 2 (option=1, pane=1)")
    expect(result).toContain("Drift detected:")
  })
})
