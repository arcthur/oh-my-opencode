/**
 * Governance Integration Tests
 *
 * Tests for the governance integration layer that bridges
 * governance components with Claude Code hooks.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import {
  initGovernanceSession,
  getGovernanceSession,
  hasGovernanceSession,
  cleanupGovernanceSession,
  cleanupAllGovernanceSessions,
  persistGovernanceTraceSnapshot,
  executePreToolGovernance,
  executePostToolGovernance,
  executeUserPromptGovernance,
  recordWorkOrchestratorTransition,
  DEFAULT_GOVERNANCE_CONFIG,
} from "../../../src/features/governance/integration"
import { resetBudgetMonitorManager } from "../../../src/features/governance/budget-monitor"
import { resetTracerManager } from "../../../src/features/governance/tracer"
import { resetLedgerManager } from "../../../src/features/governance/ledger"
import { resetCheckpointRegistry } from "../../../src/features/governance/checkpoint"
import { ORCHESTRATOR_HOME_DIR_ENV } from "../../../src/features/governance/storage-paths"
import type { GovernanceConfig } from "../../../src/config/schema"

describe("GovernanceIntegration", () => {
  const testSessionId = "test-session-integration"
  const testCwd = "/test/cwd"
  let governanceHomeDir = ""
  let previousOrchestratorHomeDir: string | undefined

  beforeEach(() => {
    previousOrchestratorHomeDir = process.env[ORCHESTRATOR_HOME_DIR_ENV]
    governanceHomeDir = mkdtempSync(join(tmpdir(), "governance-home-"))
    process.env[ORCHESTRATOR_HOME_DIR_ENV] = governanceHomeDir
  })

  afterEach(() => {
    cleanupGovernanceSession(testSessionId)
    resetBudgetMonitorManager()
    resetTracerManager()
    resetLedgerManager()
    resetCheckpointRegistry()

    if (previousOrchestratorHomeDir === undefined) {
      delete process.env[ORCHESTRATOR_HOME_DIR_ENV]
    } else {
      process.env[ORCHESTRATOR_HOME_DIR_ENV] = previousOrchestratorHomeDir
    }

    if (existsSync(governanceHomeDir)) {
      rmSync(governanceHomeDir, { recursive: true, force: true })
    }
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

    it("cleans up all active governance sessions and persists traces", async () => {
      // #given
      const sessionA = "test-session-integration-cleanup-a"
      const sessionB = "test-session-integration-cleanup-b"
      const tracePathA = join(governanceHomeDir, "traces", `${sessionA}.json`)
      const tracePathB = join(governanceHomeDir, "traces", `${sessionB}.json`)
      rmSync(tracePathA, { force: true })
      rmSync(tracePathB, { force: true })

      for (const sessionId of [sessionA, sessionB]) {
        initGovernanceSession(sessionId, testCwd, {
          enabled: true,
          tracer: { enabled: true },
          budget_monitor: { enabled: false },
          ledger: { enabled: false },
          checkpoint: { enabled: false },
        })

        executePreToolGovernance({
          sessionId,
          toolName: "Read",
          toolInput: { file_path: "/tmp/demo.txt" },
          toolUseId: `tool-${sessionId}`,
          cwd: testCwd,
        })

        await executePostToolGovernance({
          sessionId,
          toolName: "Read",
          toolInput: { file_path: "/tmp/demo.txt" },
          toolOutput: { success: true },
          toolUseId: `tool-${sessionId}`,
          success: true,
          cwd: testCwd,
        })
      }

      // #when
      cleanupAllGovernanceSessions()

      // #then
      expect(hasGovernanceSession(sessionA)).toBe(false)
      expect(hasGovernanceSession(sessionB)).toBe(false)
      expect(existsSync(tracePathA)).toBe(true)
      expect(existsSync(tracePathB)).toBe(true)

      rmSync(tracePathA, { force: true })
      rmSync(tracePathB, { force: true })
    })

    it("persists trace snapshot before session deletion", async () => {
      // #given
      const snapshotSessionId = "test-session-integration-snapshot"
      const tracePath = join(governanceHomeDir, "traces", `${snapshotSessionId}.json`)
      rmSync(tracePath, { force: true })

      initGovernanceSession(snapshotSessionId, testCwd, {
        enabled: true,
        tracer: { enabled: true },
        budget_monitor: { enabled: false },
        ledger: { enabled: false },
        checkpoint: { enabled: false },
      })
      executePreToolGovernance({
        sessionId: snapshotSessionId,
        toolName: "Read",
        toolInput: { file_path: "/tmp/demo.txt" },
        toolUseId: "tool-snapshot-1",
        cwd: testCwd,
      })
      await executePostToolGovernance({
        sessionId: snapshotSessionId,
        toolName: "Read",
        toolInput: { file_path: "/tmp/demo.txt" },
        toolOutput: { success: true },
        toolUseId: "tool-snapshot-1",
        success: true,
        cwd: testCwd,
      })

      // #when
      const saved = persistGovernanceTraceSnapshot(snapshotSessionId)

      // #then
      expect(saved).toBe(true)
      expect(existsSync(tracePath)).toBe(true)
      const persisted = readFileSync(tracePath, "utf-8")
      expect(persisted.includes(snapshotSessionId)).toBe(true)

      cleanupGovernanceSession(snapshotSessionId)
      rmSync(tracePath, { force: true })
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

    it("should not throw on budget exhaustion and should return block + systemMessage", async () => {
      initGovernanceSession(testSessionId, testCwd, {
        enabled: true,
        budget_monitor: {
          enabled: true,
          context_window_size: 100,
          refactor_threshold: 0.8,
          hard_limit: 0.8,
        },
      })

      const result = await executePostToolGovernance({
        sessionId: testSessionId,
        toolName: "Write",
        toolInput: {},
        toolOutput: {},
        success: true,
        tokensUsed: 90,
        cwd: testCwd,
      })

      expect(result.block).toBe(true)
      expect(result.systemMessage).toContain("Budget exhausted")
    })

    it("records cache observability fields in tracer resources", async () => {
      // #given
      initGovernanceSession(testSessionId, testCwd, {
        enabled: true,
        tracer: { enabled: true },
        budget_monitor: { enabled: false },
      })

      executePreToolGovernance({
        sessionId: testSessionId,
        toolName: "Write",
        toolInput: { file_path: "/tmp/a.ts" },
        toolUseId: "tool-cache-1",
        cwd: testCwd,
      })

      // #when
      await executePostToolGovernance({
        sessionId: testSessionId,
        toolName: "Write",
        toolInput: { file_path: "/tmp/a.ts" },
        toolOutput: { success: true },
        toolUseId: "tool-cache-1",
        success: true,
        tokensUsed: 120,
        cacheReadTokens: 80,
        cacheWriteTokens: 20,
        cacheHitRatio: 0.4,
        prefixFingerprint: "abc123",
        cwd: testCwd,
      })

      // #then
      const session = getGovernanceSession(testSessionId, testCwd)
      const trace = session.tracer?.getTrace()
      const node = trace?.nodes.find((item) => item.id === "tool-cache-1" || item.name === "Write")
      expect(node).toBeDefined()
      expect(node?.resources.tokensUsed).toBe(120)
      expect(node?.resources.cacheReadTokens).toBe(80)
      expect(node?.resources.cacheWriteTokens).toBe(20)
      expect(node?.resources.cacheHitRatio).toBe(0.4)
      expect(node?.resources.prefixFingerprint).toBe("abc123")
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

    it("should inject budget exhausted message when hard limit reached", () => {
      initGovernanceSession(testSessionId, testCwd, {
        enabled: true,
        budget_monitor: {
          enabled: true,
          context_window_size: 100,
          refactor_threshold: 0.8,
          hard_limit: 0.8,
        },
      })

      const result = executeUserPromptGovernance({
        sessionId: testSessionId,
        prompt: "Hello!",
        estimatedTokens: 90,
        cwd: testCwd,
      })

      expect(result.block).toBe(false)
      expect(result.messages.join("\n")).toContain("<budget-exhausted>")
    })
  })

  describe("recordWorkOrchestratorTransition", () => {
    it("writes work-orchestrator transitions to tracer and ledger when governance is enabled", () => {
      const action = "idle-arbitration-accepted-pending"

      // #given
      initGovernanceSession(testSessionId, testCwd, {
        enabled: true,
        tracer: { enabled: true },
        ledger: { enabled: true },
        budget_monitor: { enabled: false },
        checkpoint: { enabled: false },
      })

      // #when
      recordWorkOrchestratorTransition({
        sessionId: testSessionId,
        cwd: testCwd,
        phase: "continuation",
        action,
        outcome: "accepted",
        metadata: {
          source: "work-orchestrator",
          round: 7,
        },
      })

      // #then
      const session = getGovernanceSession(testSessionId)
      const trace = session.tracer?.getTrace()
      expect(trace?.nodes.some((node) => node.name.includes(`work-orchestrator:continuation:${action}`))).toBe(true)

      const entries = session.ledger?.getEntries() ?? []
      const stateProposalEntries = entries.filter((entry) => entry.type === "state-proposal")
      expect(stateProposalEntries.length).toBeGreaterThan(0)
      const matchedEntry = stateProposalEntries.find((entry) => {
        const target = (entry as { target?: { namespace?: string; key?: string } }).target
        return (
          target?.namespace === "work-orchestrator" &&
          target?.key === `continuation:${action}`
        )
      }) as { outcome?: string } | undefined
      expect(matchedEntry).toBeDefined()
      expect(matchedEntry?.outcome).toBe("pending")
    })

    it("maps observed lifecycle transitions to pending ledger outcomes", () => {
      const action = "session-idle-observed-pending"

      // #given
      initGovernanceSession(testSessionId, testCwd, {
        enabled: true,
        tracer: { enabled: true },
        ledger: { enabled: true },
        budget_monitor: { enabled: false },
        checkpoint: { enabled: false },
      })

      // #when
      recordWorkOrchestratorTransition({
        sessionId: testSessionId,
        cwd: testCwd,
        phase: "lifecycle",
        action,
        outcome: "observed",
      })

      // #then
      const entries = getGovernanceSession(testSessionId).ledger?.getEntries() ?? []
      const matchedEntry = entries.find((entry) => {
        if (entry.type !== "state-proposal") {
          return false
        }
        const target = (entry as { target?: { namespace?: string; key?: string } }).target
        return (
          target?.namespace === "work-orchestrator" &&
          target?.key === `lifecycle:${action}`
        )
      }) as { outcome?: string } | undefined
      expect(matchedEntry).toBeDefined()
      expect(matchedEntry?.outcome).toBe("pending")
    })

    it("is a no-op when governance is disabled", () => {
      // #given
      initGovernanceSession(testSessionId, testCwd, { enabled: false })

      // #when
      recordWorkOrchestratorTransition({
        sessionId: testSessionId,
        cwd: testCwd,
        phase: "planning",
        action: "plan-switch",
        outcome: "observed",
      })

      // #then
      const session = getGovernanceSession(testSessionId)
      expect(session.tracer).toBeNull()
      expect(session.ledger).toBeNull()
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
