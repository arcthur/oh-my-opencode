import { describe, expect, test, mock } from "bun:test"
import { closeSwarmWindowsByTeam, inspectSwarmWindowsByTeam } from "./utils"

describe("tmux swarm recovery helpers", () => {
  test("closeSwarmWindowsByTeam matches only by @swarm_team option", async () => {
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
      closeTmuxWindow,
    })

    // #then
    expect(result.attempted).toBe(1)
    expect(result.closed).toBe(1)
    expect(result.matchedByOption).toBe(1)
    expect(closeTmuxWindow).toHaveBeenCalledTimes(1)
    expect(closeTmuxWindow).toHaveBeenCalledWith("main", "1")
  })

  test("closeSwarmWindowsByTeam ignores windows without @swarm_team option", async () => {
    // #given
    const closeTmuxWindow = mock(() => true)

    // #when
    const result = closeSwarmWindowsByTeam("main", "team-a", {
      listTmuxWindows: () => [
        { index: "1", name: "... swarm-worker-a" },
        { index: "2", name: "... swarm-worker-b" },
      ],
      getTmuxWindowOption: () => null,
      closeTmuxWindow,
    })

    // #then
    expect(result.attempted).toBe(0)
    expect(result.closed).toBe(0)
    expect(result.matchedByOption).toBe(0)
    expect(closeTmuxWindow).toHaveBeenCalledTimes(0)
  })

  test("inspectSwarmWindowsByTeam reports option-based diagnostics", async () => {
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
    })

    // #then
    expect(inspection.scanned).toBe(3)
    expect(inspection.matched).toBe(1)
    expect(inspection.matchedByOption).toBe(1)
    expect(inspection.windowIndexes).toEqual(["1"])
  })
})
