import { describe, test, expect, beforeEach, mock } from "bun:test"
import type { PluginInput } from "@opencode-ai/plugin"
import type { BackgroundManager } from "../../features/background-agent"
import { MultiPlanError } from "../../features/multi-plan"
import type { MultiPlanResult, StartMultiPlanInput, NormalizedPlanningModel } from "../../features/multi-plan"
import { createMultiPlanTool } from "./tools"

let startBehavior: ((input: StartMultiPlanInput) => Promise<MultiPlanResult>) | undefined
let lastStartInput: StartMultiPlanInput | undefined

// Helper to create model config
function createModelConfig(modelIds: string[]): string | string[] {
  if (modelIds.length === 1) {
    return modelIds[0]
  }
  return modelIds
}

describe("createMultiPlanTool", () => {
  beforeEach(() => {
    startBehavior = undefined
    lastStartInput = undefined
  })

  function createMockCtx(): PluginInput {
    return {
      client: {},
      directory: "/tmp",
    } as unknown as PluginInput
  }

  function createMockBackgroundManager(): BackgroundManager {
    return {
      launch: mock(() => Promise.reject(new Error("Unexpected launch"))),
      getTask: mock(() => undefined),
    } as unknown as BackgroundManager
  }

  function createStubResult(input: StartMultiPlanInput): MultiPlanResult {
    const models: NormalizedPlanningModel[] = input.config.models ?? []
    const tasks = models.map((m, idx) => ({
      modelName: m.name,
      taskId: `bg_${idx}`,
      sessionId: `sess_${idx}`,
      status: "completed" as const,
      outputPath: `.sisyphus/plans/${input.planName}-${m.name}.md`,
    }))

    return {
      session: {
        id: "mp_test",
        planName: input.planName,
        requestContext: input.requestContext,
        models,
        tasks,
        status: "complete",
        startedAt: new Date(),
        debateEnabled: input.debateEnabled ?? false,
        rebuttals: [],
      },
      comparisonReportPath: `.sisyphus/plan-reviews/${input.planName}-comparison.md`,
      finalPlanPath: `.sisyphus/plans/${input.planName}.md`,
      summary: `## Multi-Model Planning Complete: ${input.planName}`,
    }
  }

  function createOrchestratorStub() {
    return {
      start: async (input: StartMultiPlanInput): Promise<MultiPlanResult> => {
        lastStartInput = input
        if (startBehavior) return await startBehavior(input)
        return createStubResult(input)
      },
    }
  }

  test("returns an error when no config provided", async () => {
    // given
    const tool = createMultiPlanTool({
      ctx: createMockCtx(),
      backgroundManager: createMockBackgroundManager(),
      model: undefined,
      createOrchestrator: () => createOrchestratorStub(),
    })

    // when
    const result = await tool.execute(
      { planName: "../escape", context: "ctx" },
      { sessionID: "sess_123" } as any
    )

    // then
    expect(result).toContain("requires at least 2 models configured")
    expect(result).toContain("0 model(s)")
    expect(result).toContain("`.sisyphus/plans/work-plan.md`")
    expect(result).not.toContain("../escape")
  })

  test("returns an error when fewer than 2 models are configured", async () => {
    // given - single model string
    const tool = createMultiPlanTool({
      ctx: createMockCtx(),
      backgroundManager: createMockBackgroundManager(),
      model: createModelConfig(["anthropic/claude-opus-4-5"]),
      createOrchestrator: () => createOrchestratorStub(),
    })

    // when
    const result = await tool.execute(
      { planName: "test-plan", context: "ctx" },
      { sessionID: "sess_123" } as any
    )

    // then
    expect(result).toContain("requires at least 2 models configured")
    expect(result).toContain("1 model(s)")
  })

  test("rejects unsafe plan names (path traversal)", async () => {
    // given
    const tool = createMultiPlanTool({
      ctx: createMockCtx(),
      backgroundManager: createMockBackgroundManager(),
      model: createModelConfig(["anthropic/claude-opus-4-5", "openai/gpt-5.2"]),
      createOrchestrator: () => createOrchestratorStub(),
    })

    // when
    const result = await tool.execute(
      { planName: "../escape", context: "ctx" },
      { sessionID: "sess_123" } as any
    )

    // then
    expect(result).toContain('Invalid plan name: "../escape"')
  })

  test("rejects unsafe model names derived from config", async () => {
    // given - model ID "org/.." derives to ".." which is unsafe
    // The derived name ".." (parent directory) will be rejected
    const tool = createMultiPlanTool({
      ctx: createMockCtx(),
      backgroundManager: createMockBackgroundManager(),
      model: createModelConfig(["anthropic/claude-opus-4-5", "org/.."]),
      createOrchestrator: () => createOrchestratorStub(),
    })

    // when
    const result = await tool.execute(
      { planName: "test-plan", context: "ctx" },
      { sessionID: "sess_123" } as any
    )

    // then - name ".." is derived from model ID "org/.."
    expect(result).toContain('Invalid model name in config: ".."')
  })

  test("rejects duplicate model names after sanitization", async () => {
    // given - model IDs that derive to names that sanitize to the same value
    // "org/a..b" derives to "a..b", "org/a--b" derives to "a--b"
    // Both sanitize to "a-b"
    const tool = createMultiPlanTool({
      ctx: createMockCtx(),
      backgroundManager: createMockBackgroundManager(),
      model: createModelConfig(["org/a..b", "org/a--b"]),
      createOrchestrator: () => createOrchestratorStub(),
    })

    // when
    const result = await tool.execute(
      { planName: "test-plan", context: "ctx" },
      { sessionID: "sess_123" } as any
    )

    // then
    expect(result).toContain("Duplicate model name")
    expect(result).toContain('resolve to "a-b"')
  })

  test("renders intermediate files when MultiPlanError is thrown", async () => {
    // given
    startBehavior = async () => {
      throw new MultiPlanError("Synthesis failed", [".sisyphus/plans/x-claude-opus-4-5.md"], {
        id: "mp_test",
        planName: "x",
        requestContext: "ctx",
        models: [],
        tasks: [],
        status: "error",
        startedAt: new Date(),
      })
    }

    const tool = createMultiPlanTool({
      ctx: createMockCtx(),
      backgroundManager: createMockBackgroundManager(),
      model: createModelConfig(["anthropic/claude-opus-4-5", "openai/gpt-5.2"]),
      createOrchestrator: () => createOrchestratorStub(),
    })

    // when
    const result = await tool.execute(
      { planName: "x", context: "ctx" },
      { sessionID: "sess_123" } as any
    )

    // then
    expect(result).toContain("Multi-model planning failed")
    expect(result).toContain("some intermediate files were generated successfully")
    expect(result).toContain("`.sisyphus/plans/x-claude-opus-4-5.md`")
    expect(result).toContain("Fallback path: `.sisyphus/plans/x.md`")
  })

  test("passes sanitized planName to orchestrator", async () => {
    // given
    const tool = createMultiPlanTool({
      ctx: createMockCtx(),
      backgroundManager: createMockBackgroundManager(),
      model: createModelConfig(["anthropic/claude-opus-4-5", "openai/gpt-5.2"]),
      createOrchestrator: () => createOrchestratorStub(),
    })

    // when
    const result = await tool.execute(
      { planName: "  spaced-plan  ", context: "ctx" },
      { sessionID: "sess_123" } as any
    )

    // then
    expect(result).toContain("completed successfully")
    expect(lastStartInput?.planName).toBe("spaced-plan")
  })
})
