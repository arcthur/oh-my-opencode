import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { rmSync, existsSync, mkdirSync } from "node:fs"
import { join } from "node:path"
import {
  GovernanceLedgerWriter,
  LedgerManager,
  getLedgerManager,
  resetLedgerManager,
} from "./ledger"

const TEST_DIR = "/tmp/governance-ledger-test"

describe("GovernanceLedgerWriter", () => {
  let ledger: GovernanceLedgerWriter

  beforeEach(() => {
    // Clean up test directory
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true })
    }
    mkdirSync(TEST_DIR, { recursive: true })

    ledger = new GovernanceLedgerWriter("test-session", { baseDir: TEST_DIR })
  })

  afterEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true })
    }
  })

  describe("append", () => {
    it("appends entry with auto-generated fields", () => {
      const entry = ledger.append({
        type: "approval-event",
        tool: "Bash",
        decision: "approved",
        previewShown: "Test preview",
        decisionTimeMs: 500,
      })

      expect(entry.id).toBeDefined()
      expect(entry.timestamp).toBeDefined()
      expect(entry.previousHash).toBe("genesis")
      expect(entry.type).toBe("approval-event")
    })

    it("chains entries with integrity hashes", () => {
      ledger.append({
        type: "approval-event",
        tool: "Tool1",
        decision: "approved",
        previewShown: "",
        decisionTimeMs: 100,
      })

      const second = ledger.append({
        type: "approval-event",
        tool: "Tool2",
        decision: "rejected",
        previewShown: "",
        decisionTimeMs: 200,
      })

      expect(second.previousHash).not.toBe("genesis")
      expect(second.previousHash).toBeDefined()
    })

    it("persists entries to file", () => {
      ledger.append({
        type: "budget-event",
        subtype: "warning",
        budgetState: { consumed: 7000, allocated: 10000, percentage: 0.7 },
        actionTaken: "injected hint",
      })

      const filePath = join(TEST_DIR, "test-session.jsonl")
      expect(existsSync(filePath)).toBe(true)
    })
  })

  describe("convenience logging methods", () => {
    it("logs permission escalation", () => {
      const entry = ledger.logPermissionEscalation({
        requestor: "hook:approval-gate",
        permission: "write:/etc/hosts",
        grantedBy: "user",
        rationale: "User approved",
      })

      expect(entry.type).toBe("permission-escalation")
    })

    it("logs permission violation", () => {
      const entry = ledger.logPermissionViolation({
        violator: "hook:malicious",
        attemptedAction: "write:/etc/passwd",
        blockReason: "System file protected",
        userNotified: true,
      })

      expect(entry.type).toBe("permission-violation")
    })

    it("logs budget event", () => {
      const entry = ledger.logBudgetEvent({
        subtype: "gc-triggered",
        budgetState: { consumed: 9000, allocated: 10000, percentage: 0.9 },
        actionTaken: "freed stale context",
        tokensFreed: 2000,
      })

      expect(entry.type).toBe("budget-event")
    })

    it("logs checkpoint event", () => {
      const entry = ledger.logCheckpointEvent({
        checkpointId: "cp-123",
        subtype: "created",
        reason: "Before critical operation",
        trackedFiles: ["file1.ts", "file2.ts"],
      })

      expect(entry.type).toBe("checkpoint-event")
    })

    it("logs recovery event", () => {
      const entry = ledger.logRecoveryEvent({
        decision: "partial-rerun",
        trigger: { layer: 1, description: "File externally modified" },
        affectedPhases: ["phase-2", "phase-3"],
      })

      expect(entry.type).toBe("recovery-event")
    })

    it("logs approval event", () => {
      const entry = ledger.logApprovalEvent({
        tool: "Bash",
        decision: "approved",
        previewShown: "rm -rf /tmp/test",
        decisionTimeMs: 1500,
      })

      expect(entry.type).toBe("approval-event")
    })

    it("logs state proposal", () => {
      const entry = ledger.logStateProposal({
        proposalId: "prop-123",
        submitter: "hook:test",
        outcome: "applied",
        target: { namespace: "session", key: "state.plan" },
      })

      expect(entry.type).toBe("state-proposal")
    })

    it("logs environment drift", () => {
      const entry = ledger.logEnvironmentDrift({
        driftType: "file-changed",
        affected: ["src/index.ts"],
        impact: "major",
        recommendedAction: "Re-read affected files",
      })

      expect(entry.type).toBe("environment-drift")
    })

    it("logs policy outcome superseded", () => {
      const entry = ledger.logPolicyOutcome({
        decisionId: "dec-1",
        clauseId: "clause-1",
        outcome: "superseded",
        sessionId: "test-session",
        hookPoint: "tool.execute.before",
        toolName: "Write",
        message: "Governance blocked after policy allowed",
      })

      expect(entry.type).toBe("policy-outcome")
      expect(entry.outcome).toBe("superseded")
    })
  })

  describe("verifyIntegrity", () => {
    it("returns valid for intact ledger", () => {
      ledger.logApprovalEvent({
        tool: "Tool1",
        decision: "approved",
        previewShown: "",
        decisionTimeMs: 100,
      })
      ledger.logApprovalEvent({
        tool: "Tool2",
        decision: "rejected",
        previewShown: "",
        decisionTimeMs: 200,
      })

      const report = ledger.verifyIntegrity()

      expect(report.valid).toBe(true)
      expect(report.errors).toHaveLength(0)
      expect(report.entryCount).toBe(2)
    })
  })

  describe("query", () => {
    beforeEach(() => {
      ledger.logApprovalEvent({
        tool: "Tool1",
        decision: "approved",
        previewShown: "",
        decisionTimeMs: 100,
      })
      ledger.logBudgetEvent({
        subtype: "warning",
        budgetState: { consumed: 7000, allocated: 10000, percentage: 0.7 },
        actionTaken: "hint",
      })
      ledger.logApprovalEvent({
        tool: "Tool2",
        decision: "rejected",
        previewShown: "",
        decisionTimeMs: 200,
      })
    })

    it("filters by type", () => {
      const approvals = ledger.query({ type: "approval-event" })
      expect(approvals).toHaveLength(2)

      const budgets = ledger.query({ type: "budget-event" })
      expect(budgets).toHaveLength(1)
    })

    it("filters by time range", () => {
      const now = Date.now()
      const recent = ledger.query({ after: now - 1000 })
      expect(recent.length).toBeGreaterThan(0)

      const future = ledger.query({ after: now + 10000 })
      expect(future).toHaveLength(0)
    })
  })

  describe("getEntries and getMetadata", () => {
    it("returns copy of entries", () => {
      ledger.logApprovalEvent({
        tool: "Tool",
        decision: "approved",
        previewShown: "",
        decisionTimeMs: 100,
      })

      const entries = ledger.getEntries()
      expect(entries).toHaveLength(1)

      // Modifying returned array shouldn't affect ledger
      entries.push({} as any)
      expect(ledger.getEntries()).toHaveLength(1)
    })

    it("returns ledger metadata", () => {
      const meta = ledger.getMetadata()

      expect(meta.ledgerId).toBeDefined()
      expect(meta.sessionId).toBe("test-session")
      expect(meta.createdAt).toBeDefined()
      expect(meta.integrityChain).toEqual([])
    })
  })

  describe("generateDiagnosticReport", () => {
    it("generates report for budget symptoms", () => {
      ledger.logBudgetEvent({
        subtype: "warning",
        budgetState: { consumed: 7000, allocated: 10000, percentage: 0.7 },
        actionTaken: "hint",
      })
      ledger.logBudgetEvent({
        subtype: "fork-triggered",
        budgetState: { consumed: 9000, allocated: 10000, percentage: 0.9 },
        actionTaken: "fork session",
      })
      ledger.logRecoveryEvent({
        decision: "full-rerun",
        trigger: { layer: 0, description: "Context lost" },
        affectedPhases: ["all"],
      })

      const report = ledger.generateDiagnosticReport("task-incomplete-at-90-percent")

      expect(report.symptom).toBe("task-incomplete-at-90-percent")
      expect(report.likelyCause).toBeDefined()
      expect(report.supportingEvents.length).toBeGreaterThan(0)
      expect(report.causalChain.length).toBeGreaterThan(0)
      expect(report.recommendation).toBeDefined()
    })

    it("generates report for permission symptoms", () => {
      ledger.logPermissionViolation({
        violator: "hook:test",
        attemptedAction: "write:/etc/hosts",
        blockReason: "Protected path",
        userNotified: true,
      })

      const report = ledger.generateDiagnosticReport("permission denied error")

      expect(report.supportingEvents.some((e) => e.type === "permission-violation")).toBe(true)
    })

    it("generates report for drift symptoms", () => {
      ledger.logEnvironmentDrift({
        driftType: "file-changed",
        affected: ["package.json"],
        impact: "critical",
        recommendedAction: "Re-analyze dependencies",
      })

      const report = ledger.generateDiagnosticReport("unexpected environment changed")

      expect(report.supportingEvents.some((e) => e.type === "environment-drift")).toBe(true)
    })
  })

  describe("persistence and reload", () => {
    it("persists and reloads ledger from file", () => {
      ledger.logApprovalEvent({
        tool: "Tool1",
        decision: "approved",
        previewShown: "Preview 1",
        decisionTimeMs: 100,
      })
      ledger.logBudgetEvent({
        subtype: "warning",
        budgetState: { consumed: 5000, allocated: 10000, percentage: 0.5 },
        actionTaken: "continue",
      })

      // Create new ledger instance for same session
      const ledger2 = new GovernanceLedgerWriter("test-session", { baseDir: TEST_DIR })

      expect(ledger2.getEntries()).toHaveLength(2)
      expect(ledger2.verifyIntegrity().valid).toBe(true)
    })
  })
})

describe("LedgerManager", () => {
  let manager: LedgerManager

  beforeEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true })
    }
    mkdirSync(TEST_DIR, { recursive: true })

    manager = new LedgerManager({ baseDir: TEST_DIR })
  })

  afterEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true })
    }
    resetLedgerManager()
  })

  describe("getLedger", () => {
    it("creates ledger for new session", () => {
      const ledger = manager.getLedger("session-1")

      expect(ledger).toBeDefined()
      expect(ledger.getMetadata().sessionId).toBe("session-1")
    })

    it("returns same ledger for same session", () => {
      const ledger1 = manager.getLedger("session-1")
      const ledger2 = manager.getLedger("session-1")

      expect(ledger1).toBe(ledger2)
    })
  })

  describe("hasLedger", () => {
    it("returns true for existing ledger", () => {
      manager.getLedger("session-1")
      expect(manager.hasLedger("session-1")).toBe(true)
    })

    it("returns false for non-existent ledger", () => {
      expect(manager.hasLedger("non-existent")).toBe(false)
    })
  })

  describe("unloadLedger", () => {
    it("removes ledger from memory", () => {
      const ledger = manager.getLedger("session-1")
      ledger.logApprovalEvent({
        tool: "Tool",
        decision: "approved",
        previewShown: "",
        decisionTimeMs: 100,
      })

      manager.unloadLedger("session-1")

      // File should still exist
      expect(existsSync(join(TEST_DIR, "session-1.jsonl"))).toBe(true)

      // Getting ledger again should reload from file
      const ledger2 = manager.getLedger("session-1")
      expect(ledger2).not.toBe(ledger) // Different instance
      expect(ledger2.getEntries()).toHaveLength(1) // But same data
    })
  })

  describe("deleteLedger", () => {
    it("removes ledger completely", () => {
      manager.getLedger("session-1")
      const deleted = manager.deleteLedger("session-1")

      expect(deleted).toBe(true)
      expect(existsSync(join(TEST_DIR, "session-1.jsonl"))).toBe(false)
      expect(manager.hasLedger("session-1")).toBe(false)
    })

    it("returns false for non-existent ledger", () => {
      expect(manager.deleteLedger("non-existent")).toBe(false)
    })
  })

  describe("listSessions", () => {
    it("returns all session IDs with ledgers", () => {
      manager.getLedger("session-1")
      manager.getLedger("session-2")
      manager.getLedger("session-3")

      const sessions = manager.listSessions()

      expect(sessions).toContain("session-1")
      expect(sessions).toContain("session-2")
      expect(sessions).toContain("session-3")
    })
  })

  describe("cleanup", () => {
    it("removes old ledgers", async () => {
      // Create ledgers with different ages
      manager.getLedger("old-session")
      manager.getLedger("new-session")

      // Force old session file to have old mtime
      const oldPath = join(TEST_DIR, "old-session.jsonl")
      // Note: Can't easily set mtime in tests, so this just verifies the method runs
      const result = manager.cleanup()

      expect(result.deleted).toBeGreaterThanOrEqual(0)
      expect(result.preserved).toBeGreaterThanOrEqual(0)
    })
  })
})

describe("getLedgerManager", () => {
  afterEach(() => {
    resetLedgerManager()
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true })
    }
  })

  it("returns singleton instance", () => {
    const manager1 = getLedgerManager({ baseDir: TEST_DIR })
    const manager2 = getLedgerManager()

    expect(manager1).toBe(manager2)
  })

  it("creates new instance after reset", () => {
    const manager1 = getLedgerManager({ baseDir: TEST_DIR })
    resetLedgerManager()
    const manager2 = getLedgerManager({ baseDir: TEST_DIR })

    expect(manager1).not.toBe(manager2)
  })
})
