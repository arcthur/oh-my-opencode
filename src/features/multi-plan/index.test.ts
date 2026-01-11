import { describe, test, expect, beforeEach, afterEach, mock, spyOn } from "bun:test"
import * as fs from "fs"
import * as os from "os"
import * as path from "path"
import { MultiPlanOrchestrator, MultiPlanError } from "./index"
import { PlanGenerator } from "./plan-generator"
import type { BackgroundManager, BackgroundTask } from "../background-agent"
import type { PluginInput } from "@opencode-ai/plugin"
import type { MultiPlanSession, PlanGenerationTask, StartMultiPlanInput } from "./types"

function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "omo-multi-plan-index-"))
}

function createMockBackgroundManager(options: {
  launchResult?: { id: string; sessionID: string }
  getTaskResults?: Array<BackgroundTask | undefined>
} = {}): BackgroundManager {
  let getTaskCallCount = 0
  const getTaskResults = options.getTaskResults || []

  return {
    launch: mock(() =>
      Promise.resolve(options.launchResult || { id: "bg_123", sessionID: "sess_123" })
    ),
    getTask: mock(() => {
      const result = getTaskResults[getTaskCallCount]
      getTaskCallCount++
      return result
    }),
  } as unknown as BackgroundManager
}

function createMockCtx(directory: string): PluginInput {
  return {
    client: {
      tui: {
        showToast: mock(() => Promise.resolve()),
      },
    },
    directory,
  } as unknown as PluginInput
}

function createStartInput(planName: string, models: Array<{ name: string; model: string }>): StartMultiPlanInput {
  return {
    planName,
    requestContext: "Test context for planning",
    parentSessionId: "parent_123",
    config: {
      enabled: true,
      models,
    },
    debateEnabled: false,
  }
}

function createCompletedTask(modelName: string, planName: string): PlanGenerationTask {
  return {
    modelName,
    taskId: `bg_${modelName}`,
    sessionId: `sess_${modelName}`,
    status: "completed",
    outputPath: `.sisyphus/plans/${planName}-${modelName}.md`,
    startedAt: new Date(),
    completedAt: new Date(),
  }
}

function createFailedTask(modelName: string, planName: string, error: string): PlanGenerationTask {
  return {
    modelName,
    taskId: `bg_${modelName}`,
    sessionId: `sess_${modelName}`,
    status: "error",
    outputPath: `.sisyphus/plans/${planName}-${modelName}.md`,
    startedAt: new Date(),
    completedAt: new Date(),
    error,
  }
}

describe("MultiPlanOrchestrator", () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = createTempDir()
  })

  afterEach(() => {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  // #region start() - success paths
  describe("start() - success paths", () => {
    test("completes successfully with 2 models when all plans succeed", async () => {
      // #given
      const mockManager = createMockBackgroundManager({
        getTaskResults: [{ status: "completed" } as BackgroundTask],
      })
      const mockCtx = createMockCtx(tmpDir)
      const config = {
        enabled: true,
        models: [
          { name: "strategist", model: "anthropic/claude-opus-4-5" },
          { name: "creative", model: "openai/gpt-5.2" },
        ],
      }
      const orchestrator = new MultiPlanOrchestrator(mockCtx, mockManager, config)

      // Mock generator methods
      const mockTasks = [
        createCompletedTask("strategist", "test-plan"),
        createCompletedTask("creative", "test-plan"),
      ]
      spyOn(orchestrator as any, "generator").mockReturnValue({
        generatePlans: mock(() => Promise.resolve(mockTasks)),
        waitForCompletion: mock(() => Promise.resolve()),
      })
      // Direct property override for the generator
      ;(orchestrator as any).generator = {
        generatePlans: mock(() => Promise.resolve(mockTasks)),
        waitForCompletion: mock(() => Promise.resolve()),
      }

      // Create output files that synthesis would produce
      fs.mkdirSync(path.join(tmpDir, ".sisyphus", "plans"), { recursive: true })
      fs.mkdirSync(path.join(tmpDir, ".sisyphus", "plan-reviews"), { recursive: true })
      fs.writeFileSync(path.join(tmpDir, ".sisyphus/plans/test-plan.md"), "# Final Plan")
      fs.writeFileSync(
        path.join(tmpDir, ".sisyphus/plan-reviews/test-plan-comparison.md"),
        "# Comparison"
      )

      const input = createStartInput("test-plan", config.models)

      // #when
      const result = await orchestrator.start(input)

      // #then
      expect(result.session.status).toBe("complete")
      expect(result.finalPlanPath).toBe(".sisyphus/plans/test-plan.md")
      expect(result.comparisonReportPath).toBe(".sisyphus/plan-reviews/test-plan-comparison.md")
      expect(result.session.tasks).toHaveLength(2)
      expect(result.summary).toContain("Multi-Model Planning Complete")
      expect(result.summary).toContain("test-plan")
    })

    test("continues with partial success when 2 of 3 plans succeed", async () => {
      // #given
      const mockManager = createMockBackgroundManager({
        getTaskResults: [{ status: "completed" } as BackgroundTask],
      })
      const mockCtx = createMockCtx(tmpDir)
      const config = {
        enabled: true,
        models: [
          { name: "strategist", model: "anthropic/claude-opus-4-5" },
          { name: "creative", model: "openai/gpt-5.2" },
          { name: "practical", model: "google/gemini-pro" },
        ],
      }
      const orchestrator = new MultiPlanOrchestrator(mockCtx, mockManager, config)

      // 2 succeed, 1 fails
      const mockTasks = [
        createCompletedTask("strategist", "test-plan"),
        createCompletedTask("creative", "test-plan"),
        createFailedTask("practical", "test-plan", "Model timeout"),
      ]
      ;(orchestrator as any).generator = {
        generatePlans: mock(() => Promise.resolve(mockTasks)),
        waitForCompletion: mock(() => Promise.resolve()),
      }

      fs.mkdirSync(path.join(tmpDir, ".sisyphus", "plans"), { recursive: true })
      fs.mkdirSync(path.join(tmpDir, ".sisyphus", "plan-reviews"), { recursive: true })
      fs.writeFileSync(path.join(tmpDir, ".sisyphus/plans/test-plan.md"), "# Final Plan")
      fs.writeFileSync(
        path.join(tmpDir, ".sisyphus/plan-reviews/test-plan-comparison.md"),
        "# Comparison"
      )

      const input = createStartInput("test-plan", config.models)

      // #when
      const result = await orchestrator.start(input)

      // #then
      expect(result.session.status).toBe("complete")
      expect(result.summary).toContain("**Successful Plans**: 2/3")
      expect(result.summary).toContain("**Failed Plans**: 1")
    })

    test("transitions through correct status states during execution", async () => {
      // #given
      const mockManager = createMockBackgroundManager({
        getTaskResults: [{ status: "completed" } as BackgroundTask],
      })
      const mockCtx = createMockCtx(tmpDir)
      const config = {
        enabled: true,
        models: [
          { name: "strategist", model: "anthropic/claude-opus-4-5" },
          { name: "creative", model: "openai/gpt-5.2" },
        ],
      }
      const orchestrator = new MultiPlanOrchestrator(mockCtx, mockManager, config)

      const statusTransitions: string[] = []
      const mockTasks = [
        createCompletedTask("strategist", "test-plan"),
        createCompletedTask("creative", "test-plan"),
      ]

      ;(orchestrator as any).generator = {
        generatePlans: mock(async (session: MultiPlanSession) => {
          statusTransitions.push(session.status)
          return mockTasks
        }),
        waitForCompletion: mock(() => Promise.resolve()),
      }

      // Intercept runPlanSynthesis to capture status
      const originalRunPlanSynthesis = (orchestrator as any).runPlanSynthesis.bind(orchestrator)
      ;(orchestrator as any).runPlanSynthesis = mock(async (session: MultiPlanSession, parentId: string) => {
        statusTransitions.push(session.status)
        return originalRunPlanSynthesis(session, parentId)
      })

      fs.mkdirSync(path.join(tmpDir, ".sisyphus", "plans"), { recursive: true })
      fs.mkdirSync(path.join(tmpDir, ".sisyphus", "plan-reviews"), { recursive: true })
      fs.writeFileSync(path.join(tmpDir, ".sisyphus/plans/test-plan.md"), "# Final Plan")
      fs.writeFileSync(
        path.join(tmpDir, ".sisyphus/plan-reviews/test-plan-comparison.md"),
        "# Comparison"
      )

      const input = createStartInput("test-plan", config.models)

      // #when
      const result = await orchestrator.start(input)

      // #then
      expect(statusTransitions).toContain("generating")
      expect(statusTransitions).toContain("reviewing")
      expect(result.session.status).toBe("complete")
    })
  })
  // #endregion

  // #region start() - error paths
  describe("start() - error paths", () => {
    test("throws MultiPlanError when fewer than 2 plans succeed", async () => {
      // #given
      const mockManager = createMockBackgroundManager()
      const mockCtx = createMockCtx(tmpDir)
      const config = {
        enabled: true,
        models: [
          { name: "strategist", model: "anthropic/claude-opus-4-5" },
          { name: "creative", model: "openai/gpt-5.2" },
        ],
      }
      const orchestrator = new MultiPlanOrchestrator(mockCtx, mockManager, config)

      // Only 1 succeeds
      const mockTasks = [
        createCompletedTask("strategist", "test-plan"),
        createFailedTask("creative", "test-plan", "API error"),
      ]
      ;(orchestrator as any).generator = {
        generatePlans: mock(() => Promise.resolve(mockTasks)),
        waitForCompletion: mock(() => Promise.resolve()),
      }

      // Create the successful plan file
      fs.mkdirSync(path.join(tmpDir, ".sisyphus", "plans"), { recursive: true })
      fs.writeFileSync(
        path.join(tmpDir, ".sisyphus/plans/test-plan-strategist.md"),
        "# Plan"
      )

      const input = createStartInput("test-plan", config.models)

      // #when / #then
      try {
        await orchestrator.start(input)
        expect.unreachable("Should have thrown MultiPlanError")
      } catch (error) {
        expect(error).toBeInstanceOf(MultiPlanError)
        const mpError = error as MultiPlanError
        expect(mpError.message).toContain("Need at least 2")
        expect(mpError.session.status).toBe("error")
        // Should collect the one successful intermediate file
        expect(mpError.intermediateFiles).toContain(".sisyphus/plans/test-plan-strategist.md")
      }
    })

    test("throws MultiPlanError when all plans fail", async () => {
      // #given
      const mockManager = createMockBackgroundManager()
      const mockCtx = createMockCtx(tmpDir)
      const config = {
        enabled: true,
        models: [
          { name: "strategist", model: "anthropic/claude-opus-4-5" },
          { name: "creative", model: "openai/gpt-5.2" },
        ],
      }
      const orchestrator = new MultiPlanOrchestrator(mockCtx, mockManager, config)

      const mockTasks = [
        createFailedTask("strategist", "test-plan", "Timeout"),
        createFailedTask("creative", "test-plan", "Rate limited"),
      ]
      ;(orchestrator as any).generator = {
        generatePlans: mock(() => Promise.resolve(mockTasks)),
        waitForCompletion: mock(() => Promise.resolve()),
      }

      const input = createStartInput("test-plan", config.models)

      // #when / #then
      try {
        await orchestrator.start(input)
        expect.unreachable("Should have thrown")
      } catch (error) {
        expect(error).toBeInstanceOf(MultiPlanError)
        const mpError = error as MultiPlanError
        expect(mpError.message).toContain("Need at least 2, got 0")
        expect(mpError.intermediateFiles).toHaveLength(0)
      }
    })

    test("throws MultiPlanError when output files missing after synthesis", async () => {
      // #given
      const mockManager = createMockBackgroundManager({
        getTaskResults: [{ status: "completed" } as BackgroundTask],
      })
      const mockCtx = createMockCtx(tmpDir)
      const config = {
        enabled: true,
        models: [
          { name: "strategist", model: "anthropic/claude-opus-4-5" },
          { name: "creative", model: "openai/gpt-5.2" },
        ],
      }
      const orchestrator = new MultiPlanOrchestrator(mockCtx, mockManager, config)

      const mockTasks = [
        createCompletedTask("strategist", "test-plan"),
        createCompletedTask("creative", "test-plan"),
      ]
      ;(orchestrator as any).generator = {
        generatePlans: mock(() => Promise.resolve(mockTasks)),
        waitForCompletion: mock(() => Promise.resolve()),
      }

      // Create intermediate files but NOT final output
      fs.mkdirSync(path.join(tmpDir, ".sisyphus", "plans"), { recursive: true })
      fs.writeFileSync(
        path.join(tmpDir, ".sisyphus/plans/test-plan-strategist.md"),
        "# Strategist Plan"
      )
      fs.writeFileSync(
        path.join(tmpDir, ".sisyphus/plans/test-plan-creative.md"),
        "# Creative Plan"
      )
      // Note: NOT creating final plan or comparison report

      const input = createStartInput("test-plan", config.models)

      // #when / #then
      try {
        await orchestrator.start(input)
        expect.unreachable("Should have thrown")
      } catch (error) {
        expect(error).toBeInstanceOf(MultiPlanError)
        const mpError = error as MultiPlanError
        expect(mpError.message).toContain("output files missing")
        expect(mpError.intermediateFiles).toContain(".sisyphus/plans/test-plan-strategist.md")
        expect(mpError.intermediateFiles).toContain(".sisyphus/plans/test-plan-creative.md")
      }
    })

    test("sets session status to error on failure", async () => {
      // #given
      const mockManager = createMockBackgroundManager()
      const mockCtx = createMockCtx(tmpDir)
      const config = {
        enabled: true,
        models: [
          { name: "strategist", model: "anthropic/claude-opus-4-5" },
          { name: "creative", model: "openai/gpt-5.2" },
        ],
      }
      const orchestrator = new MultiPlanOrchestrator(mockCtx, mockManager, config)

      ;(orchestrator as any).generator = {
        generatePlans: mock(() => Promise.reject(new Error("Generator crashed"))),
        waitForCompletion: mock(() => Promise.resolve()),
      }

      const input = createStartInput("test-plan", config.models)

      // #when / #then
      try {
        await orchestrator.start(input)
      } catch (error) {
        expect(error).toBeInstanceOf(MultiPlanError)
        expect((error as MultiPlanError).session.status).toBe("error")
        expect((error as MultiPlanError).session.error).toContain("Generator crashed")
      }
    })
  })
  // #endregion

  // #region runDebateRound
  describe("runDebateRound", () => {
    test("generates at most one rebuttal per model (avoids file collisions across multiple conflicts)", async () => {
      // #given
      const planName = "test-plan"
      const mockCtx = createMockCtx(tmpDir)

      const launchMock = mock(() => {
        fs.mkdirSync(path.join(tmpDir, ".sisyphus", "rebuttals"), { recursive: true })
        fs.writeFileSync(
          path.join(tmpDir, `.sisyphus/rebuttals/${planName}-creative.md`),
          "# Rebuttal\n",
          "utf-8"
        )
        return Promise.resolve({ id: `bg_${crypto.randomUUID().slice(0, 8)}`, sessionID: "sess_123" })
      })

      const mockManager = {
        launch: launchMock,
        getTask: mock(() => undefined), // Evicted/unknown -> treated as completed by runDebateRound
      } as unknown as BackgroundManager

      const config = {
        enabled: true,
        models: [
          { name: "strategist", model: "anthropic/claude-opus-4-5" },
          { name: "creative", model: "openai/gpt-5.2" },
        ],
      }

      const orchestrator = new MultiPlanOrchestrator(mockCtx, mockManager, config)

      const comparisonReportPath = `.sisyphus/plan-reviews/${planName}-comparison.md`
      fs.mkdirSync(path.join(tmpDir, ".sisyphus", "plan-reviews"), { recursive: true })

      // Same model is rejected in multiple conflicts -> should still only spawn ONE rebuttal task for that model.
      fs.writeFileSync(
        path.join(tmpDir, comparisonReportPath),
        `### CONFLICT: Auth

**strategist says**: X
**creative says**: Y

---

**Why creative is WRONG**: Wrong for auth

---

**VERDICT**: ACCEPT strategist

### CONFLICT: DB

**strategist says**: X
**creative says**: Y

---

**Why creative is WRONG**: Wrong for db

---

**VERDICT**: ACCEPT strategist
`,
        "utf-8"
      )

      const session: MultiPlanSession = {
        id: "mp_test",
        planName,
        requestContext: "Test context",
        models: config.models,
        tasks: [],
        status: "reviewing",
        startedAt: new Date(),
        debateEnabled: true,
        rebuttals: [],
      }

      // #when
      const rebuttals = await (orchestrator as any).runDebateRound(
        session,
        comparisonReportPath,
        "parent_123"
      )

      // #then
      expect(launchMock).toHaveBeenCalledTimes(1)
      expect(rebuttals).toHaveLength(1)
      expect(rebuttals[0].modelName).toBe("creative")
    })
  })
  // #endregion

  // #region start() - debate flow
  describe("start() - debate flow", () => {
    test("runs debate round when enabled and rejections exist", async () => {
      // #given
      const mockManager = createMockBackgroundManager({
        getTaskResults: [{ status: "completed" } as BackgroundTask],
      })
      const mockCtx = createMockCtx(tmpDir)
      const config = {
        enabled: true,
        models: [
          { name: "strategist", model: "anthropic/claude-opus-4-5" },
          { name: "creative", model: "openai/gpt-5.2" },
        ],
      }
      const orchestrator = new MultiPlanOrchestrator(mockCtx, mockManager, config)

      const mockTasks = [
        createCompletedTask("strategist", "test-plan"),
        createCompletedTask("creative", "test-plan"),
      ]
      ;(orchestrator as any).generator = {
        generatePlans: mock(() => Promise.resolve(mockTasks)),
        waitForCompletion: mock(() => Promise.resolve()),
      }

      // Track if debate methods are called
      let debateRoundCalled = false
      let finalSynthesisCalled = false
      const statusesObserved: string[] = []

      ;(orchestrator as any).runDebateRound = mock(async (session: MultiPlanSession) => {
        debateRoundCalled = true
        statusesObserved.push(session.status)
        // Return mock rebuttals
        return [{ modelName: "creative", conflictIds: ["auth"], content: "Rebuttal", status: "completed" }]
      })

      ;(orchestrator as any).runFinalSynthesis = mock(async (session: MultiPlanSession) => {
        finalSynthesisCalled = true
        statusesObserved.push(session.status)
      })

      fs.mkdirSync(path.join(tmpDir, ".sisyphus", "plans"), { recursive: true })
      fs.mkdirSync(path.join(tmpDir, ".sisyphus", "plan-reviews"), { recursive: true })
      fs.writeFileSync(path.join(tmpDir, ".sisyphus/plans/test-plan.md"), "# Final Plan")
      fs.writeFileSync(
        path.join(tmpDir, ".sisyphus/plan-reviews/test-plan-comparison.md"),
        "# Comparison"
      )

      const input = createStartInput("test-plan", config.models)
      input.debateEnabled = true

      // #when
      const result = await orchestrator.start(input)

      // #then
      expect(debateRoundCalled).toBe(true)
      expect(finalSynthesisCalled).toBe(true)
      expect(statusesObserved).toContain("debating")
      expect(statusesObserved).toContain("finalizing")
      expect(result.session.rebuttals).toHaveLength(1)
    })

    test("skips final synthesis when no rebuttals returned", async () => {
      // #given
      const mockManager = createMockBackgroundManager({
        getTaskResults: [{ status: "completed" } as BackgroundTask],
      })
      const mockCtx = createMockCtx(tmpDir)
      const config = {
        enabled: true,
        models: [
          { name: "strategist", model: "anthropic/claude-opus-4-5" },
          { name: "creative", model: "openai/gpt-5.2" },
        ],
      }
      const orchestrator = new MultiPlanOrchestrator(mockCtx, mockManager, config)

      const mockTasks = [
        createCompletedTask("strategist", "test-plan"),
        createCompletedTask("creative", "test-plan"),
      ]
      ;(orchestrator as any).generator = {
        generatePlans: mock(() => Promise.resolve(mockTasks)),
        waitForCompletion: mock(() => Promise.resolve()),
      }

      let finalSynthesisCalled = false
      ;(orchestrator as any).runDebateRound = mock(async () => []) // No rebuttals
      ;(orchestrator as any).runFinalSynthesis = mock(async () => {
        finalSynthesisCalled = true
      })

      fs.mkdirSync(path.join(tmpDir, ".sisyphus", "plans"), { recursive: true })
      fs.mkdirSync(path.join(tmpDir, ".sisyphus", "plan-reviews"), { recursive: true })
      fs.writeFileSync(path.join(tmpDir, ".sisyphus/plans/test-plan.md"), "# Final Plan")
      fs.writeFileSync(
        path.join(tmpDir, ".sisyphus/plan-reviews/test-plan-comparison.md"),
        "# Comparison"
      )

      const input = createStartInput("test-plan", config.models)
      input.debateEnabled = true

      // #when
      await orchestrator.start(input)

      // #then
      expect(finalSynthesisCalled).toBe(false)
    })
  })
  // #endregion

  // #region verifyOutputFiles - boundary conditions
  describe("verifyOutputFiles", () => {
    test("returns valid:true only when BOTH files exist", () => {
      // #given
      const mockManager = createMockBackgroundManager()
      const mockCtx = createMockCtx(tmpDir)
      const orchestrator = new MultiPlanOrchestrator(mockCtx, mockManager, { enabled: true, models: [] })

      const finalPath = ".sisyphus/plans/test.md"
      const comparisonPath = ".sisyphus/plan-reviews/test-comparison.md"

      fs.mkdirSync(path.join(tmpDir, ".sisyphus", "plans"), { recursive: true })
      fs.mkdirSync(path.join(tmpDir, ".sisyphus", "plan-reviews"), { recursive: true })
      fs.writeFileSync(path.join(tmpDir, finalPath), "# Plan")
      fs.writeFileSync(path.join(tmpDir, comparisonPath), "# Comparison")

      // #when
      const result = (orchestrator as any).verifyOutputFiles(finalPath, comparisonPath)

      // #then
      expect(result.valid).toBe(true)
      expect(result.missing).toHaveLength(0)
    })

    test("reports all missing files accurately", () => {
      // #given
      const mockManager = createMockBackgroundManager()
      const mockCtx = createMockCtx(tmpDir)
      const orchestrator = new MultiPlanOrchestrator(mockCtx, mockManager, { enabled: true, models: [] })

      // #when - neither file exists
      const result = (orchestrator as any).verifyOutputFiles(
        ".sisyphus/plans/missing.md",
        ".sisyphus/plan-reviews/also-missing.md"
      )

      // #then
      expect(result.valid).toBe(false)
      expect(result.missing).toEqual([
        ".sisyphus/plans/missing.md",
        ".sisyphus/plan-reviews/also-missing.md",
      ])
    })
  })
  // #endregion

  // #region MultiPlanError
  describe("MultiPlanError", () => {
    test("preserves all context for debugging", () => {
      // #given
      const session: MultiPlanSession = {
        id: "mp_test",
        planName: "debug-test",
        requestContext: "Original request",
        models: [{ name: "test", model: "test/model" }],
        tasks: [],
        status: "error",
        startedAt: new Date(),
        debateEnabled: false,
      }
      const intermediateFiles = [".sisyphus/plans/partial-1.md", ".sisyphus/plans/partial-2.md"]

      // #when
      const error = new MultiPlanError("Synthesis failed", intermediateFiles, session)

      // #then
      expect(error.name).toBe("MultiPlanError")
      expect(error.message).toBe("Synthesis failed")
      expect(error.intermediateFiles).toEqual(intermediateFiles)
      expect(error.session.planName).toBe("debug-test")
      expect(error.session.requestContext).toBe("Original request")
    })
  })
  // #endregion

  // #region isEnabled
  describe("isEnabled", () => {
    test("reflects config.enabled state", () => {
      const mockManager = createMockBackgroundManager()
      const mockCtx = createMockCtx(tmpDir)

      const enabledOrch = new MultiPlanOrchestrator(mockCtx, mockManager, { enabled: true, models: [] })
      const disabledOrch = new MultiPlanOrchestrator(mockCtx, mockManager, { enabled: false, models: [] })

      expect(enabledOrch.isEnabled()).toBe(true)
      expect(disabledOrch.isEnabled()).toBe(false)
    })
  })
  // #endregion
})
