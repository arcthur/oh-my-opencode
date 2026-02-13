import { beforeEach, describe, expect, test } from "bun:test"
import { SessionStateCoordinator } from "./coordinator"

describe("SessionStateCoordinator", () => {
  let coordinator: SessionStateCoordinator

  beforeEach(() => {
    coordinator = new SessionStateCoordinator()
  })

  test("classifies main/background/subagent and computes root session", () => {
    // #given
    coordinator.onSessionCreated("main")
    coordinator.onSessionCreated("background", "main")
    coordinator.onSessionCreated("subagent", "background")

    // #when
    const main = coordinator.getSessionInfo("main")
    const background = coordinator.getSessionInfo("background")
    const subagent = coordinator.getSessionInfo("subagent")

    // #then
    expect(main?.type).toBe("main")
    expect(main?.isSubagent).toBe(false)
    expect(main?.rootSessionID).toBe("main")

    expect(background?.type).toBe("background")
    expect(background?.isSubagent).toBe(true)
    expect(background?.rootSessionID).toBe("main")

    expect(subagent?.type).toBe("subagent")
    expect(subagent?.isSubagent).toBe(true)
    expect(subagent?.rootSessionID).toBe("main")
  })

  test("supports explicit subagent marks with idempotent updates", () => {
    // #given
    coordinator.markSubagentSession("bg-1", "main")
    coordinator.markSubagentSession("bg-1", "main")

    // #when
    expect(coordinator.isSubagentSession("bg-1")).toBe(true)

    coordinator.onSessionCreated("main")
    coordinator.onSessionCreated("bg-1", "main")

    coordinator.unmarkSubagentSession("bg-1")
    coordinator.unmarkSubagentSession("bg-1")

    // #then
    expect(coordinator.isSubagentSession("bg-1")).toBe(false)
  })

  test("tracks main session and clears it on delete", () => {
    // #given
    coordinator.onSessionCreated("main")
    coordinator.setMainSessionID("main")
    expect(coordinator.getMainSessionID()).toBe("main")

    // #when
    coordinator.onSessionDeleted("main")

    // #then
    expect(coordinator.getMainSessionID()).toBeUndefined()
  })

  test("tracks session agent with first-write and explicit update semantics", () => {
    // #given
    coordinator.onSessionCreated("session-1")

    // #when
    coordinator.setSessionAgent("session-1", "planner")
    coordinator.setSessionAgent("session-1", "orchestrator")

    // #then
    expect(coordinator.getSessionAgent("session-1")).toBe("planner")

    // #when
    coordinator.updateSessionAgent("session-1", "orchestrator")

    // #then
    expect(coordinator.getSessionAgent("session-1")).toBe("orchestrator")

    // #when
    coordinator.clearSessionAgent("session-1")

    // #then
    expect(coordinator.getSessionAgent("session-1")).toBeUndefined()
  })

  test("dispatches delete lifecycle to handlers and tolerates unknown sessions", () => {
    // #given
    const deletedSessions: string[] = []
    coordinator.registerFeature("probe", {
      onSessionDeleted(sessionID) {
        deletedSessions.push(sessionID)
      },
    })

    // #when
    coordinator.onSessionDeleted("missing-session")

    // #then
    expect(deletedSessions).toEqual(["missing-session"])
  })
})
