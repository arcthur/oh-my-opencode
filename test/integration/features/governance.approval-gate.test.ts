import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test"
import type { PluginInput } from "@opencode-ai/plugin"
import { mkdtempSync, rmSync, existsSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createApprovalGateHook, type ApprovalGateConfig } from "../../../src/features/governance/approval-gate"
import { ToolCriticalityRegistry, resetToolCriticalityRegistry } from "../../../src/features/governance/tool-criticality"
import { InMemoryResumeTokenStore } from "../../../src/features/governance/suspend-exception"
import { resetLedgerManager } from "../../../src/features/governance/ledger"

let testLedgerDir = ""

// Mock PluginInput
const mockCtx = {
  directory: "/test/project",
  client: {
    session: {
      messages: mock(async () => ({ data: [] })),
    },
  },
} as unknown as PluginInput

describe("ApprovalGateHook", () => {
  let config: ApprovalGateConfig
  let registry: ToolCriticalityRegistry
  let tokenStore: InMemoryResumeTokenStore

  beforeEach(() => {
    testLedgerDir = mkdtempSync(join(tmpdir(), "approval-gate-test-ledger-"))
    // Clean up test directory
    if (existsSync(testLedgerDir)) {
      rmSync(testLedgerDir, { recursive: true })
    }
    mkdirSync(testLedgerDir, { recursive: true })

    registry = new ToolCriticalityRegistry()
    tokenStore = new InMemoryResumeTokenStore()
    config = {
      enabled: true,
      registry,
      tokenStore,
      enableLedger: true,
      ledgerBaseDir: testLedgerDir,
    }
  })

  afterEach(() => {
    resetToolCriticalityRegistry()
    resetLedgerManager()
    if (existsSync(testLedgerDir)) {
      rmSync(testLedgerDir, { recursive: true })
    }
  })

  describe("tool.execute.before", () => {
    it("allows non-critical tools to pass through", async () => {
      const hook = createApprovalGateHook(mockCtx, config)

      const input = { tool: "Read", sessionID: "session-1", callID: "call-1" }
      const output = { args: { file_path: "/test/file.ts" } }

      await hook["tool.execute.before"](input, output)

      expect(output.skip).toBeUndefined()
      expect(output.message).toBeUndefined()
    })

    it("suspends critical Bash commands", async () => {
      const hook = createApprovalGateHook(mockCtx, config)

      const input = { tool: "Bash", sessionID: "session-1", callID: "call-1" }
      const output = { args: { command: "rm -rf /tmp/test" } }

      await hook["tool.execute.before"](input, output)

      expect(output.skip).toBe(true)
      expect(output.message).toContain("<approval-request")
      expect(output.message).toContain("Shell Command Execution")
    })

    it("allows non-critical Bash commands", async () => {
      const hook = createApprovalGateHook(mockCtx, config)

      const input = { tool: "Bash", sessionID: "session-1", callID: "call-1" }
      const output = { args: { command: "ls -la" } }

      await hook["tool.execute.before"](input, output)

      expect(output.skip).toBeUndefined()
    })

    it("suspends critical Task prompts with destructive keywords", async () => {
      const hook = createApprovalGateHook(mockCtx, config)

      const input = { tool: "Task", sessionID: "session-1", callID: "call-1" }
      const output = { args: { prompt: "Delete all files in the directory", subagent_type: "bash" } }

      await hook["tool.execute.before"](input, output)

      expect(output.skip).toBe(true)
      expect(output.message).toContain("<approval-request")
    })

    it("allows already approved operations in same session", async () => {
      const hook = createApprovalGateHook(mockCtx, config)

      const input = { tool: "Bash", sessionID: "session-1", callID: "call-1" }
      const output = { args: { command: "rm -rf /tmp/test" } }

      // First call - suspended
      await hook["tool.execute.before"](input, output)
      expect(output.skip).toBe(true)

      // Extract token from message
      const tokenMatch = output.message?.match(/token="([^"]+)"/)
      const token = tokenMatch?.[1]
      expect(token).toBeDefined()

      // Process approval
      const approvalResult = await hook.processApproval("session-1", token!, {
        decision: "approved",
        decisionTimeMs: 500,
      })
      expect(approvalResult.success).toBe(true)

      // Second call with same args - should pass through
      const output2 = { args: { command: "rm -rf /tmp/test" } }
      await hook["tool.execute.before"](input, output2)
      expect(output2.skip).toBeUndefined()
    })

    it("skips trusted sessions", async () => {
      const hookConfig = { ...config, trustedSessions: ["trusted-session"] }
      const hook = createApprovalGateHook(mockCtx, hookConfig)

      const input = { tool: "Bash", sessionID: "trusted-session", callID: "call-1" }
      const output = { args: { command: "rm -rf /tmp/test" } }

      await hook["tool.execute.before"](input, output)

      expect(output.skip).toBeUndefined()
    })

    it("skips tools matching skip patterns", async () => {
      const hookConfig = { ...config, skipPatterns: ["mcp__*"] }
      const hook = createApprovalGateHook(mockCtx, hookConfig)

      // Register a critical custom tool that matches pattern
      registry.register("mcp__custom_tool", {
        critical: true,
        reason: "Test",
        category: "external",
      })

      const input = { tool: "mcp__custom_tool", sessionID: "session-1", callID: "call-1" }
      const output = { args: {} }

      await hook["tool.execute.before"](input, output)

      expect(output.skip).toBeUndefined()
    })

    it("does nothing when disabled", async () => {
      const hookConfig = { ...config, enabled: false }
      const hook = createApprovalGateHook(mockCtx, hookConfig)

      const input = { tool: "Bash", sessionID: "session-1", callID: "call-1" }
      const output = { args: { command: "rm -rf /tmp/test" } }

      await hook["tool.execute.before"](input, output)

      expect(output.skip).toBeUndefined()
    })

    it("stores suspension token for later retrieval", async () => {
      const hook = createApprovalGateHook(mockCtx, config)

      const input = { tool: "Bash", sessionID: "session-1", callID: "call-1" }
      const output = { args: { command: "sudo rm -rf /" } }

      await hook["tool.execute.before"](input, output)

      // Extract token
      const tokenMatch = output.message?.match(/token="([^"]+)"/)
      const token = tokenMatch?.[1]

      // Token should be stored
      const storedInfo = await tokenStore.retrieve(token!)
      expect(storedInfo).not.toBeNull()
      expect(storedInfo?.tool).toBe("Bash")
    })
  })

  describe("processApproval", () => {
    it("handles approve decision", async () => {
      const hook = createApprovalGateHook(mockCtx, config)

      // Create a suspension first
      const input = { tool: "Bash", sessionID: "session-1", callID: "call-1" }
      const output = { args: { command: "rm -rf /test" } }
      await hook["tool.execute.before"](input, output)

      const tokenMatch = output.message?.match(/token="([^"]+)"/)
      const token = tokenMatch?.[1]!

      const result = await hook.processApproval("session-1", token, {
        decision: "approved",
        decisionTimeMs: 1000,
      })

      expect(result.success).toBe(true)

      // Token should be consumed
      const storedInfo = await tokenStore.retrieve(token)
      expect(storedInfo).toBeNull()
    })

    it("handles reject decision", async () => {
      const hook = createApprovalGateHook(mockCtx, config)

      const input = { tool: "Bash", sessionID: "session-1", callID: "call-1" }
      const output = { args: { command: "rm -rf /test" } }
      await hook["tool.execute.before"](input, output)

      const tokenMatch = output.message?.match(/token="([^"]+)"/)
      const token = tokenMatch?.[1]!

      const result = await hook.processApproval("session-1", token, {
        decision: "rejected",
        reason: "User canceled",
        decisionTimeMs: 500,
      })

      expect(result.success).toBe(true)

      // Subsequent call should still be blocked (not approved)
      const output2 = { args: { command: "rm -rf /test" } }
      await hook["tool.execute.before"](input, output2)
      expect(output2.skip).toBe(true)
    })

    it("handles modify decision", async () => {
      const hook = createApprovalGateHook(mockCtx, config)

      const input = { tool: "Bash", sessionID: "session-1", callID: "call-1" }
      const output = { args: { command: "rm -rf /tmp" } }
      await hook["tool.execute.before"](input, output)

      const tokenMatch = output.message?.match(/token="([^"]+)"/)
      const token = tokenMatch?.[1]!

      const modifiedArgs = { command: "rm -rf /tmp/safe-dir" }
      const result = await hook.processApproval("session-1", token, {
        decision: "modified",
        modifiedArgs,
        decisionTimeMs: 2000,
      })

      expect(result.success).toBe(true)

      // Original args should still be blocked
      const output2 = { args: { command: "rm -rf /tmp" } }
      await hook["tool.execute.before"](input, output2)
      expect(output2.skip).toBe(true)

      // Modified args should be allowed
      const output3 = { args: { command: "rm -rf /tmp/safe-dir" } }
      await hook["tool.execute.before"](input, output3)
      expect(output3.skip).toBeUndefined()
    })

    it("handles deferred decision", async () => {
      const hook = createApprovalGateHook(mockCtx, config)

      const input = { tool: "Bash", sessionID: "session-1", callID: "call-1" }
      const output = { args: { command: "rm -rf /test" } }
      await hook["tool.execute.before"](input, output)

      const tokenMatch = output.message?.match(/token="([^"]+)"/)
      const token = tokenMatch?.[1]!

      const result = await hook.processApproval("session-1", token, {
        decision: "deferred",
        decisionTimeMs: 100,
      })

      expect(result.success).toBe(true)

      // Token should still be valid (not consumed)
      const storedInfo = await tokenStore.retrieve(token)
      expect(storedInfo).not.toBeNull()
    })

    it("returns error for invalid token", async () => {
      const hook = createApprovalGateHook(mockCtx, config)

      const result = await hook.processApproval("session-1", "invalid-token", {
        decision: "approved",
        decisionTimeMs: 100,
      })

      expect(result.success).toBe(false)
      expect(result.error).toContain("Invalid or expired")
    })

    it("returns error for wrong session", async () => {
      const hook = createApprovalGateHook(mockCtx, config)

      // Create suspension in session-1
      const input = { tool: "Bash", sessionID: "session-1", callID: "call-1" }
      const output = { args: { command: "rm -rf /test" } }
      await hook["tool.execute.before"](input, output)

      const tokenMatch = output.message?.match(/token="([^"]+)"/)
      const token = tokenMatch?.[1]!

      // Try to process in session-2
      const result = await hook.processApproval("session-2", token, {
        decision: "approved",
        decisionTimeMs: 100,
      })

      expect(result.success).toBe(false)
      expect(result.error).toContain("does not belong to this session")
    })
  })

  describe("getPendingApprovals", () => {
    it("returns pending suspensions for session", async () => {
      const hook = createApprovalGateHook(mockCtx, config)

      // Create multiple suspensions
      await hook["tool.execute.before"](
        { tool: "Bash", sessionID: "session-1", callID: "call-1" },
        { args: { command: "rm -rf /a" } }
      )
      await hook["tool.execute.before"](
        { tool: "Bash", sessionID: "session-1", callID: "call-2" },
        { args: { command: "sudo rm -rf /b" } }
      )

      const pending = hook.getPendingApprovals("session-1")

      expect(pending).toHaveLength(2)
    })

    it("returns empty array for session without pending", () => {
      const hook = createApprovalGateHook(mockCtx, config)

      const pending = hook.getPendingApprovals("non-existent-session")

      expect(pending).toHaveLength(0)
    })
  })

  describe("blanket approval", () => {
    it("grantBlanketApproval allows all operations", async () => {
      const hook = createApprovalGateHook(mockCtx, config)

      hook.grantBlanketApproval("session-1")

      const input = { tool: "Bash", sessionID: "session-1", callID: "call-1" }
      const output = { args: { command: "rm -rf /" } }

      await hook["tool.execute.before"](input, output)

      expect(output.skip).toBeUndefined()
    })

    it("revokeBlanketApproval re-enables checks", async () => {
      const hook = createApprovalGateHook(mockCtx, config)

      hook.grantBlanketApproval("session-1")
      hook.revokeBlanketApproval("session-1")

      const input = { tool: "Bash", sessionID: "session-1", callID: "call-1" }
      const output = { args: { command: "rm -rf /" } }

      await hook["tool.execute.before"](input, output)

      expect(output.skip).toBe(true)
    })
  })

  describe("session lifecycle", () => {
    it("cleans up state on session deletion", async () => {
      const hook = createApprovalGateHook(mockCtx, config)

      // Create a suspension
      await hook["tool.execute.before"](
        { tool: "Bash", sessionID: "session-1", callID: "call-1" },
        { args: { command: "rm -rf /test" } }
      )

      expect(hook.getPendingApprovals("session-1")).toHaveLength(1)

      // Simulate session deletion
      await hook.event({
        event: {
          type: "session.deleted",
          properties: { info: { id: "session-1" } },
        },
      })

      expect(hook.getPendingApprovals("session-1")).toHaveLength(0)
    })
  })

  describe("ledger integration", () => {
    it("logs approval events to ledger", async () => {
      const hook = createApprovalGateHook(mockCtx, config)

      // Create and approve a suspension
      const input = { tool: "Bash", sessionID: "session-1", callID: "call-1" }
      const output = { args: { command: "rm -rf /test" } }
      await hook["tool.execute.before"](input, output)

      const tokenMatch = output.message?.match(/token="([^"]+)"/)
      const token = tokenMatch?.[1]!

      await hook.processApproval("session-1", token, {
        decision: "approved",
        decisionTimeMs: 500,
      })

      // Check ledger file exists
      const ledgerPath = `${testLedgerDir}/session-1.jsonl`
      expect(existsSync(ledgerPath)).toBe(true)
    })
  })
})
