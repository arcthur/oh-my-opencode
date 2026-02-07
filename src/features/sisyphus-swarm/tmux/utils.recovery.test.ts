import { describe, expect, test, mock } from "bun:test"
import { closeSwarmWindowsByTeam, inspectSwarmWindowsByTeam } from "./utils"

describe("tmux swarm recovery helpers", () => {
  test("closeSwarmWindowsByTeam prefers @swarm_team option matching", async () => {
    // #given
    const closeTmuxWindow = mock(() => true)

    // #when
    const result = closeSwarmWindowsByTeam("main", "team-a", {
      listTmuxWindows: () => [
        { index: "1", name: "swarm-worker-a" },
        { index: "2", name: "editor" },
        { index: "3", name: "swarm-worker-b" },
      ],
      getTmuxWindowOption: (target) => {
        if (target === "main:1") return "team-a"
        if (target === "main:3") return "team-b"
        return null
      },
      capturePaneContent: () => null,
      closeTmuxWindow,
    })

    // #then
    expect(result.attempted).toBe(1)
    expect(result.closed).toBe(1)
    expect(result.matchedByOption).toBe(1)
    expect(result.matchedByPane).toBe(0)
    expect(closeTmuxWindow).toHaveBeenCalledTimes(1)
    expect(closeTmuxWindow).toHaveBeenCalledWith("main", "1")
  })

  test("closeSwarmWindowsByTeam falls back to pane content matching", async () => {
    // #given
    const closeTmuxWindow = mock(() => true)

    // #when
    const result = closeSwarmWindowsByTeam("main", "team-a", {
      listTmuxWindows: () => [
        { index: "1", name: "... swarm-worker-a" },
        { index: "2", name: "... swarm-worker-b" },
      ],
      getTmuxWindowOption: () => null,
      capturePaneContent: (target) => {
        if (target === "main:1.0") {
          return 'OPENCODE_SWARM_TEAM="team-a" OPENCODE_SWARM_ROLE="worker" opencode\n'
        }
        if (target === "main:2.0") {
          return 'OPENCODE_SWARM_TEAM="team-b" OPENCODE_SWARM_ROLE="worker" opencode\n'
        }
        return null
      },
      closeTmuxWindow,
    })

    // #then
    expect(result.attempted).toBe(1)
    expect(result.closed).toBe(1)
    expect(result.matchedByOption).toBe(0)
    expect(result.matchedByPane).toBe(1)
    expect(closeTmuxWindow).toHaveBeenCalledTimes(1)
    expect(closeTmuxWindow).toHaveBeenCalledWith("main", "1")
  })

  test("inspectSwarmWindowsByTeam reports non-destructive diagnostics", async () => {
    // #given

    // #when
    const inspection = inspectSwarmWindowsByTeam("main", "team-a", {
      listTmuxWindows: () => [
        { index: "1", name: "... swarm-worker-a" },
        { index: "2", name: "... swarm-worker-b" },
        { index: "3", name: "editor" },
      ],
      getTmuxWindowOption: (target) => {
        if (target === "main:1") return "team-a"
        return null
      },
      capturePaneContent: (target) => {
        if (target === "main:2.0") {
          return 'OPENCODE_SWARM_TEAM="team-a" OPENCODE_SWARM_ROLE="worker" opencode\n'
        }
        return null
      },
    })

    // #then
    expect(inspection.scanned).toBe(3)
    expect(inspection.matched).toBe(2)
    expect(inspection.matchedByOption).toBe(1)
    expect(inspection.matchedByPane).toBe(1)
    expect(inspection.windowIndexes).toEqual(["1", "2"])
  })
})
