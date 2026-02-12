import { describe, expect, test, mock, beforeEach } from "bun:test"
import { createSwarmRuntimeService } from "../features/sisyphus-swarm/runtime"

const mockCloseSwarmWindowsByTeam = mock(() => ({
  attempted: 2,
  closed: 2,
  matchedByOption: 2,
}))
const mockInspectSwarmWindowsByTeam = mock(() => ({
  scanned: 2,
  matched: 2,
  matchedByOption: 2,
  windowIndexes: ["1", "2"],
}))
const mockGetCurrentSession = mock(() => "main")

mock.module("../features/sisyphus-swarm/tmux", () => ({
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

describe("swarm tool stop recovery", () => {
  beforeEach(() => {
    mockCloseSwarmWindowsByTeam.mockReset()
    mockInspectSwarmWindowsByTeam.mockReset()
    mockGetCurrentSession.mockReset()
    mockCloseSwarmWindowsByTeam.mockReturnValue({
      attempted: 2,
      closed: 2,
      matchedByOption: 2,
    })
    mockInspectSwarmWindowsByTeam.mockReturnValue({
      scanned: 2,
      matched: 2,
      matchedByOption: 2,
      windowIndexes: ["1", "2"],
    })
    mockGetCurrentSession.mockReturnValue("main")
  })

  test("stop attempts tmux recovery cleanup when orchestrator handle is missing", async () => {
    // #given
    const { createSwarmTool } = await import("./swarm")
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
    expect(mockCloseSwarmWindowsByTeam).toHaveBeenCalledWith("main", "team-a")
    expect(result).toContain("Recovered tmux windows: 2/2")
  })
})
