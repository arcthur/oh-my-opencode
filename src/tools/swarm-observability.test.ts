import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import { existsSync, mkdirSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { createAgentIdentity, createTeam } from "../features/orchestrator-swarm/team"
import { createSwarmRuntimeService } from "../features/orchestrator-swarm/runtime"

const mockLog = mock(() => {})
const mockInspectSwarmWindowsByTeam = mock(() => ({
  scanned: 3,
  matched: 2,
  matchedByOption: 1,
  windowIndexes: ["1", "2"],
}))
const mockCloseSwarmWindowsByTeam = mock(() => ({
  attempted: 2,
  closed: 1,
  matchedByOption: 1,
}))
const mockGetCurrentSession = mock(() => "main")

mock.module("../shared/logger", () => ({
  log: mockLog,
}))

mock.module("../features/orchestrator-swarm/tmux", () => ({
  createSwarmOrchestrator: mock(() => null),
  closeSwarmWindowsByTeam: mockCloseSwarmWindowsByTeam,
  inspectSwarmWindowsByTeam: mockInspectSwarmWindowsByTeam,
  getCurrentSession: mockGetCurrentSession,
  SwarmOrchestrator: class {
    static isAvailable() {
      return false
    }
  },
}))

describe("swarm tool observability telemetry", () => {
  let projectDir: string
  let teamsDir: string

  beforeEach(() => {
    mockLog.mockReset()
    mockInspectSwarmWindowsByTeam.mockReset()
    mockCloseSwarmWindowsByTeam.mockReset()
    mockGetCurrentSession.mockReset()

    mockInspectSwarmWindowsByTeam.mockReturnValue({
      scanned: 3,
      matched: 2,
      matchedByOption: 1,
      windowIndexes: ["1", "2"],
    })
    mockCloseSwarmWindowsByTeam.mockReturnValue({
      attempted: 2,
      closed: 1,
      matchedByOption: 1,
    })
    mockGetCurrentSession.mockReturnValue("main")

    projectDir = join(tmpdir(), `swarm-observability-${Date.now()}`)
    teamsDir = join(projectDir, ".orchestrator", "teams")
    mkdirSync(teamsDir, { recursive: true })
  })

  afterEach(() => {
    if (existsSync(projectDir)) {
      rmSync(projectDir, { recursive: true })
    }
  })

  test("status emits drift telemetry with teamKey when runtime and tmux drift", async () => {
    // #given
    const { createSwarmTool } = await import("./swarm")
    const runtime = createSwarmRuntimeService()
    const coordinator = createAgentIdentity({
      name: "coordinator",
      role: "coordinator",
      sessionId: "sess-main",
    })
    createTeam("team-a", coordinator, {
      orchestrator: {
        swarm: {
          enabled: true,
          storage_path: teamsDir,
        },
      },
    })
    runtime.bindSessionToTeam("sess-main", projectDir, "team-a")

    const tool = createSwarmTool({
      directory: projectDir,
      config: {
        orchestrator: {
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
    await tool.execute({ command: "status team-a" }, toolContext)

    // #then
    const driftCall = mockLog.mock.calls.find((call) => call[0] === "[swarm.observability] drift-detected")
    expect(driftCall).toBeDefined()
    expect(driftCall?.[1]).toMatchObject({
      teamKey: `${projectDir}::team-a`,
      tmuxSession: "main",
      tmuxMatched: 2,
      runtimeOrchestratorPresent: false,
    })
  })

  test("stop emits recovery telemetry with teamKey and close ratio", async () => {
    // #given
    const { createSwarmTool } = await import("./swarm")
    const runtime = createSwarmRuntimeService()
    runtime.bindSessionToTeam("sess-main", projectDir, "team-a")

    const tool = createSwarmTool({
      directory: projectDir,
      config: {},
      getSessionId: () => "sess-main",
      runtime,
    })
    const toolContext = {} as unknown as Parameters<typeof tool.execute>[1]

    // #when
    await tool.execute({ command: "stop" }, toolContext)

    // #then
    const recoveryCall = mockLog.mock.calls.find((call) => call[0] === "[swarm.observability] stop-recovery")
    expect(recoveryCall).toBeDefined()
    expect(recoveryCall?.[1]).toMatchObject({
      teamKey: `${projectDir}::team-a`,
      hasRuntimeOrchestrator: false,
      tmuxRecoveryAttempted: 2,
      tmuxRecoveryClosed: 1,
    })
  })
})
