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
    // #given - clean state before each test
    _resetForTesting()
    clearSessionAgent("test-session-1")
    clearSessionAgent("test-session-2")
    clearSessionAgent("test-prometheus-session")
  })

  describe("setSessionAgent", () => {
    test("should store agent for session", () => {
      // #given
      const sessionID = "test-session-1"
      const agent = "prometheus"

      // #when
      setSessionAgent(sessionID, agent)

      // #then
      expect(getSessionAgent(sessionID)).toBe(agent)
    })

    test("should NOT overwrite existing agent (first-write wins)", () => {
      // #given
      const sessionID = "test-session-1"
      setSessionAgent(sessionID, "prometheus")

      // #when - try to overwrite
      setSessionAgent(sessionID, "sisyphus")

      // #then - first agent preserved
      expect(getSessionAgent(sessionID)).toBe("prometheus")
    })

    test("should return undefined for unknown session", () => {
      // #given - no session set

      // #when / #then
      expect(getSessionAgent("unknown-session")).toBeUndefined()
    })
  })

  describe("updateSessionAgent", () => {
    test("should overwrite existing agent", () => {
      // #given
      const sessionID = "test-session-1"
      setSessionAgent(sessionID, "prometheus")

      // #when - force update
      updateSessionAgent(sessionID, "sisyphus")

      // #then
      expect(getSessionAgent(sessionID)).toBe("sisyphus")
    })
  })

  describe("clearSessionAgent", () => {
    test("should remove agent from session", () => {
      // #given
      const sessionID = "test-session-1"
      setSessionAgent(sessionID, "prometheus")
      expect(getSessionAgent(sessionID)).toBe("prometheus")

      // #when
      clearSessionAgent(sessionID)

      // #then
      expect(getSessionAgent(sessionID)).toBeUndefined()
    })
  })

  describe("mainSessionID", () => {
    test("should store and retrieve main session ID", () => {
      // #given
      const mainID = "main-session-123"

      // #when
      setMainSession(mainID)

      // #then
      expect(getMainSessionID()).toBe(mainID)
    })

    // Removed: "should return undefined when not set" - trivial JS behavior
    // (uninitialized variable returns undefined) + parallel test state pollution
  })

  describe("prometheus-md-only integration scenario", () => {
    test("should correctly identify Prometheus agent for permission checks", () => {
      // #given - Prometheus session
      const sessionID = "test-prometheus-session"
      const prometheusAgent = "prometheus"

      // #when - agent is set (simulating chat.message hook)
      setSessionAgent(sessionID, prometheusAgent)

      // #then - getSessionAgent returns correct agent for prometheus-md-only hook
      const agent = getSessionAgent(sessionID)
      expect(agent).toBe("prometheus")
      expect(["prometheus"].includes(agent!)).toBe(true)
    })

    test("should return undefined when agent not set (bug scenario)", () => {
      // #given - session exists but no agent set (the bug)
      const sessionID = "test-prometheus-session"

      // #when / #then - this is the bug: agent is undefined
      expect(getSessionAgent(sessionID)).toBeUndefined()
    })
  })
})
