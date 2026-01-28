import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import {
  ProposalQueue,
  IsolationManager,
  createSandboxedContext,
  executeIsolatedHook,
  getIsolationManager,
  hasIsolationManager,
  removeIsolationManager,
  resetIsolationManagers,
  type CreateSandboxedContextOptions,
} from "./isolation"
import {
  DEFAULT_ISOLATION_CONFIG,
  DEFAULT_PERMISSIONS,
  HookPermissionError,
  HookTimeoutError,
  ProposalError,
  isAtLeastAsTrusted,
  getTrustLevelRank,
  type HookDefinition,
  type HookPermissions,
  type SessionState,
  type StateProposal,
  type SandboxedHookContext,
} from "./isolation-types"
import { resetLedgerManager } from "./ledger"

// ============================================================================
// Test Fixtures
// ============================================================================

function createTestHook(overrides: Partial<HookDefinition> = {}): HookDefinition {
  return {
    name: "test-hook",
    namespace: "test",
    event: "test.event",
    permissions: {
      trustLevel: "plugin",
      writeNamespaces: ["test"],
      readableGlobals: "*",
      allowedTools: "*",
      timeoutMs: 5000,
    },
    ...overrides,
  }
}

function createTestSessionState(overrides: Partial<SessionState> = {}): SessionState {
  return {
    sessionId: "test-session",
    task: "Test task",
    plan: { steps: ["step1", "step2"] },
    ...overrides,
  }
}

function createTestContextOptions(
  overrides: Partial<CreateSandboxedContextOptions> = {}
): CreateSandboxedContextOptions {
  return {
    hook: createTestHook(),
    sessionState: createTestSessionState(),
    scopedStorage: new Map(),
    proposalQueue: new ProposalQueue(),
    toolInvoker: vi.fn().mockResolvedValue({ result: "ok" }),
    availableTools: ["Read", "Write", "Bash"],
    onEvent: vi.fn(),
    ...overrides,
  }
}

// ============================================================================
// Trust Level Tests
// ============================================================================

describe("Trust Levels", () => {
  describe("getTrustLevelRank", () => {
    it("ranks core as highest (0)", () => {
      expect(getTrustLevelRank("core")).toBe(0)
    })

    it("ranks plugin as middle (1)", () => {
      expect(getTrustLevelRank("plugin")).toBe(1)
    })

    it("ranks external as lowest (2)", () => {
      expect(getTrustLevelRank("external")).toBe(2)
    })
  })

  describe("isAtLeastAsTrusted", () => {
    it("core is at least as trusted as core", () => {
      expect(isAtLeastAsTrusted("core", "core")).toBe(true)
    })

    it("core is at least as trusted as plugin", () => {
      expect(isAtLeastAsTrusted("core", "plugin")).toBe(true)
    })

    it("plugin is not as trusted as core", () => {
      expect(isAtLeastAsTrusted("plugin", "core")).toBe(false)
    })

    it("external is not as trusted as plugin", () => {
      expect(isAtLeastAsTrusted("external", "plugin")).toBe(false)
    })
  })
})

// ============================================================================
// Proposal Queue Tests
// ============================================================================

describe("ProposalQueue", () => {
  let queue: ProposalQueue

  beforeEach(() => {
    queue = new ProposalQueue()
  })

  describe("submit", () => {
    it("creates proposal with id and timestamp", () => {
      const id = queue.submit(
        {
          submitter: "test-hook",
          type: "write",
          namespace: "shared",
          key: "foo",
          value: "bar",
          rationale: "test",
          priority: "normal",
        },
        "plugin"
      )

      expect(id).toMatch(/^prop-/)

      const proposal = queue.get(id)
      expect(proposal).toBeDefined()
      expect(proposal?.timestamp).toBeDefined()
      expect(proposal?.status).toBe("pending")
    })

    it("auto-approves from core trust", () => {
      const id = queue.submit(
        {
          submitter: "core-hook",
          type: "write",
          namespace: "shared",
          key: "foo",
          value: "bar",
          rationale: "test",
          priority: "normal",
        },
        "core"
      )

      expect(queue.getStatus(id)).toBe("applied")
    })

    it("emits proposal-submitted event", () => {
      const handler = vi.fn()
      queue.on("proposal-submitted", handler)

      queue.submit(
        {
          submitter: "test-hook",
          type: "write",
          namespace: "shared",
          key: "foo",
          value: "bar",
          rationale: "test",
          priority: "normal",
        },
        "plugin"
      )

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "proposal-submitted",
          submitter: "test-hook",
        })
      )
    })
  })

  describe("apply", () => {
    it("applies pending proposal", () => {
      const id = queue.submit(
        {
          submitter: "test-hook",
          type: "write",
          namespace: "shared",
          key: "foo",
          value: "bar",
          rationale: "test",
          priority: "normal",
        },
        "plugin"
      )

      const applied = queue.apply(id, "reviewer")

      expect(applied.status).toBe("applied")
      expect(queue.getStatus(id)).toBe("applied")
    })

    it("throws for non-existent proposal", () => {
      expect(() => queue.apply("nonexistent", "reviewer")).toThrow(ProposalError)
    })

    it("throws for already applied proposal", () => {
      const id = queue.submit(
        {
          submitter: "test-hook",
          type: "write",
          namespace: "shared",
          key: "foo",
          value: "bar",
          rationale: "test",
          priority: "normal",
        },
        "plugin"
      )

      queue.apply(id, "reviewer")

      expect(() => queue.apply(id, "reviewer")).toThrow(ProposalError)
    })

    it("emits proposal-applied event", () => {
      const handler = vi.fn()
      queue.on("proposal-applied", handler)

      const id = queue.submit(
        {
          submitter: "test-hook",
          type: "write",
          namespace: "shared",
          key: "foo",
          value: "bar",
          rationale: "test",
          priority: "normal",
        },
        "plugin"
      )

      queue.apply(id, "reviewer")

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "proposal-applied",
          proposalId: id,
        })
      )
    })
  })

  describe("reject", () => {
    it("rejects pending proposal", () => {
      const id = queue.submit(
        {
          submitter: "test-hook",
          type: "write",
          namespace: "shared",
          key: "foo",
          value: "bar",
          rationale: "test",
          priority: "normal",
        },
        "plugin"
      )

      queue.reject(id, "Not allowed", "reviewer")

      expect(queue.getStatus(id)).toBe("rejected")
    })

    it("stores rejection reason", () => {
      const id = queue.submit(
        {
          submitter: "test-hook",
          type: "write",
          namespace: "shared",
          key: "foo",
          value: "bar",
          rationale: "test",
          priority: "normal",
        },
        "plugin"
      )

      queue.reject(id, "Policy violation", "reviewer")

      const rejection = queue.getRejection(id)
      expect(rejection?.reason).toBe("Policy violation")
    })

    it("emits proposal-rejected event", () => {
      const handler = vi.fn()
      queue.on("proposal-rejected", handler)

      const id = queue.submit(
        {
          submitter: "test-hook",
          type: "write",
          namespace: "shared",
          key: "foo",
          value: "bar",
          rationale: "test",
          priority: "normal",
        },
        "plugin"
      )

      queue.reject(id, "Test reason", "reviewer")

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "proposal-rejected",
          proposalId: id,
          reason: "Test reason",
        })
      )
    })
  })

  describe("reviewPending", () => {
    it("returns pending proposals", () => {
      queue.submit(
        {
          submitter: "hook1",
          type: "write",
          namespace: "shared",
          key: "a",
          value: 1,
          rationale: "test",
          priority: "normal",
        },
        "plugin"
      )
      queue.submit(
        {
          submitter: "hook2",
          type: "write",
          namespace: "shared",
          key: "b",
          value: 2,
          rationale: "test",
          priority: "normal",
        },
        "plugin"
      )

      const pending = queue.reviewPending()

      expect(pending).toHaveLength(2)
    })

    it("excludes applied proposals", () => {
      const id = queue.submit(
        {
          submitter: "hook1",
          type: "write",
          namespace: "shared",
          key: "a",
          value: 1,
          rationale: "test",
          priority: "normal",
        },
        "plugin"
      )
      queue.apply(id, "reviewer")

      const pending = queue.reviewPending()

      expect(pending).toHaveLength(0)
    })
  })

  describe("cancel", () => {
    it("cancels pending proposal", () => {
      const id = queue.submit(
        {
          submitter: "test-hook",
          type: "write",
          namespace: "shared",
          key: "foo",
          value: "bar",
          rationale: "test",
          priority: "normal",
        },
        "plugin"
      )

      expect(queue.cancel(id)).toBe(true)
      expect(queue.getStatus(id)).toBe("rejected")
    })

    it("returns false for non-pending proposal", () => {
      const id = queue.submit(
        {
          submitter: "test-hook",
          type: "write",
          namespace: "shared",
          key: "foo",
          value: "bar",
          rationale: "test",
          priority: "normal",
        },
        "plugin"
      )

      queue.apply(id, "reviewer")

      expect(queue.cancel(id)).toBe(false)
    })
  })
})

// ============================================================================
// Sandboxed Context Tests
// ============================================================================

describe("createSandboxedContext", () => {
  describe("session state access", () => {
    it("allows reading permitted globals", () => {
      const options = createTestContextOptions()
      const ctx = createSandboxedContext(options)

      expect(ctx.sessionState.task).toBe("Test task")
    })

    it("prevents modification of session state", () => {
      const options = createTestContextOptions()
      const ctx = createSandboxedContext(options)

      expect(() => {
        ;(ctx.sessionState as any).task = "Modified"
      }).toThrow(HookPermissionError)
    })

    it("blocks reading non-permitted globals", () => {
      const options = createTestContextOptions({
        hook: createTestHook({
          permissions: {
            trustLevel: "external",
            writeNamespaces: ["test"],
            readableGlobals: ["task"], // Only task is readable
            allowedTools: [],
            timeoutMs: 5000,
          },
        }),
      })
      const ctx = createSandboxedContext(options)

      expect(() => {
        const _ = ctx.sessionState.plan
      }).toThrow(HookPermissionError)
    })

    it("emits permission-denied event on violation", () => {
      const onEvent = vi.fn()
      const options = createTestContextOptions({
        hook: createTestHook({
          permissions: {
            trustLevel: "external",
            writeNamespaces: ["test"],
            readableGlobals: [],
            allowedTools: [],
            timeoutMs: 5000,
          },
        }),
        onEvent,
      })
      const ctx = createSandboxedContext(options)

      try {
        const _ = ctx.sessionState.task
      } catch {
        // expected
      }

      expect(onEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "permission-denied",
          action: "read",
        })
      )
    })
  })

  describe("scoped state", () => {
    it("allows writing to scoped state", () => {
      const options = createTestContextOptions()
      const ctx = createSandboxedContext(options)

      ctx.scopedState.set("key1", "value1")

      expect(ctx.scopedState.get("key1")).toBe("value1")
    })

    it("isolates state by namespace", () => {
      const storage = new Map<string, unknown>()

      const ctx1 = createSandboxedContext(
        createTestContextOptions({
          hook: createTestHook({ namespace: "hook1" }),
          scopedStorage: storage,
        })
      )

      const ctx2 = createSandboxedContext(
        createTestContextOptions({
          hook: createTestHook({ namespace: "hook2" }),
          scopedStorage: storage,
        })
      )

      ctx1.scopedState.set("shared-key", "value1")
      ctx2.scopedState.set("shared-key", "value2")

      expect(ctx1.scopedState.get("shared-key")).toBe("value1")
      expect(ctx2.scopedState.get("shared-key")).toBe("value2")
    })

    it("lists keys in namespace", () => {
      const options = createTestContextOptions()
      const ctx = createSandboxedContext(options)

      ctx.scopedState.set("a", 1)
      ctx.scopedState.set("b", 2)

      expect(ctx.scopedState.keys()).toEqual(["a", "b"])
    })

    it("deletes from namespace", () => {
      const options = createTestContextOptions()
      const ctx = createSandboxedContext(options)

      ctx.scopedState.set("key", "value")
      expect(ctx.scopedState.has("key")).toBe(true)

      ctx.scopedState.delete("key")
      expect(ctx.scopedState.has("key")).toBe(false)
    })

    it("clears namespace", () => {
      const options = createTestContextOptions()
      const ctx = createSandboxedContext(options)

      ctx.scopedState.set("a", 1)
      ctx.scopedState.set("b", 2)
      ctx.scopedState.clear()

      expect(ctx.scopedState.keys()).toHaveLength(0)
    })
  })

  describe("tool invoker", () => {
    it("allows invoking permitted tools", async () => {
      const invoker = vi.fn().mockResolvedValue({ data: "result" })
      const options = createTestContextOptions({ toolInvoker: invoker })
      const ctx = createSandboxedContext(options)

      const result = await ctx.tools.invoke("Read", { path: "/test" })

      expect(invoker).toHaveBeenCalledWith("Read", { path: "/test" })
      expect(result).toEqual({ data: "result" })
    })

    it("blocks non-permitted tools", async () => {
      const options = createTestContextOptions({
        hook: createTestHook({
          permissions: {
            trustLevel: "plugin",
            writeNamespaces: ["test"],
            readableGlobals: "*",
            allowedTools: ["Read"], // Only Read allowed
            timeoutMs: 5000,
          },
        }),
      })
      const ctx = createSandboxedContext(options)

      await expect(ctx.tools.invoke("Bash", { command: "ls" })).rejects.toThrow(
        HookPermissionError
      )
    })

    it("reports allowed tools", () => {
      const options = createTestContextOptions({
        hook: createTestHook({
          permissions: {
            trustLevel: "plugin",
            writeNamespaces: ["test"],
            readableGlobals: "*",
            allowedTools: ["Read", "Grep"],
            timeoutMs: 5000,
          },
        }),
      })
      const ctx = createSandboxedContext(options)

      expect(ctx.tools.isAllowed("Read")).toBe(true)
      expect(ctx.tools.isAllowed("Bash")).toBe(false)
      expect(ctx.tools.listAllowed()).toEqual(["Read", "Grep"])
    })
  })

  describe("proposals", () => {
    it("submits proposals to queue", () => {
      const queue = new ProposalQueue()
      const options = createTestContextOptions({ proposalQueue: queue })
      const ctx = createSandboxedContext(options)

      const id = ctx.proposals.submit({
        type: "write",
        namespace: "shared",
        key: "test",
        value: 123,
        rationale: "Testing",
        priority: "normal",
      })

      expect(queue.get(id)).toBeDefined()
      expect(queue.get(id)?.submitter).toBe("test-hook")
    })

    it("checks proposal status", () => {
      const queue = new ProposalQueue()
      const options = createTestContextOptions({ proposalQueue: queue })
      const ctx = createSandboxedContext(options)

      const id = ctx.proposals.submit({
        type: "write",
        namespace: "shared",
        key: "test",
        value: 123,
        rationale: "Testing",
        priority: "normal",
      })

      expect(ctx.proposals.getStatus(id)).toBe("pending")
    })

    it("cancels own proposals", () => {
      const queue = new ProposalQueue()
      const options = createTestContextOptions({ proposalQueue: queue })
      const ctx = createSandboxedContext(options)

      const id = ctx.proposals.submit({
        type: "write",
        namespace: "shared",
        key: "test",
        value: 123,
        rationale: "Testing",
        priority: "normal",
      })

      expect(ctx.proposals.cancel(id)).toBe(true)
      expect(ctx.proposals.getStatus(id)).toBe("rejected")
    })
  })

  describe("logger", () => {
    it("provides scoped logger", () => {
      const options = createTestContextOptions()
      const ctx = createSandboxedContext(options)

      // Just verify logger methods exist
      expect(typeof ctx.logger.debug).toBe("function")
      expect(typeof ctx.logger.info).toBe("function")
      expect(typeof ctx.logger.warn).toBe("function")
      expect(typeof ctx.logger.error).toBe("function")
    })
  })
})

// ============================================================================
// Hook Execution Tests
// ============================================================================

describe("executeIsolatedHook", () => {
  it("executes hook successfully", async () => {
    const hook = createTestHook()
    const options = createTestContextOptions()
    const ctx = createSandboxedContext(options)

    const result = await executeIsolatedHook(
      hook,
      ctx,
      async () => "success",
      vi.fn()
    )

    expect(result).toBe("success")
  })

  it("times out slow hooks", async () => {
    const hook = createTestHook({
      permissions: {
        trustLevel: "plugin",
        writeNamespaces: ["test"],
        readableGlobals: "*",
        allowedTools: "*",
        timeoutMs: 50, // Very short timeout
      },
    })
    const options = createTestContextOptions()
    const ctx = createSandboxedContext(options)
    const onEvent = vi.fn()

    await expect(
      executeIsolatedHook(
        hook,
        ctx,
        async () => {
          await new Promise((resolve) => setTimeout(resolve, 200))
          return "done"
        },
        onEvent
      )
    ).rejects.toThrow(HookTimeoutError)

    expect(onEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "hook-timeout",
        hook: "test-hook",
      })
    )
  })

  it("propagates hook errors", async () => {
    const hook = createTestHook()
    const options = createTestContextOptions()
    const ctx = createSandboxedContext(options)

    await expect(
      executeIsolatedHook(
        hook,
        ctx,
        async () => {
          throw new Error("Hook failed")
        },
        vi.fn()
      )
    ).rejects.toThrow("Hook failed")
  })
})

// ============================================================================
// Isolation Manager Tests
// ============================================================================

describe("IsolationManager", () => {
  let manager: IsolationManager

  beforeEach(() => {
    manager = new IsolationManager("test-session", { enabled: true })
  })

  afterEach(() => {
    resetIsolationManagers()
    resetLedgerManager()
  })

  describe("getEffectivePermissions", () => {
    it("returns hook permissions with defaults", () => {
      const hook = createTestHook()

      const permissions = manager.getEffectivePermissions(hook)

      expect(permissions.trustLevel).toBe("plugin")
      expect(permissions.writeNamespaces).toContain("test")
    })

    it("applies trust override", () => {
      manager = new IsolationManager("test-session", {
        enabled: true,
        trustOverrides: { "test-hook": "external" },
      })
      const hook = createTestHook()

      const permissions = manager.getEffectivePermissions(hook)

      expect(permissions.trustLevel).toBe("external")
    })

    it("applies permission override", () => {
      manager = new IsolationManager("test-session", {
        enabled: true,
        permissionOverrides: {
          "test-hook": { timeoutMs: 1000 },
        },
      })
      const hook = createTestHook()

      const permissions = manager.getEffectivePermissions(hook)

      expect(permissions.timeoutMs).toBe(1000)
    })

    it("ensures own namespace is writable", () => {
      const hook = createTestHook({
        permissions: {
          trustLevel: "external",
          writeNamespaces: [], // Empty
          readableGlobals: [],
          allowedTools: [],
          timeoutMs: 5000,
        },
      })

      const permissions = manager.getEffectivePermissions(hook)

      expect(permissions.writeNamespaces).toContain("test")
    })
  })

  describe("executeHook", () => {
    it("executes hook with isolation", async () => {
      const hook = createTestHook()
      const state = createTestSessionState()

      const result = await manager.executeHook(
        hook,
        state,
        async (ctx) => {
          ctx.scopedState.set("executed", true)
          return "done"
        },
        vi.fn().mockResolvedValue({}),
        ["Read"]
      )

      expect(result).toBe("done")
    })

    it("skips isolation when disabled", async () => {
      manager = new IsolationManager("test-session", { enabled: false })
      const hook = createTestHook({
        permissions: {
          trustLevel: "plugin",
          writeNamespaces: [],
          readableGlobals: [], // Should fail if isolation enabled
          allowedTools: [],
          timeoutMs: 5000,
        },
      })
      const state = createTestSessionState()

      // This should work because isolation is disabled
      const result = await manager.executeHook(
        hook,
        state,
        async (ctx) => {
          // In non-isolated mode, this still works via proxy
          // but we're just testing it doesn't throw
          return "done"
        },
        vi.fn().mockResolvedValue({}),
        []
      )

      expect(result).toBe("done")
    })
  })

  describe("processPendingProposals", () => {
    it("approves and applies proposals", () => {
      const hook = createTestHook()
      const state = createTestSessionState()
      const ctx = manager.createContext(
        hook,
        state,
        vi.fn().mockResolvedValue({}),
        []
      )

      ctx.proposals.submit({
        type: "write",
        namespace: "shared",
        key: "test",
        value: 123,
        rationale: "test",
        priority: "normal",
      })

      const results = manager.processPendingProposals(() => true)

      expect(results).toHaveLength(1)
      expect(results[0].applied).toBe(true)
    })

    it("rejects proposals when approver returns false", () => {
      const hook = createTestHook()
      const state = createTestSessionState()
      const ctx = manager.createContext(
        hook,
        state,
        vi.fn().mockResolvedValue({}),
        []
      )

      ctx.proposals.submit({
        type: "write",
        namespace: "shared",
        key: "test",
        value: 123,
        rationale: "test",
        priority: "normal",
      })

      const results = manager.processPendingProposals(() => false)

      expect(results[0].applied).toBe(false)
    })
  })

  describe("state management", () => {
    it("gets shared state after proposal applied", () => {
      const hook = createTestHook()
      const state = createTestSessionState()
      const ctx = manager.createContext(
        hook,
        state,
        vi.fn().mockResolvedValue({}),
        []
      )

      ctx.proposals.submit({
        type: "write",
        namespace: "shared",
        key: "test",
        value: { data: "value" },
        rationale: "test",
        priority: "normal",
      })

      manager.processPendingProposals(() => true)

      const value = manager.getSharedState("shared", "test")
      expect(value).toEqual({ data: "value" })
    })

    it("gets scoped state for namespace", () => {
      const hook = createTestHook({ namespace: "myns" })
      const state = createTestSessionState()
      const ctx = manager.createContext(
        hook,
        state,
        vi.fn().mockResolvedValue({}),
        []
      )

      ctx.scopedState.set("key1", "value1")
      ctx.scopedState.set("key2", "value2")

      const scoped = manager.getScopedState("myns")

      expect(scoped.get("key1")).toBe("value1")
      expect(scoped.get("key2")).toBe("value2")
    })

    it("clears scoped state for namespace", () => {
      const hook = createTestHook({ namespace: "myns" })
      const state = createTestSessionState()
      const ctx = manager.createContext(
        hook,
        state,
        vi.fn().mockResolvedValue({}),
        []
      )

      ctx.scopedState.set("key", "value")

      manager.clearScopedState("myns")

      expect(ctx.scopedState.has("key")).toBe(false)
    })

    it("resets all state", () => {
      const hook = createTestHook()
      const state = createTestSessionState()
      const ctx = manager.createContext(
        hook,
        state,
        vi.fn().mockResolvedValue({}),
        []
      )

      ctx.scopedState.set("key", "value")

      manager.reset()

      expect(ctx.scopedState.has("key")).toBe(false)
    })
  })

  describe("events", () => {
    it("emits permission-denied on violation", async () => {
      const handler = vi.fn()
      manager.on("permission-denied", handler)

      const hook = createTestHook({
        permissions: {
          trustLevel: "external",
          writeNamespaces: ["test"],
          readableGlobals: [],
          allowedTools: [],
          timeoutMs: 5000,
        },
      })
      const state = createTestSessionState()
      const ctx = manager.createContext(
        hook,
        state,
        vi.fn().mockResolvedValue({}),
        []
      )

      try {
        const _ = ctx.sessionState.task
      } catch {
        // expected
      }

      expect(handler).toHaveBeenCalled()
    })
  })
})

// ============================================================================
// Singleton Tests
// ============================================================================

describe("Isolation Manager Singleton", () => {
  afterEach(() => {
    resetIsolationManagers()
  })

  it("creates manager for session", () => {
    const manager = getIsolationManager("session-1")

    expect(manager).toBeInstanceOf(IsolationManager)
    expect(hasIsolationManager("session-1")).toBe(true)
  })

  it("returns same manager for same session", () => {
    const manager1 = getIsolationManager("session-1")
    const manager2 = getIsolationManager("session-1")

    expect(manager1).toBe(manager2)
  })

  it("removes manager", () => {
    getIsolationManager("session-1")

    expect(removeIsolationManager("session-1")).toBe(true)
    expect(hasIsolationManager("session-1")).toBe(false)
  })

  it("resets all managers", () => {
    getIsolationManager("session-1")
    getIsolationManager("session-2")

    resetIsolationManagers()

    expect(hasIsolationManager("session-1")).toBe(false)
    expect(hasIsolationManager("session-2")).toBe(false)
  })
})
