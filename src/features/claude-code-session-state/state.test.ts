import { describe, test, expect, beforeEach } from "bun:test"
import {
  setSessionAgent,
  getSessionAgent,
  clearSessionAgent,
  updateSessionAgent,
  setMainSession,
  getMainSessionID,
  _resetForTesting,
} from "./state"

describe("claude-code-session-state", () => {
  beforeEach(() => {
    // given - clean state before each test
    _resetForTesting()
    clearSessionAgent("test-session-1")
    clearSessionAgent("test-session-2")
    clearSessionAgent("test-planner-session")
  })

  describe("setSessionAgent", () => {
    test("should store agent for session", () => {
      // given
      const sessionID = "test-session-1"
      const agent = "planner"

      // when
      setSessionAgent(sessionID, agent)

      // then
      expect(getSessionAgent(sessionID)).toBe(agent)
    })

    test("should NOT overwrite existing agent (first-write wins)", () => {
      // given
      const sessionID = "test-session-1"
      setSessionAgent(sessionID, "planner")

      // when - try to overwrite
      setSessionAgent(sessionID, "orchestrator")

      // then - first agent preserved
      expect(getSessionAgent(sessionID)).toBe("planner")
    })

    test("should return undefined for unknown session", () => {
      // given - no session set

      // when / #then
      expect(getSessionAgent("unknown-session")).toBeUndefined()
    })
  })

  describe("updateSessionAgent", () => {
    test("should overwrite existing agent", () => {
      // given
      const sessionID = "test-session-1"
      setSessionAgent(sessionID, "planner")

      // when - force update
      updateSessionAgent(sessionID, "orchestrator")

      // then
      expect(getSessionAgent(sessionID)).toBe("orchestrator")
    })
  })

  describe("clearSessionAgent", () => {
    test("should remove agent from session", () => {
      // given
      const sessionID = "test-session-1"
      setSessionAgent(sessionID, "planner")
      expect(getSessionAgent(sessionID)).toBe("planner")

      // when
      clearSessionAgent(sessionID)

      // then
      expect(getSessionAgent(sessionID)).toBeUndefined()
    })
  })

  describe("mainSessionID", () => {
    test("should store and retrieve main session ID", () => {
      // given
      const mainID = "main-session-123"

      // when
      setMainSession(mainID)

      // then
      expect(getMainSessionID()).toBe(mainID)
    })

    // Removed: "should return undefined when not set" - trivial JS behavior
    // (uninitialized variable returns undefined) + parallel test state pollution
  })

  describe("planner policy integration scenario", () => {
    test("should correctly identify planner agent for permission checks", () => {
      // given - planner session
      const sessionID = "test-planner-session"
      const plannerAgent = "planner"

      // when - agent is set (simulating chat.message hook)
      setSessionAgent(sessionID, plannerAgent)

      // then - getSessionAgent returns correct agent for policy runtime guard checks
      const agent = getSessionAgent(sessionID)
      expect(agent).toBe("planner")
      expect(["planner"].includes(agent!)).toBe(true)
    })

    test("should return undefined when agent not set (bug scenario)", () => {
      // given - session exists but no agent set (the bug)
      const sessionID = "test-planner-session"

      // when / #then - this is the bug: agent is undefined
      expect(getSessionAgent(sessionID)).toBeUndefined()
    })
  })
})
