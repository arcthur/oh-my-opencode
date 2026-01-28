/**
 * Governance Integration Tests
 *
 * Tests for the governance integration layer that bridges
 * governance components with Claude Code hooks.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import {
  initGovernanceSession,
  getGovernanceSession,
  hasGovernanceSession,
  cleanupGovernanceSession,
  executePreToolGovernance,
  executePostToolGovernance,
  executeUserPromptGovernance,
  DEFAULT_GOVERNANCE_CONFIG,
} from "./integration"
import { resetBudgetMonitorManager } from "./budget-monitor"
import type { GovernanceConfig } from "../../config/schema"

describe("GovernanceIntegration", () => {
  const testSessionId = "test-session-integration"
  const testCwd = "/test/cwd"

  afterEach(() => {
    cleanupGovernanceSession(testSessionId)
    resetBudgetMonitorManager()
  })

  describe("session management", () => {
    it("should initialize session with default config when disabled", () => {
      const session = initGovernanceSession(testSessionId, testCwd)

      expect(session.sessionId).toBe(testSessionId)
      expect(session.config.enabled).toBe(false)
      expect(session.tracer).toBeNull()
      expect(session.budgetMonitor).toBeNull()
      expect(session.ledger).toBeNull()
      expect(session.checkpointManager).toBeNull()
    })

    it("should initialize session with enabled config", () => {
      const config: Partial<GovernanceConfig> = {
        enabled: true,
        tracer: { enabled: true },
        budget_monitor: { enabled: true },
        ledger: { enabled: false },
        checkpoint: { enabled: false },
      }

      const session = initGovernanceSession(testSessionId, testCwd, config)

      expect(session.sessionId).toBe(testSessionId)
      expect(session.config.enabled).toBe(true)
      expect(session.tracer).not.toBeNull()
      expect(session.budgetMonitor).not.toBeNull()
      expect(session.ledger).toBeNull()
      expect(session.checkpointManager).toBeNull()
    })

    it("should get existing session", () => {
      initGovernanceSession(testSessionId, testCwd)

      const session = getGovernanceSession(testSessionId)

      expect(session.sessionId).toBe(testSessionId)
    })

    it("should create session if not exists", () => {
      const session = getGovernanceSession("new-session", testCwd)

      expect(session.sessionId).toBe("new-session")

      cleanupGovernanceSession("new-session")
    })

    it("should check if session exists", () => {
      expect(hasGovernanceSession(testSessionId)).toBe(false)

      initGovernanceSession(testSessionId, testCwd)

      expect(hasGovernanceSession(testSessionId)).toBe(true)
    })

    it("should cleanup session", () => {
      initGovernanceSession(testSessionId, testCwd)
      expect(hasGovernanceSession(testSessionId)).toBe(true)

      cleanupGovernanceSession(testSessionId)

      expect(hasGovernanceSession(testSessionId)).toBe(false)
    })
  })

  describe("executePreToolGovernance", () => {
    it("should allow tool when governance disabled", () => {
      initGovernanceSession(testSessionId, testCwd, { enabled: false })

      const result = executePreToolGovernance({
        sessionId: testSessionId,
        toolName: "Write",
        toolInput: { file_path: "/test.txt", content: "test" },
        cwd: testCwd,
      })

      expect(result.proceed).toBe(true)
    })

    it("should proceed for all tools when enabled", () => {
      initGovernanceSession(testSessionId, testCwd, {
        enabled: true,
        tracer: { enabled: true },
      })

      const result = executePreToolGovernance({
        sessionId: testSessionId,
        toolName: "Read",
        toolInput: { file_path: "/test.txt" },
        cwd: testCwd,
      })

      expect(result.proceed).toBe(true)
    })

    it("should start tracer node when enabled", () => {
      initGovernanceSession(testSessionId, testCwd, {
        enabled: true,
        tracer: { enabled: true },
      })

      const result = executePreToolGovernance({
        sessionId: testSessionId,
        toolName: "Write",
        toolInput: { file_path: "/test.txt", content: "test" },
        toolUseId: "tool-123",
        cwd: testCwd,
      })

      expect(result.proceed).toBe(true)
      expect(result.traceNodeId).toBeDefined()
    })
  })

  describe("executePostToolGovernance", () => {
    it("should return no warnings when governance disabled", async () => {
      initGovernanceSession(testSessionId, testCwd, { enabled: false })

      const result = await executePostToolGovernance({
        sessionId: testSessionId,
        toolName: "Write",
        toolInput: { file_path: "/test.txt" },
        toolOutput: { success: true },
        success: true,
        cwd: testCwd,
      })

      expect(result.block).toBe(false)
      expect(result.warnings).toEqual([])
    })

    it("should end tracer node when enabled", async () => {
      initGovernanceSession(testSessionId, testCwd, {
        enabled: true,
        tracer: { enabled: true },
      })

      // Start a node first
      executePreToolGovernance({
        sessionId: testSessionId,
        toolName: "Write",
        toolInput: { file_path: "/test.txt" },
        toolUseId: "tool-456",
        cwd: testCwd,
      })

      const result = await executePostToolGovernance({
        sessionId: testSessionId,
        toolName: "Write",
        toolInput: { file_path: "/test.txt" },
        toolOutput: { success: true },
        toolUseId: "tool-456",
        success: true,
        cwd: testCwd,
      })

      expect(result.block).toBe(false)
    })

    it("should record token consumption in budget monitor", async () => {
      initGovernanceSession(testSessionId, testCwd, {
        enabled: true,
        budget_monitor: { enabled: true, context_window_size: 1000 },
      })

      const result = await executePostToolGovernance({
        sessionId: testSessionId,
        toolName: "Write",
        toolInput: {},
        toolOutput: {},
        success: true,
        tokensUsed: 100,
        cwd: testCwd,
      })

      expect(result.block).toBe(false)
    })
  })

  describe("executeUserPromptGovernance", () => {
    it("should allow prompt when governance disabled", () => {
      initGovernanceSession(testSessionId, testCwd, { enabled: false })

      const result = executeUserPromptGovernance({
        sessionId: testSessionId,
        prompt: "Hello, world!",
        cwd: testCwd,
      })

      expect(result.block).toBe(false)
      expect(result.messages).toEqual([])
    })

    it("should track token consumption with budget monitor", () => {
      initGovernanceSession(testSessionId, testCwd, {
        enabled: true,
        budget_monitor: { enabled: true, context_window_size: 200000 },
      })

      const result = executeUserPromptGovernance({
        sessionId: testSessionId,
        prompt: "Hello, world!",
        estimatedTokens: 100,
        cwd: testCwd,
      })

      expect(result.block).toBe(false)
    })

    it("should inject budget status when near limits", async () => {
      initGovernanceSession(testSessionId, testCwd, {
        enabled: true,
        budget_monitor: {
          enabled: true,
          context_window_size: 1000,
          warn_threshold: 0.1,
        },
      })

      // First consume some tokens to trigger warning (recordConsumption is async)
      const session = getGovernanceSession(testSessionId)
      await session.budgetMonitor?.recordConsumption(800)

      const result = executeUserPromptGovernance({
        sessionId: testSessionId,
        prompt: "Hello!",
        estimatedTokens: 50,
        cwd: testCwd,
      })

      // Should have budget status message
      expect(result.messages.length).toBeGreaterThan(0)
    })
  })

  describe("DEFAULT_GOVERNANCE_CONFIG", () => {
    it("should have governance disabled by default", () => {
      expect(DEFAULT_GOVERNANCE_CONFIG.enabled).toBe(false)
    })

    it("should have approval gate enabled by default (when governance enabled)", () => {
      expect(DEFAULT_GOVERNANCE_CONFIG.approval_gate?.enabled).toBe(true)
    })

    it("should have tracer enabled by default (when governance enabled)", () => {
      expect(DEFAULT_GOVERNANCE_CONFIG.tracer?.enabled).toBe(true)
    })

    it("should have checkpoint disabled by default", () => {
      expect(DEFAULT_GOVERNANCE_CONFIG.checkpoint?.enabled).toBe(false)
    })

    it("should have default skip patterns for approval gate", () => {
      expect(DEFAULT_GOVERNANCE_CONFIG.approval_gate?.skip_patterns).toContain("Read")
      expect(DEFAULT_GOVERNANCE_CONFIG.approval_gate?.skip_patterns).toContain("Glob")
      expect(DEFAULT_GOVERNANCE_CONFIG.approval_gate?.skip_patterns).toContain("Grep")
    })
  })
})
