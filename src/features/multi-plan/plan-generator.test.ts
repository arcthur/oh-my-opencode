import { describe, test, expect, afterEach, beforeEach, mock } from "bun:test"
import * as fs from "fs"
import * as os from "os"
import * as path from "path"
import type { BackgroundManager } from "../background-agent"
import type { PlanGenerationTask, MultiPlanSession } from "./types"
import { PlanGenerator, type MultiPlanProgressCallback } from "./plan-generator"
import type { PluginInput } from "@opencode-ai/plugin"

function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "omo-multi-plan-"))
}

function createMockManager(options: {
  launchResult?: { id: string; sessionID: string }
  launchError?: Error
  getTaskResult?: { status: string; error?: string }
} = {}): BackgroundManager {
  return {
    launch: options.launchError
      ? mock(() => Promise.reject(options.launchError))
      : mock(() => Promise.resolve(options.launchResult || { id: "bg_123", sessionID: "sess_123" })),
    getTask: mock(() => options.getTaskResult),
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

function createPlanGenerator(directory: string, manager: BackgroundManager): PlanGenerator {
  return new PlanGenerator(createMockCtx(directory), manager)
}

function createMockSession(planName: string, models: Array<{ name: string; model?: string }>): MultiPlanSession {
  return {
    id: "mp_test",
    planName,
    requestContext: "Test context for planning",
    models: models.map((m) => ({ name: m.name, model: m.model || "test/model" })),
    tasks: [],
    status: "generating",
    startedAt: new Date(),
    debateEnabled: false,
  }
}

// #region generatePlans
describe("PlanGenerator.generatePlans", () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = createTempDir()
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  test("launches background tasks for all models in parallel", async () => {
    // given
    const launchMock = mock(() => Promise.resolve({ id: "bg_123", sessionID: "sess_123" }))
    const manager = {
      launch: launchMock,
      getTask: mock(() => undefined),
    } as unknown as BackgroundManager
    const generator = createPlanGenerator(tmpDir, manager)

    const session = createMockSession("test-plan", [
      { name: "strategist", model: "anthropic/claude-opus-4-5" },
      { name: "creative", model: "openai/gpt-5.2" },
      { name: "practical", model: "google/gemini-pro" },
    ])

    // when
    const tasks = await generator.generatePlans(session, "parent_123")

    // then
    expect(launchMock).toHaveBeenCalledTimes(3)
    expect(tasks).toHaveLength(3)
    expect(tasks.every((t) => t.status === "running")).toBe(true)
  })

  test("sets correct output paths for each model", async () => {
    // given
    const manager = createMockManager({ launchResult: { id: "bg_1", sessionID: "sess_1" } })
    const generator = createPlanGenerator(tmpDir, manager)

    const session = createMockSession("auth-feature", [
      { name: "strategist" },
      { name: "creative" },
    ])

    // when
    const tasks = await generator.generatePlans(session, "parent_123")

    // then
    expect(tasks[0].outputPath).toBe(".sisyphus/plans/auth-feature-strategist.md")
    expect(tasks[1].outputPath).toBe(".sisyphus/plans/auth-feature-creative.md")
  })

  test("handles launch failure gracefully for individual models", async () => {
    // given - first launch succeeds, second fails
    let callCount = 0
    const manager = {
      launch: mock(() => {
        callCount++
        if (callCount === 2) {
          return Promise.reject(new Error("API rate limit exceeded"))
        }
        return Promise.resolve({ id: `bg_${callCount}`, sessionID: `sess_${callCount}` })
      }),
      getTask: mock(() => undefined),
    } as unknown as BackgroundManager
    const generator = createPlanGenerator(tmpDir, manager)

    const session = createMockSession("test-plan", [
      { name: "strategist" },
      { name: "creative" },
    ])

    // when
    const tasks = await generator.generatePlans(session, "parent_123")

    // then
    expect(tasks).toHaveLength(2)
    expect(tasks[0].status).toBe("running")
    expect(tasks[1].status).toBe("error")
    expect(tasks[1].error).toContain("rate limit")
  })

  test("calls manager.launch with correct parameters", async () => {
    // given
    const launchMock = mock(() => Promise.resolve({ id: "bg_1", sessionID: "sess_1" }))
    const manager = {
      launch: launchMock,
      getTask: mock(() => undefined),
    } as unknown as BackgroundManager
    const generator = createPlanGenerator(tmpDir, manager)

    const session = createMockSession("test-plan", [{ name: "strategist", model: "anthropic/claude-opus-4-5" }])

    // when
    await generator.generatePlans(session, "parent_session_id")

    // then
    expect(launchMock).toHaveBeenCalledTimes(1)
    const launchCall = (launchMock.mock.calls as unknown as Array<[Record<string, unknown>]>)[0][0]
    expect(launchCall.description).toBe("Multi-Plan: strategist")
    expect(launchCall.agent).toBe("sisyphus-junior")
    expect(launchCall.parentSessionID).toBe("parent_session_id")
    expect(launchCall.silent).toBe(true)
    expect(launchCall.model).toEqual({ providerID: "anthropic", modelID: "claude-opus-4-5" })
    // Prompt should contain plan name and context
    expect(launchCall.prompt).toContain("test-plan")
    expect(launchCall.prompt).toContain("strategist")
  })

  test("assigns unique task IDs from launch results", async () => {
    // given
    let callCount = 0
    const manager = {
      launch: mock(() => {
        callCount++
        return Promise.resolve({ id: `bg_${callCount}`, sessionID: `sess_${callCount}` })
      }),
      getTask: mock(() => undefined),
    } as unknown as BackgroundManager
    const generator = createPlanGenerator(tmpDir, manager)

    const session = createMockSession("test", [{ name: "a" }, { name: "b" }])

    // when
    const tasks = await generator.generatePlans(session, "parent")

    // then
    expect(tasks[0].taskId).toBe("bg_1")
    expect(tasks[0].sessionId).toBe("sess_1")
    expect(tasks[1].taskId).toBe("bg_2")
    expect(tasks[1].sessionId).toBe("sess_2")
  })
})
// #endregion

// #region waitForCompletion
describe("PlanGenerator.waitForCompletion", () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = createTempDir()
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  test("marks task completed when BackgroundManager evicts but output file exists", async () => {
    // given
    const outputPath = ".sisyphus/plans/test-claude.md"
    fs.mkdirSync(path.join(tmpDir, ".sisyphus", "plans"), { recursive: true })
    fs.writeFileSync(path.join(tmpDir, outputPath), "# Plan\n", "utf-8")

    const manager = createMockManager({ getTaskResult: undefined })
    const generator = createPlanGenerator(tmpDir, manager)

    const tasks: PlanGenerationTask[] = [
      {
        modelName: "claude",
        taskId: "bg_123",
        sessionId: "session_123",
        status: "running",
        outputPath,
        startedAt: new Date(),
      },
    ]

    // when
    await generator.waitForCompletion(tasks, 1000)

    // then
    expect(tasks[0].status).toBe("completed")
    expect(tasks[0].completedAt).toBeDefined()
  })

  test("marks task error when BackgroundManager evicts and output file is missing", async () => {
    // given
    const outputPath = ".sisyphus/plans/missing.md"

    const manager = createMockManager({ getTaskResult: undefined })
    const generator = createPlanGenerator(tmpDir, manager)

    const tasks: PlanGenerationTask[] = [
      {
        modelName: "claude",
        taskId: "bg_456",
        sessionId: "session_456",
        status: "running",
        outputPath,
        startedAt: new Date(),
      },
    ]

    // when
    await generator.waitForCompletion(tasks, 1000)

    // then
    expect(tasks[0].status).toBe("error")
    expect(tasks[0].error).toContain("output file missing")
  })

  test("completes when BackgroundManager reports task completed", async () => {
    // given
    const manager = createMockManager({ getTaskResult: { status: "completed" } })
    const generator = createPlanGenerator(tmpDir, manager)

    const tasks: PlanGenerationTask[] = [
      {
        modelName: "model1",
        taskId: "bg_1",
        sessionId: "sess_1",
        status: "running",
        outputPath: ".sisyphus/plans/test.md",
        startedAt: new Date(),
      },
    ]

    // when
    await generator.waitForCompletion(tasks, 5000)

    // then
    expect(tasks[0].status).toBe("completed")
  })

  test("marks error when BackgroundManager reports task failed", async () => {
    // given
    const manager = createMockManager({
      getTaskResult: { status: "error", error: "Model crashed" },
    })
    const generator = createPlanGenerator(tmpDir, manager)

    const tasks: PlanGenerationTask[] = [
      {
        modelName: "model1",
        taskId: "bg_1",
        sessionId: "sess_1",
        status: "running",
        outputPath: ".sisyphus/plans/test.md",
        startedAt: new Date(),
      },
    ]

    // when
    await generator.waitForCompletion(tasks, 5000)

    // then
    expect(tasks[0].status).toBe("error")
    expect(tasks[0].error).toBe("Model crashed")
  })

  test("marks timeout error when exceeding timeout", async () => {
    // given - getTask always returns running
    const manager = createMockManager({ getTaskResult: { status: "running" } })
    const generator = createPlanGenerator(tmpDir, manager)

    const tasks: PlanGenerationTask[] = [
      {
        modelName: "slow-model",
        taskId: "bg_slow",
        sessionId: "sess_slow",
        status: "running",
        outputPath: ".sisyphus/plans/slow.md",
        startedAt: new Date(),
      },
    ]

    // when - very short timeout
    await generator.waitForCompletion(tasks, 100)

    // then
    expect(tasks[0].status).toBe("error")
    expect(tasks[0].error).toContain("Timeout")
  })

  test("handles multiple tasks with mixed success and failure", async () => {
    // given
    let getTaskCallCount = 0
    const manager = {
      launch: mock(() => Promise.resolve({ id: "bg", sessionID: "sess" })),
      getTask: mock((taskId: string) => {
        getTaskCallCount++
        if (taskId === "bg_success") return { status: "completed" }
        if (taskId === "bg_error") return { status: "error", error: "Failed" }
        return { status: "running" }
      }),
    } as unknown as BackgroundManager
    const generator = createPlanGenerator(tmpDir, manager)

    const tasks: PlanGenerationTask[] = [
      {
        modelName: "success",
        taskId: "bg_success",
        sessionId: "sess_1",
        status: "running",
        outputPath: ".sisyphus/plans/success.md",
        startedAt: new Date(),
      },
      {
        modelName: "error",
        taskId: "bg_error",
        sessionId: "sess_2",
        status: "running",
        outputPath: ".sisyphus/plans/error.md",
        startedAt: new Date(),
      },
    ]

    // when
    await generator.waitForCompletion(tasks, 5000)

    // then
    expect(tasks[0].status).toBe("completed")
    expect(tasks[1].status).toBe("error")
    expect(tasks[1].error).toBe("Failed")
  })

  test("calls progress callbacks correctly", async () => {
    // given
    const manager = createMockManager({ getTaskResult: { status: "completed" } })
    const generator = createPlanGenerator(tmpDir, manager)

    const tasks: PlanGenerationTask[] = [
      {
        modelName: "model1",
        taskId: "bg_1",
        sessionId: "sess_1",
        status: "running",
        outputPath: ".sisyphus/plans/test.md",
        startedAt: new Date(),
      },
    ]

    const allTasksStarted = mock(() => {})
    const taskCompleted = mock(() => {})
    const progressCallback: MultiPlanProgressCallback = {
      onAllTasksStarted: allTasksStarted,
      onTaskCompleted: taskCompleted,
    }

    // when
    await generator.waitForCompletion(tasks, 5000, progressCallback)

    // then
    expect(allTasksStarted).toHaveBeenCalledTimes(1)
    expect(taskCompleted).toHaveBeenCalledTimes(1)
  })

  test("exits immediately when all tasks complete without waiting for poll interval", async () => {
    // given - tasks already completed
    const manager = createMockManager({ getTaskResult: { status: "completed" } })
    const generator = createPlanGenerator(tmpDir, manager)

    const tasks: PlanGenerationTask[] = [
      {
        modelName: "fast",
        taskId: "bg_1",
        sessionId: "sess_1",
        status: "running",
        outputPath: ".sisyphus/plans/fast.md",
        startedAt: new Date(),
      },
    ]

    const startTime = Date.now()

    // when
    await generator.waitForCompletion(tasks, 60000) // Long timeout

    // then - should complete quickly, not wait for full timeout
    const duration = Date.now() - startTime
    expect(duration).toBeLessThan(5000) // Should be much faster than timeout
    expect(tasks[0].status).toBe("completed")
  })
})
// #endregion

// #region resolveModelConfig
describe("PlanGenerator.resolveModelConfig", () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = createTempDir()
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  test("parses model specification in provider/model format", () => {
    // given
    const manager = createMockManager()
    const generator = createPlanGenerator(tmpDir, manager)

    // when
    const result = (generator as any).resolveModelConfig({
      name: "claude-opus-4-5",
      model: "anthropic/claude-opus-4-5",
    })

    // then
    expect(result.model).toEqual({
      providerID: "anthropic",
      modelID: "claude-opus-4-5",
    })
  })

  test("handles model with multiple slashes (e.g., openrouter)", () => {
    // given
    const manager = createMockManager()
    const generator = createPlanGenerator(tmpDir, manager)

    // when
    const result = (generator as any).resolveModelConfig({
      name: "claude-3-opus",
      model: "openrouter/anthropic/claude-3-opus",
    })

    // then
    expect(result.model).toEqual({
      providerID: "openrouter",
      modelID: "anthropic/claude-3-opus",
    })
  })

  test("returns empty config when model not specified", () => {
    // given
    const manager = createMockManager()
    const generator = createPlanGenerator(tmpDir, manager)

    // when
    const result = (generator as any).resolveModelConfig({ name: "test" })

    // then
    expect(result).toEqual({})
  })
})
// #endregion

// #region getModelRoleGuidance
describe("PlanGenerator.getModelRoleGuidance", () => {
  let tmpDir: string
  let generator: PlanGenerator

  beforeEach(() => {
    tmpDir = createTempDir()
    const manager = createMockManager()
    generator = createPlanGenerator(tmpDir, manager)
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  test("includes model name in guidance", () => {
    // when
    const result = (generator as any).getModelRoleGuidance("claude-opus-4-5")

    // then
    expect(result).toContain("claude-opus-4-5")
    expect(result).toContain("unique perspective")
  })

  test("guidance includes key prompts for diverse perspectives", () => {
    // when
    const result = (generator as any).getModelRoleGuidance("gpt-5.2")

    // then
    expect(result).toContain("prioritize")
    expect(result).toContain("edge cases")
    expect(result).toContain("actionable")
  })
})
// #endregion
