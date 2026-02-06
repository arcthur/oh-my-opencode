import { beforeEach, describe, expect, test } from "bun:test"
import { sessionStateCoordinator } from "../session-state-coordinator"
import {
  _resetForTesting,
  clearSessionAgent,
  getMainSessionID,
  getSessionAgent,
  isSubagentSession,
  markSubagentSession,
  setMainSession,
  setSessionAgent,
  unmarkSubagentSession,
  updateSessionAgent,
} from "./state"

describe("claude-code-session-state compatibility wrappers", () => {
  beforeEach(() => {
    _resetForTesting()
  })

  test("delegates main session APIs to coordinator", () => {
    // #given

    // #when
    setMainSession("main-session")

    // #then
    expect(getMainSessionID()).toBe("main-session")
    expect(sessionStateCoordinator.getMainSessionID()).toBe("main-session")
  })

  test("delegates agent APIs to coordinator", () => {
    // #given

    // #when
    setSessionAgent("session-1", "prometheus")
    setSessionAgent("session-1", "atlas")

    // #then
    expect(getSessionAgent("session-1")).toBe("prometheus")

    // #when
    updateSessionAgent("session-1", "atlas")

    // #then
    expect(getSessionAgent("session-1")).toBe("atlas")

    // #when
    clearSessionAgent("session-1")

    // #then
    expect(getSessionAgent("session-1")).toBeUndefined()
  })

  test("delegates subagent marker APIs to coordinator", () => {
    // #given

    // #when
    markSubagentSession("bg-session", "main-session")

    // #then
    expect(isSubagentSession("bg-session")).toBe(true)

    // #when
    unmarkSubagentSession("bg-session")

    // #then
    expect(isSubagentSession("bg-session")).toBe(false)
  })
})
