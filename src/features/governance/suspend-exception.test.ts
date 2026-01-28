import { describe, it, expect, beforeEach } from "vitest"
import {
  SuspendException,
  InMemoryResumeTokenStore,
  ResumeHandler,
} from "./suspend-exception"

describe("SuspendException", () => {
  describe("constructor", () => {
    it("creates exception with proper message", () => {
      const exception = new SuspendException({
        reason: "Test reason",
        tool: "TestTool",
        toolArgs: { arg: "value" },
        sessionId: "session-123",
        previewData: {
          title: "Test",
          description: "Test description",
          affectedItems: [],
        },
        availableActions: [{ type: "approve", label: "OK" }],
      })

      expect(exception.message).toBe("Execution suspended: Test reason")
      expect(exception.name).toBe("SuspendException")
    })

    it("generates resume token automatically", () => {
      const exception = new SuspendException({
        reason: "Test",
        tool: "TestTool",
        toolArgs: {},
        sessionId: "session-123",
        previewData: {
          title: "Test",
          description: "Test",
          affectedItems: [],
        },
        availableActions: [],
      })

      expect(exception.suspendInfo.resumeToken).toBeDefined()
      expect(exception.suspendInfo.resumeToken).toContain("resume_")
      expect(exception.suspendInfo.resumeToken).toContain("session-") // First 8 chars
      expect(exception.suspendInfo.resumeToken).toContain("TestTool")
    })

    it("sets timestamp automatically", () => {
      const before = Date.now()
      const exception = new SuspendException({
        reason: "Test",
        tool: "TestTool",
        toolArgs: {},
        sessionId: "session-123",
        previewData: { title: "Test", description: "Test", affectedItems: [] },
        availableActions: [],
      })
      const after = Date.now()

      expect(exception.suspendInfo.timestamp).toBeGreaterThanOrEqual(before)
      expect(exception.suspendInfo.timestamp).toBeLessThanOrEqual(after)
    })
  })

  describe("static isSuspendException", () => {
    it("returns true for SuspendException", () => {
      const exception = new SuspendException({
        reason: "Test",
        tool: "TestTool",
        toolArgs: {},
        sessionId: "session-123",
        previewData: { title: "Test", description: "Test", affectedItems: [] },
        availableActions: [],
      })

      expect(SuspendException.isSuspendException(exception)).toBe(true)
    })

    it("returns false for regular Error", () => {
      const error = new Error("Regular error")
      expect(SuspendException.isSuspendException(error)).toBe(false)
    })

    it("returns false for non-error values", () => {
      expect(SuspendException.isSuspendException(null)).toBe(false)
      expect(SuspendException.isSuspendException(undefined)).toBe(false)
      expect(SuspendException.isSuspendException("string")).toBe(false)
      expect(SuspendException.isSuspendException(42)).toBe(false)
    })
  })

  describe("forToolApproval", () => {
    it("creates exception with default actions", () => {
      const exception = SuspendException.forToolApproval({
        tool: "Bash",
        toolArgs: { command: "rm -rf /" },
        sessionId: "session-123",
        reason: "Dangerous command",
        preview: {
          title: "Destructive Command",
          description: "This will delete everything",
          affectedItems: [],
        },
      })

      expect(exception.suspendInfo.availableActions).toHaveLength(3)
      expect(exception.suspendInfo.availableActions[0].type).toBe("approve")
      expect(exception.suspendInfo.availableActions[1].type).toBe("reject")
      expect(exception.suspendInfo.availableActions[2].type).toBe("modify")
    })

    it("accepts custom actions", () => {
      const customActions = [
        { type: "approve" as const, label: "Yes" },
        { type: "reject" as const, label: "No" },
      ]

      const exception = SuspendException.forToolApproval({
        tool: "Test",
        toolArgs: {},
        sessionId: "session-123",
        reason: "Test",
        preview: { title: "Test", description: "Test", affectedItems: [] },
        actions: customActions,
      })

      expect(exception.suspendInfo.availableActions).toEqual(customActions)
    })
  })

  describe("forBudgetWarning", () => {
    it("creates exception with budget info", () => {
      const exception = SuspendException.forBudgetWarning({
        sessionId: "session-123",
        percentage: 0.9,
        remaining: 10000,
      })

      expect(exception.suspendInfo.reason).toContain("90.0%")
      expect(exception.suspendInfo.tool).toBe("system:budget-monitor")
      expect(exception.suspendInfo.previewData.title).toBe("Context Budget Warning")
      expect(exception.suspendInfo.previewData.estimatedImpact?.tokensRequired).toBe(10000)
    })
  })

  describe("toJSON", () => {
    it("returns serializable representation", () => {
      const exception = new SuspendException({
        reason: "Test reason",
        tool: "TestTool",
        toolArgs: { key: "value" },
        sessionId: "session-123",
        previewData: { title: "Test", description: "Test", affectedItems: [] },
        availableActions: [{ type: "approve", label: "OK" }],
      })

      const json = exception.toJSON()

      expect(json.error).toBe("Execution suspended: Test reason")
      expect(json.reason).toBe("Test reason")
      expect(json.tool).toBe("TestTool")
      expect(json.toolArgs).toEqual({ key: "value" })
      expect(json.sessionId).toBe("session-123")
      expect(json.resumeToken).toBeDefined()
      expect(json.timestamp).toBeDefined()
    })
  })
})

describe("InMemoryResumeTokenStore", () => {
  let store: InMemoryResumeTokenStore

  beforeEach(() => {
    store = new InMemoryResumeTokenStore()
  })

  describe("store and retrieve", () => {
    it("stores and retrieves suspension info", async () => {
      const info = {
        reason: "Test",
        resumeToken: "token-123",
        tool: "TestTool",
        toolArgs: {},
        sessionId: "session-123",
        timestamp: Date.now(),
        previewData: { title: "Test", description: "Test", affectedItems: [] },
        availableActions: [],
      }

      await store.store("token-123", info)
      const retrieved = await store.retrieve("token-123")

      expect(retrieved).toEqual(info)
    })

    it("returns null for non-existent token", async () => {
      const result = await store.retrieve("non-existent")
      expect(result).toBeNull()
    })
  })

  describe("consume", () => {
    it("removes token from store", async () => {
      const info = {
        reason: "Test",
        resumeToken: "token-123",
        tool: "TestTool",
        toolArgs: {},
        sessionId: "session-123",
        timestamp: Date.now(),
        previewData: { title: "Test", description: "Test", affectedItems: [] },
        availableActions: [],
      }

      await store.store("token-123", info)
      const consumed = await store.consume("token-123")

      expect(consumed).toBe(true)
      expect(await store.retrieve("token-123")).toBeNull()
    })

    it("returns false for non-existent token", async () => {
      const consumed = await store.consume("non-existent")
      expect(consumed).toBe(false)
    })
  })

  describe("cleanup", () => {
    it("removes expired tokens", async () => {
      const oldInfo = {
        reason: "Old",
        resumeToken: "old-token",
        tool: "TestTool",
        toolArgs: {},
        sessionId: "session-123",
        timestamp: Date.now() - 60000, // 1 minute ago
        previewData: { title: "Test", description: "Test", affectedItems: [] },
        availableActions: [],
      }

      const newInfo = {
        reason: "New",
        resumeToken: "new-token",
        tool: "TestTool",
        toolArgs: {},
        sessionId: "session-123",
        timestamp: Date.now(),
        previewData: { title: "Test", description: "Test", affectedItems: [] },
        availableActions: [],
      }

      await store.store("old-token", oldInfo)
      await store.store("new-token", newInfo)

      const cleaned = await store.cleanup(30000) // 30 seconds

      expect(cleaned).toBe(1)
      expect(await store.retrieve("old-token")).toBeNull()
      expect(await store.retrieve("new-token")).not.toBeNull()
    })
  })

  describe("getAll and clear", () => {
    it("getAll returns all stored tokens", async () => {
      const info1 = {
        reason: "Test 1",
        resumeToken: "token-1",
        tool: "Tool1",
        toolArgs: {},
        sessionId: "session-1",
        timestamp: Date.now(),
        previewData: { title: "Test", description: "Test", affectedItems: [] },
        availableActions: [],
      }

      const info2 = {
        reason: "Test 2",
        resumeToken: "token-2",
        tool: "Tool2",
        toolArgs: {},
        sessionId: "session-2",
        timestamp: Date.now(),
        previewData: { title: "Test", description: "Test", affectedItems: [] },
        availableActions: [],
      }

      await store.store("token-1", info1)
      await store.store("token-2", info2)

      const all = store.getAll()
      expect(all.size).toBe(2)
      expect(all.get("token-1")).toEqual(info1)
      expect(all.get("token-2")).toEqual(info2)
    })

    it("clear removes all tokens", async () => {
      const info = {
        reason: "Test",
        resumeToken: "token",
        tool: "Tool",
        toolArgs: {},
        sessionId: "session",
        timestamp: Date.now(),
        previewData: { title: "Test", description: "Test", affectedItems: [] },
        availableActions: [],
      }

      await store.store("token-1", info)
      await store.store("token-2", info)

      store.clear()

      expect(store.getAll().size).toBe(0)
    })
  })
})

describe("ResumeHandler", () => {
  let store: InMemoryResumeTokenStore
  let handler: ResumeHandler

  beforeEach(() => {
    store = new InMemoryResumeTokenStore()
    handler = new ResumeHandler(store)
  })

  function createTestException(): SuspendException {
    return new SuspendException({
      reason: "Test suspension",
      tool: "TestTool",
      toolArgs: { command: "test" },
      sessionId: "session-123",
      previewData: { title: "Test", description: "Test", affectedItems: [] },
      availableActions: [
        { type: "approve", label: "Approve" },
        { type: "reject", label: "Reject" },
        { type: "modify", label: "Modify", modifyPrompt: "Enter new args" },
        { type: "defer", label: "Defer" },
      ],
    })
  }

  describe("registerSuspension", () => {
    it("stores suspension and sets state to pending_approval", async () => {
      const exception = createTestException()
      await handler.registerSuspension(exception)

      const state = handler.getState(exception.suspendInfo.resumeToken)
      expect(state).toBe("pending_approval")

      const stored = await store.retrieve(exception.suspendInfo.resumeToken)
      expect(stored).toBeDefined()
    })
  })

  describe("processResume - approve", () => {
    it("resumes with original args on approve", async () => {
      const exception = createTestException()
      await handler.registerSuspension(exception)

      const result = await handler.processResume({
        resumeToken: exception.suspendInfo.resumeToken,
        action: "approve",
      })

      expect(result.success).toBe(true)
      expect(result.state).toBe("resumed")
      expect(result.resolvedArgs).toEqual({ command: "test" })
    })

    it("consumes token after approve", async () => {
      const exception = createTestException()
      await handler.registerSuspension(exception)

      await handler.processResume({
        resumeToken: exception.suspendInfo.resumeToken,
        action: "approve",
      })

      const stored = await store.retrieve(exception.suspendInfo.resumeToken)
      expect(stored).toBeNull()
    })
  })

  describe("processResume - modify", () => {
    it("resumes with modified args", async () => {
      const exception = createTestException()
      await handler.registerSuspension(exception)

      const modifiedArgs = { command: "modified-test" }
      const result = await handler.processResume({
        resumeToken: exception.suspendInfo.resumeToken,
        action: "modify",
        modifiedArgs,
      })

      expect(result.success).toBe(true)
      expect(result.state).toBe("resumed")
      expect(result.resolvedArgs).toEqual(modifiedArgs)
    })

    it("fails if modifiedArgs not provided", async () => {
      const exception = createTestException()
      await handler.registerSuspension(exception)

      const result = await handler.processResume({
        resumeToken: exception.suspendInfo.resumeToken,
        action: "modify",
      })

      expect(result.success).toBe(false)
      expect(result.error).toContain("Modified args required")
    })
  })

  describe("processResume - reject", () => {
    it("marks as cancelled on reject", async () => {
      const exception = createTestException()
      await handler.registerSuspension(exception)

      const result = await handler.processResume({
        resumeToken: exception.suspendInfo.resumeToken,
        action: "reject",
      })

      expect(result.success).toBe(true)
      expect(result.state).toBe("cancelled")
    })
  })

  describe("processResume - defer", () => {
    it("keeps in pending_approval on defer", async () => {
      const exception = createTestException()
      await handler.registerSuspension(exception)

      const result = await handler.processResume({
        resumeToken: exception.suspendInfo.resumeToken,
        action: "defer",
      })

      expect(result.success).toBe(true)
      expect(result.state).toBe("deferred")

      // Should still be pending
      const state = handler.getState(exception.suspendInfo.resumeToken)
      expect(state).toBe("pending_approval")
    })
  })

  describe("processResume - error cases", () => {
    it("fails for invalid token", async () => {
      const result = await handler.processResume({
        resumeToken: "invalid-token",
        action: "approve",
      })

      expect(result.success).toBe(false)
      expect(result.error).toContain("Invalid or expired")
    })

    it("fails for unavailable action", async () => {
      const exception = new SuspendException({
        reason: "Test",
        tool: "Tool",
        toolArgs: {},
        sessionId: "session",
        previewData: { title: "Test", description: "Test", affectedItems: [] },
        availableActions: [{ type: "approve", label: "OK" }], // Only approve available
      })
      await handler.registerSuspension(exception)

      const result = await handler.processResume({
        resumeToken: exception.suspendInfo.resumeToken,
        action: "reject", // Not available
      })

      expect(result.success).toBe(false)
      expect(result.error).toContain("not available")
    })

    it("fails to resume already consumed token", async () => {
      const exception = createTestException()
      await handler.registerSuspension(exception)

      // First resume
      await handler.processResume({
        resumeToken: exception.suspendInfo.resumeToken,
        action: "approve",
      })

      // Second attempt
      const result = await handler.processResume({
        resumeToken: exception.suspendInfo.resumeToken,
        action: "approve",
      })

      expect(result.success).toBe(false)
    })
  })

  describe("toApprovalResult", () => {
    it("converts resumed state to approved", async () => {
      const exception = createTestException()
      await handler.registerSuspension(exception)

      const result = await handler.processResume({
        resumeToken: exception.suspendInfo.resumeToken,
        action: "approve",
      })

      const approvalResult = handler.toApprovalResult(result, 1000)
      expect(approvalResult.decision).toBe("approved")
      expect(approvalResult.decisionTimeMs).toBe(1000)
    })

    it("converts modified args to modified decision", async () => {
      const exception = createTestException()
      await handler.registerSuspension(exception)

      const result = await handler.processResume({
        resumeToken: exception.suspendInfo.resumeToken,
        action: "modify",
        modifiedArgs: { newArg: true },
      })

      const approvalResult = handler.toApprovalResult(result, 500)
      expect(approvalResult.decision).toBe("modified")
      expect(approvalResult.modifiedArgs).toEqual({ newArg: true })
    })
  })

  describe("isPending", () => {
    it("returns true for pending suspension", async () => {
      const exception = createTestException()
      await handler.registerSuspension(exception)

      const pending = await handler.isPending(exception.suspendInfo.resumeToken)
      expect(pending).toBe(true)
    })

    it("returns false after resume", async () => {
      const exception = createTestException()
      await handler.registerSuspension(exception)

      await handler.processResume({
        resumeToken: exception.suspendInfo.resumeToken,
        action: "approve",
      })

      const pending = await handler.isPending(exception.suspendInfo.resumeToken)
      expect(pending).toBe(false)
    })
  })

  describe("getPendingForSession", () => {
    it("returns all pending suspensions for a session", async () => {
      const ex1 = new SuspendException({
        reason: "Test 1",
        tool: "Tool1",
        toolArgs: {},
        sessionId: "session-A",
        previewData: { title: "Test", description: "Test", affectedItems: [] },
        availableActions: [{ type: "approve", label: "OK" }],
      })
      const ex2 = new SuspendException({
        reason: "Test 2",
        tool: "Tool2",
        toolArgs: {},
        sessionId: "session-A",
        previewData: { title: "Test", description: "Test", affectedItems: [] },
        availableActions: [{ type: "approve", label: "OK" }],
      })
      const ex3 = new SuspendException({
        reason: "Test 3",
        tool: "Tool3",
        toolArgs: {},
        sessionId: "session-B", // Different session
        previewData: { title: "Test", description: "Test", affectedItems: [] },
        availableActions: [{ type: "approve", label: "OK" }],
      })

      await handler.registerSuspension(ex1)
      await handler.registerSuspension(ex2)
      await handler.registerSuspension(ex3)

      const pendingA = await handler.getPendingForSession("session-A")
      expect(pendingA).toHaveLength(2)

      const pendingB = await handler.getPendingForSession("session-B")
      expect(pendingB).toHaveLength(1)
    })
  })
})
