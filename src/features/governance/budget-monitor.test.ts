import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import {
  BudgetMonitor,
  BudgetMonitorManager,
  getBudgetMonitorManager,
  resetBudgetMonitorManager,
  SimpleRefactorStrategy,
  type GarbageCollector,
  type TaskState,
} from "./budget-monitor"
import {
  BudgetExhaustedError,
  SessionForkRequiredError,
  generateConvergenceHint,
  DEFAULT_BUDGET_CONFIG,
} from "./budget-types"
import { resetLedgerManager } from "./ledger"

describe("BudgetMonitor", () => {
  let monitor: BudgetMonitor

  beforeEach(() => {
    monitor = new BudgetMonitor("test-session", {
      allocated: 10000, // 10k tokens for easier math
    })
  })

  afterEach(() => {
    resetBudgetMonitorManager()
    resetLedgerManager()
  })

  describe("basic consumption tracking", () => {
    it("tracks token consumption", async () => {
      await monitor.recordConsumption(1000)

      const status = monitor.getStatus()
      expect(status.consumed).toBe(1000)
      expect(status.remaining).toBe(9000)
      expect(status.percentage).toBe(0.1)
    })

    it("accumulates consumption", async () => {
      await monitor.recordConsumption(1000)
      await monitor.recordConsumption(2000)
      await monitor.recordConsumption(500)

      const status = monitor.getStatus()
      expect(status.consumed).toBe(3500)
      expect(status.percentage).toBe(0.35)
    })

    it("reports correct phase", async () => {
      // Healthy (< 50%)
      await monitor.recordConsumption(4000)
      expect(monitor.getStatus().phase).toBe("healthy")

      // Midpoint (50-70%)
      await monitor.recordConsumption(1500)
      expect(monitor.getStatus().phase).toBe("midpoint")

      // wrapUp (70-90%)
      await monitor.recordConsumption(2000)
      expect(monitor.getStatus().phase).toBe("wrapUp")
    })

    it("estimates remaining steps", async () => {
      // Record 5 steps with 1000 tokens each
      for (let i = 0; i < 5; i++) {
        await monitor.recordConsumption(1000)
      }

      const status = monitor.getStatus()
      // 5000 consumed, 5000 remaining, avg 1000 per step = 5 steps remaining
      expect(status.estimatedSteps).toBe(5)
    })
  })

  describe("budget phases", () => {
    it("returns healthy phase below 50%", async () => {
      await monitor.recordConsumption(4900)
      expect(monitor.getStatus().phase).toBe("healthy")
    })

    it("returns midpoint phase at 50-70%", async () => {
      await monitor.recordConsumption(5000)
      expect(monitor.getStatus().phase).toBe("midpoint")

      await monitor.recordConsumption(1900)
      expect(monitor.getStatus().phase).toBe("midpoint")
    })

    it("returns wrapUp phase at 70-90%", async () => {
      await monitor.recordConsumption(7000)
      expect(monitor.getStatus().phase).toBe("wrapUp")
    })

    it("returns critical phase above 90%", async () => {
      await monitor.recordConsumption(9100)
      expect(monitor.getStatus().phase).toBe("critical")
    })
  })

  describe("convergence hint", () => {
    it("returns null when healthy", async () => {
      await monitor.recordConsumption(4000)
      expect(monitor.getConvergenceHint()).toBeNull()
    })

    it("returns hint at warning threshold", async () => {
      await monitor.recordConsumption(7100)
      const hint = monitor.getConvergenceHint()

      expect(hint).not.toBeNull()
      expect(hint).toContain("Begin consolidating")
    })

    it("returns critical hint above 90%", async () => {
      await monitor.recordConsumption(9100)
      const hint = monitor.getConvergenceHint()

      expect(hint).toContain("Focus only on essential")
      expect(hint).toContain("IMPORTANT")
    })

    it("shouldInjectHint returns true at warning", async () => {
      await monitor.recordConsumption(6900)
      expect(monitor.shouldInjectHint()).toBe(false)

      await monitor.recordConsumption(200)
      expect(monitor.shouldInjectHint()).toBe(true)
    })
  })

  describe("events", () => {
    it("emits consumption event", async () => {
      const handler = vi.fn()
      monitor.on("consumption", handler)

      await monitor.recordConsumption(1000)

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "consumption",
          amount: 1000,
          total: 1000,
        })
      )
    })

    it("emits warning event at threshold", async () => {
      const handler = vi.fn()
      monitor.on("gc-triggered", handler)

      await monitor.recordConsumption(7100)

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "gc-triggered",
          percentage: expect.any(Number),
        })
      )
    })

    it("emits budget-event for all events", async () => {
      const handler = vi.fn()
      monitor.on("budget-event", handler)

      await monitor.recordConsumption(1000)

      expect(handler).toHaveBeenCalled()
    })
  })

  describe("hard limit", () => {
    it("throws BudgetExhaustedError at hard limit", async () => {
      await monitor.recordConsumption(9000)

      await expect(monitor.recordConsumption(600)).rejects.toThrow(BudgetExhaustedError)
    })

    it("includes budget info in error", async () => {
      await monitor.recordConsumption(9000)

      try {
        await monitor.recordConsumption(600)
      } catch (error) {
        expect(error).toBeInstanceOf(BudgetExhaustedError)
        const budgetError = error as BudgetExhaustedError
        expect(budgetError.consumed).toBe(9600)
        expect(budgetError.allocated).toBe(10000)
      }
    })

    it("emits hard-limit-reached event", async () => {
      const handler = vi.fn()
      monitor.on("hard-limit-reached", handler)

      await monitor.recordConsumption(9000)

      try {
        await monitor.recordConsumption(600)
      } catch {
        // expected
      }

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "hard-limit-reached",
        })
      )
    })
  })

  describe("garbage collection", () => {
    it("triggers GC at warning threshold", async () => {
      const mockGC: GarbageCollector = {
        collect: vi.fn().mockResolvedValue({
          freedTokens: 1000,
          removedItems: [{ type: "tool_output", count: 5 }],
          preservedItems: ["task_definition"],
          timestamp: Date.now(),
        }),
        estimateTokens: vi.fn().mockReturnValue(100),
      }

      const monitorWithGC = new BudgetMonitor("test", {
        allocated: 10000,
        garbageCollector: mockGC,
      })

      await monitorWithGC.recordConsumption(7100)

      expect(mockGC.collect).toHaveBeenCalled()
    })

    it("updates consumed tokens after GC", async () => {
      const mockGC: GarbageCollector = {
        collect: vi.fn().mockResolvedValue({
          freedTokens: 2000,
          removedItems: [],
          preservedItems: [],
          timestamp: Date.now(),
        }),
        estimateTokens: vi.fn().mockReturnValue(100),
      }

      const monitorWithGC = new BudgetMonitor("test", {
        allocated: 10000,
        garbageCollector: mockGC,
      })

      await monitorWithGC.recordConsumption(7100)

      const status = monitorWithGC.getStatus()
      // 7100 - 2000 = 5100
      expect(status.consumed).toBe(5100)
    })

    it("only triggers GC once", async () => {
      const mockGC: GarbageCollector = {
        collect: vi.fn().mockResolvedValue({
          freedTokens: 1000,
          removedItems: [],
          preservedItems: [],
          timestamp: Date.now(),
        }),
        estimateTokens: vi.fn().mockReturnValue(100),
      }

      const monitorWithGC = new BudgetMonitor("test", {
        allocated: 10000,
        garbageCollector: mockGC,
      })

      await monitorWithGC.recordConsumption(7100)
      await monitorWithGC.recordConsumption(500)
      await monitorWithGC.recordConsumption(500)

      expect(mockGC.collect).toHaveBeenCalledTimes(1)
    })

    it("forceGarbageCollection works manually", async () => {
      const mockGC: GarbageCollector = {
        collect: vi.fn().mockResolvedValue({
          freedTokens: 500,
          removedItems: [],
          preservedItems: [],
          timestamp: Date.now(),
        }),
        estimateTokens: vi.fn().mockReturnValue(100),
      }

      const monitorWithGC = new BudgetMonitor("test", {
        allocated: 10000,
        garbageCollector: mockGC,
      })

      await monitorWithGC.recordConsumption(3000)
      await monitorWithGC.forceGarbageCollection()

      expect(mockGC.collect).toHaveBeenCalled()
      expect(monitorWithGC.getStatus().consumed).toBe(2500)
    })
  })

  describe("session fork", () => {
    it("emits refactor-triggered at 90%", async () => {
      const handler = vi.fn()
      monitor.on("refactor-triggered", handler)

      await monitor.recordConsumption(9100)

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "refactor-triggered",
        })
      )
    })

    it("throws SessionForkRequiredError when autoFork enabled", async () => {
      const mockStrategy = new SimpleRefactorStrategy()
      const taskState: TaskState = {
        taskDescription: "Test task",
        sessionId: "test",
        modifiedFiles: [],
        recentActions: [],
        progressEstimate: 50,
        blockers: [],
      }

      const monitorWithFork = new BudgetMonitor("test", {
        allocated: 10000,
        config: { autoFork: true },
        refactorStrategy: mockStrategy,
      })

      monitorWithFork.setTaskState(taskState)

      await expect(monitorWithFork.recordConsumption(9100)).rejects.toThrow(
        SessionForkRequiredError
      )
    })

    it("includes manifest in fork error", async () => {
      const mockStrategy = new SimpleRefactorStrategy()
      const taskState: TaskState = {
        taskDescription: "Test task",
        sessionId: "test",
        modifiedFiles: [{ path: "/test.ts", changeType: "modified" }],
        recentActions: ["action1"],
        progressEstimate: 75,
        blockers: [],
      }

      const monitorWithFork = new BudgetMonitor("test", {
        allocated: 10000,
        config: { autoFork: true },
        refactorStrategy: mockStrategy,
      })

      monitorWithFork.setTaskState(taskState)

      try {
        await monitorWithFork.recordConsumption(9100)
      } catch (error) {
        expect(error).toBeInstanceOf(SessionForkRequiredError)
        const forkError = error as SessionForkRequiredError
        expect(forkError.manifest).toBeDefined()
        expect(forkError.manifest.originalSessionId).toBe("test")
        expect(forkError.criticalContext).toBeDefined()
      }
    })
  })

  describe("budget management", () => {
    it("updateAllocation changes budget", () => {
      monitor.updateAllocation(20000)

      const budget = monitor.getBudget()
      expect(budget.allocated).toBe(20000)
    })

    it("resetConsumption clears state", async () => {
      await monitor.recordConsumption(5000)
      monitor.resetConsumption()

      const status = monitor.getStatus()
      expect(status.consumed).toBe(0)
      expect(status.percentage).toBe(0)
    })

    it("getBudget returns copy", () => {
      const budget1 = monitor.getBudget()
      const budget2 = monitor.getBudget()

      expect(budget1).not.toBe(budget2)
      expect(budget1).toEqual(budget2)
    })
  })
})

describe("SimpleRefactorStrategy", () => {
  let strategy: SimpleRefactorStrategy

  beforeEach(() => {
    strategy = new SimpleRefactorStrategy()
  })

  describe("generateSummary", () => {
    it("generates summary from task state", async () => {
      const state: TaskState = {
        taskDescription: "Implement feature X",
        sessionId: "test",
        modifiedFiles: [
          { path: "/src/feature.ts", changeType: "created" },
          { path: "/src/index.ts", changeType: "modified" },
        ],
        recentActions: ["Create file", "Add imports"],
        progressEstimate: 60,
        blockers: ["Waiting for API spec"],
      }

      const summary = await strategy.generateSummary(state)

      expect(summary.progressSummary).toContain("Implement feature X")
      expect(summary.progressSummary).toContain("60%")
      expect(summary.fileChanges).toHaveLength(2)
      expect(summary.blockers).toContain("Waiting for API spec")
    })
  })

  describe("selectCriticalContext", () => {
    it("prioritizes blockers", () => {
      const summary = {
        progressSummary: "Test",
        keyDecisions: [],
        fileChanges: [],
        remainingTasks: ["Task 1"],
        blockers: ["Blocker 1"],
      }

      const context = strategy.selectCriticalContext(summary)

      expect(context.nextAction).toContain("Resolve blocker")
      expect(context.nextAction).toContain("Blocker 1")
    })

    it("falls back to remaining tasks", () => {
      const summary = {
        progressSummary: "Test",
        keyDecisions: [],
        fileChanges: [],
        remainingTasks: ["Finish feature"],
        blockers: [],
      }

      const context = strategy.selectCriticalContext(summary)

      expect(context.nextAction).toBe("Finish feature")
    })
  })

  describe("forkSession", () => {
    it("creates fork result", async () => {
      const context = {
        summary: "Test summary",
        essentialFiles: new Map([["test.ts", "content"]]),
        nextAction: "Continue work",
      }

      const result = await strategy.forkSession(context, 5000)

      expect(result.newSessionId).toMatch(/^fork-/)
      expect(result.handoffPrompt).toContain("Test summary")
      expect(result.handoffPrompt).toContain("Continue work")
      expect(result.newBudget.allocated).toBe(5000)
    })
  })
})

describe("BudgetMonitorManager", () => {
  let manager: BudgetMonitorManager

  beforeEach(() => {
    manager = new BudgetMonitorManager()
  })

  afterEach(() => {
    resetBudgetMonitorManager()
  })

  it("creates monitor for new session", () => {
    const monitor = manager.getMonitor("session-1")

    expect(monitor).toBeInstanceOf(BudgetMonitor)
    expect(manager.hasMonitor("session-1")).toBe(true)
  })

  it("returns same monitor for same session", () => {
    const monitor1 = manager.getMonitor("session-1")
    const monitor2 = manager.getMonitor("session-1")

    expect(monitor1).toBe(monitor2)
  })

  it("removes monitor", () => {
    manager.getMonitor("session-1")
    expect(manager.hasMonitor("session-1")).toBe(true)

    manager.removeMonitor("session-1")
    expect(manager.hasMonitor("session-1")).toBe(false)
  })

  it("lists sessions", () => {
    manager.getMonitor("session-a")
    manager.getMonitor("session-b")

    const sessions = manager.listSessions()

    expect(sessions).toContain("session-a")
    expect(sessions).toContain("session-b")
  })
})

describe("getBudgetMonitorManager singleton", () => {
  afterEach(() => {
    resetBudgetMonitorManager()
  })

  it("returns singleton", () => {
    const manager1 = getBudgetMonitorManager()
    const manager2 = getBudgetMonitorManager()

    expect(manager1).toBe(manager2)
  })

  it("resets on resetBudgetMonitorManager", () => {
    const manager1 = getBudgetMonitorManager()
    resetBudgetMonitorManager()
    const manager2 = getBudgetMonitorManager()

    expect(manager1).not.toBe(manager2)
  })
})

describe("generateConvergenceHint", () => {
  it("generates wrapUp hint", () => {
    const hint = generateConvergenceHint("wrapUp", 10)

    expect(hint).toContain("Begin consolidating")
    expect(hint).toContain("approximately 10 more actions")
    expect(hint).toContain("Identify the 2-3 most critical")
  })

  it("generates critical hint", () => {
    const hint = generateConvergenceHint("critical", 3)

    expect(hint).toContain("Focus only on essential")
    expect(hint).toContain("IMPORTANT")
    expect(hint).toContain("Skip optional optimizations")
  })

  it("generates healthy hint without extras", () => {
    const hint = generateConvergenceHint("healthy", 50)

    expect(hint).toContain("plenty of capacity")
    expect(hint).not.toContain("IMPORTANT")
    expect(hint).not.toContain("Please:")
  })
})
