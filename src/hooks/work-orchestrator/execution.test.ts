import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { isAbsolute, join } from "node:path"
import * as yaml from "js-yaml"
import { createDirectContinuationReporterForTesting } from "./index"
import {
  buildOrchestratorReminderWithTelemetry,
  createExecutionOrchestratorHook as createExecutionOrchestratorHookBase,
  formatFileChanges,
  type ExecutionOrchestratorHookOptions,
} from "./execution"
import type { WorkState } from "../../features/work-state"
import type { GitFileStat } from "./git-diff-stats"
import {
  _resetForTesting,
  getSessionAgent,
  setMainSession,
  updateSessionAgent,
} from "../../features/claude-code-session-state"
import { MESSAGE_STORAGE, setOpenCodeStorageDirForTesting } from "../../features/hook-message-injector"
import { createTaskNode, listTaskNodes, transitionTaskNode } from "../../features/task-system"
import { contextBudgetArbiter } from "../../features/context-view"

function writeWorkState(directory: string, state: Partial<WorkState>): void {
  const orchestratorDir = join(directory, ".orchestrator")
  if (!existsSync(orchestratorDir)) {
    mkdirSync(orchestratorDir, { recursive: true })
  }

  const planId = state.plan_id ?? "test-plan"
  const canonicalPlanPath = `.orchestrator/plans/${planId}/plan.md`
  const canonicalLedgerPath = `.orchestrator/plans/${planId}/ledger.yaml`
  const canonicalPlanAbsPath = join(directory, canonicalPlanPath)
  const canonicalPlanDir = join(directory, ".orchestrator", "plans", planId)
  mkdirSync(canonicalPlanDir, { recursive: true })

  const rawPath = state.execution_plan_path
  const legacyPlanPath =
    typeof rawPath === "string" && rawPath.length > 0
      ? (isAbsolute(rawPath) ? rawPath : join(directory, rawPath))
      : null

  if (legacyPlanPath && existsSync(legacyPlanPath)) {
    writeFileSync(canonicalPlanAbsPath, readFileSync(legacyPlanPath, "utf-8"))
  } else if (!existsSync(canonicalPlanAbsPath)) {
    writeFileSync(canonicalPlanAbsPath, "# Plan\n\n## Tasks\n\n- 1. Task\n")
  }

  const canonicalLedgerAbsPath = join(directory, canonicalLedgerPath)
  if (!existsSync(canonicalLedgerAbsPath)) {
    writeFileSync(
      canonicalLedgerAbsPath,
      `schema_version: 1\nplan_id: ${planId}\nerrors: []\nblockers: []\ndecisions: []\nupdated_at: \"2026-02-06T00:00:00Z\"\n`
    )
  }

  const fullState: WorkState = {
    schema_version: 6,
    executor: state.executor ?? "workflow-automator",
    plan_id: planId,
    execution_plan_path: canonicalPlanPath,
    runtime_ledger_path: canonicalLedgerPath,
    started_at: state.started_at ?? new Date().toISOString(),
    session_ids: state.session_ids ?? [],
    protocol: state.protocol ?? {
      research_ops: 0,
      last_findings_mtime: 0,
      stop_verification_last_prompt_at_by_session: {},
    },
    errors: state.errors ?? [],
    blockers: state.blockers ?? [],
    decisions: state.decisions ?? [],
    last_updated: state.last_updated,
  }

  writeFileSync(join(orchestratorDir, "work.yaml"), yaml.dump(fullState, { indent: 2 }))
}

describe("work-orchestrator execution phase", () => {
  const TEST_DIR = join(tmpdir(), "work-orchestrator-execution-test")
  const TEST_STORAGE_DIR = join(tmpdir(), "opencode-storage-work-orchestrator-execution-test")
  const TEST_TASK_CONFIG = {
    orchestrator: {
      tasks: {
        enabled: true,
        storage_path: join(TEST_DIR, ".orchestrator", "tasks"),
      },
    },
  } as const

  type TestExecutionOrchestratorHookOptions = Omit<
    ExecutionOrchestratorHookOptions,
    "directory" | "reportContinuationIntent"
  > & {
    directory?: string
    reportContinuationIntent?: ExecutionOrchestratorHookOptions["reportContinuationIntent"]
  }

  function createMockPluginInput(overrides?: { promptMock?: ReturnType<typeof mock> }) {
    const promptMock = overrides?.promptMock ?? mock(() => Promise.resolve())
    return {
      directory: TEST_DIR,
      client: {
        session: {
          prompt: promptMock,
          messages: mock(() => Promise.resolve({ data: [] })),
        },
      },
      _promptMock: promptMock,
    } as unknown as Parameters<typeof createExecutionOrchestratorHook>[0] & {
      _promptMock: ReturnType<typeof mock>
    }
  }

  function createExecutionOrchestratorHook(
    input: ReturnType<typeof createMockPluginInput>,
    options: TestExecutionOrchestratorHookOptions = {}
  ) {
    return createExecutionOrchestratorHookBase(input, {
      ...options,
      directory: options.directory ?? input.directory,
      taskConfig: options.taskConfig ?? TEST_TASK_CONFIG,
      reportContinuationIntent:
        options.reportContinuationIntent ?? createDirectContinuationReporterForTesting(input),
    })
  }

  async function flushMicrotasks(): Promise<void> {
    await Promise.resolve()
    await Promise.resolve()
  }

  function setupMessageStorage(sessionID: string, agent: string): void {
    const messageDir = join(MESSAGE_STORAGE, sessionID)
    if (!existsSync(messageDir)) {
      mkdirSync(messageDir, { recursive: true })
    }
    const messageData = {
      agent,
      model: { providerID: "anthropic", modelID: "claude-opus-4-5" },
    }
    writeFileSync(join(messageDir, "msg_test001.json"), JSON.stringify(messageData))
  }

  function cleanupMessageStorage(sessionID: string): void {
    const messageDir = join(MESSAGE_STORAGE, sessionID)
    if (existsSync(messageDir)) {
      rmSync(messageDir, { recursive: true, force: true })
    }
  }

  beforeEach(() => {
    contextBudgetArbiter.resetForTesting()
    setOpenCodeStorageDirForTesting(TEST_STORAGE_DIR)
    _resetForTesting()
    if (!existsSync(TEST_DIR)) {
      mkdirSync(TEST_DIR, { recursive: true })
    }
    mkdirSync(join(TEST_DIR, ".orchestrator"), { recursive: true })
  })

  afterEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true })
    }
    contextBudgetArbiter.resetForTesting()
    _resetForTesting()
  })

  test("injects continuation for execution-mode session on idle", async () => {
    // #given
    const sessionID = "main-session"
    setMainSession(sessionID)
    setupMessageStorage(sessionID, "workflow-automator")

    const planPath = join(TEST_DIR, ".orchestrator", "plans", "execution", "plan.md")
    mkdirSync(join(TEST_DIR, ".orchestrator", "plans", "execution"), { recursive: true })
    writeFileSync(planPath, "# Plan\n\n## Tasks\n\n- 1. Task 1\n- 2. Task 2\n")

    writeWorkState(TEST_DIR, {
      plan_id: "execution",
      execution_plan_path: ".orchestrator/plans/execution/plan.md",
      runtime_ledger_path: ".orchestrator/plans/execution/ledger.yaml",
      session_ids: [sessionID],
    })

    const mockInput = createMockPluginInput()
    const hook = createExecutionOrchestratorHook(mockInput)

    // #when
    await hook.handler({
      event: {
        type: "session.idle",
        properties: { sessionID },
      },
    })
    await new Promise((resolve) => setTimeout(resolve, 0))

    // #then
    expect(mockInput._promptMock).toHaveBeenCalledTimes(1)
    const args = mockInput._promptMock.mock.calls[0][0]
    expect(args.body.agent).toBe("workflow-automator")
    expect(args.body.parts[0].text).toContain("WORK CONTINUATION")

    cleanupMessageStorage(sessionID)
  })

  test("injects workflow-automator continuation for workflow-automator execution session on idle", async () => {
    // #given
    const sessionID = "workflow-automator-main-session"
    setMainSession(sessionID)
    setupMessageStorage(sessionID, "workflow-automator")

    const planPath = join(TEST_DIR, ".orchestrator", "plans", "execution", "plan.md")
    mkdirSync(join(TEST_DIR, ".orchestrator", "plans", "execution"), { recursive: true })
    writeFileSync(planPath, "# Plan\n\n## Tasks\n\n- 1. Task 1\n")

    writeWorkState(TEST_DIR, {
      plan_id: "execution",
      executor: "workflow-automator",
      execution_plan_path: ".orchestrator/plans/execution/plan.md",
      runtime_ledger_path: ".orchestrator/plans/execution/ledger.yaml",
      session_ids: [sessionID],
    })

    const mockInput = createMockPluginInput()
    const hook = createExecutionOrchestratorHook(mockInput)

    // #when
    await hook.handler({
      event: {
        type: "session.idle",
        properties: { sessionID },
      },
    })
    await flushMicrotasks()

    // #then
    expect(mockInput._promptMock).toHaveBeenCalledTimes(1)
    const args = mockInput._promptMock.mock.calls[0][0]
    expect(args.body.agent).toBe("workflow-automator")
    expect(args.body.parts[0].text).toContain("WORKFLOW-AUTOMATOR EXECUTION CONTINUATION")

    cleanupMessageStorage(sessionID)
  })

  test("does not run continuation when work-state schema is legacy", async () => {
    // #given
    const sessionID = "legacy-orchestrator-session"
    setMainSession(sessionID)
    setupMessageStorage(sessionID, "workflow-automator")

    mkdirSync(join(TEST_DIR, ".orchestrator"), { recursive: true })
    writeFileSync(
      join(TEST_DIR, ".orchestrator", "work.yaml"),
      `schema_version: 4
executor: orchestrator
plan_id: execution
execution_plan_path: .orchestrator/plans/execution/plan.md
runtime_ledger_path: .orchestrator/plans/execution/ledger.yaml
started_at: "2026-02-06T00:00:00Z"
session_ids:
  - ${sessionID}
research_ops: 0
last_findings_mtime: 0
errors: []
blockers: []
decisions: []
`,
      "utf-8"
    )

    const mockInput = createMockPluginInput()
    const hook = createExecutionOrchestratorHook(mockInput)

    // #when
    await hook.handler({
      event: {
        type: "session.idle",
        properties: { sessionID },
      },
    })
    await flushMicrotasks()

    // #then
    expect(mockInput._promptMock).toHaveBeenCalledTimes(0)
  })

  test("does not continue when execution caller metadata is unavailable", async () => {
    // #given
    const sessionID = "workflow-automator-no-metadata-session"
    setMainSession(sessionID)

    writeWorkState(TEST_DIR, {
      plan_id: "execution",
      executor: "workflow-automator",
      execution_plan_path: ".orchestrator/plans/execution/plan.md",
      runtime_ledger_path: ".orchestrator/plans/execution/ledger.yaml",
      session_ids: [sessionID],
    })

    const mockInput = createMockPluginInput()
    const hook = createExecutionOrchestratorHook(mockInput)

    // #when
    await hook.handler({
      event: {
        type: "session.idle",
        properties: { sessionID },
      },
    })
    await flushMicrotasks()

    // #then
    expect(mockInput._promptMock).toHaveBeenCalledTimes(0)
  })

  test("does not run execution continuation when explicit non-orchestrator agent is active", async () => {
    // #given
    const sessionID = "workflow-automator-planner-session"
    setMainSession(sessionID)
    updateSessionAgent(sessionID, "planner")

    writeWorkState(TEST_DIR, {
      plan_id: "execution",
      executor: "workflow-automator",
      execution_plan_path: ".orchestrator/plans/execution/plan.md",
      runtime_ledger_path: ".orchestrator/plans/execution/ledger.yaml",
      session_ids: [sessionID],
    })

    const mockInput = createMockPluginInput()
    const hook = createExecutionOrchestratorHook(mockInput)

    // #when
    await hook.handler({
      event: {
        type: "session.idle",
        properties: { sessionID },
      },
    })
    await flushMicrotasks()

    // #then
    expect(mockInput._promptMock).toHaveBeenCalledTimes(0)
  })

  test("does not inject continuation when workflow-automator plan tasks are fully completed", async () => {
    // #given
    const sessionID = "workflow-automator-complete-session"
    setMainSession(sessionID)
    setupMessageStorage(sessionID, "workflow-automator")

    writeWorkState(TEST_DIR, {
      plan_id: "execution",
      executor: "workflow-automator",
      execution_plan_path: ".orchestrator/plans/execution/plan.md",
      runtime_ledger_path: ".orchestrator/plans/execution/ledger.yaml",
      session_ids: [sessionID],
    })

    const created = createTaskNode(
      { scope: "plan", container_id: "execution", title: "1. Task 1" },
      TEST_TASK_CONFIG
    )
    transitionTaskNode(
      {
        scope: "plan",
        container_id: "execution",
        id: created.id,
        expected_revision: created.revision,
        next_state: "completed",
      },
      TEST_TASK_CONFIG
    )

    const mockInput = createMockPluginInput()
    const hook = createExecutionOrchestratorHook(mockInput)

    // #when
    await hook.handler({
      event: {
        type: "session.idle",
        properties: { sessionID },
      },
    })
    await flushMicrotasks()

    // #then
    expect(mockInput._promptMock).toHaveBeenCalledTimes(0)

    cleanupMessageStorage(sessionID)
  })

  test("runs completion routine when plan tasks are fully completed", async () => {
    // #given
    const sessionID = "workflow-automator-completion-routine-session"
    setMainSession(sessionID)
    setupMessageStorage(sessionID, "workflow-automator")
    updateSessionAgent(sessionID, "workflow-automator")

    writeWorkState(TEST_DIR, {
      plan_id: "execution",
      executor: "workflow-automator",
      execution_plan_path: ".orchestrator/plans/execution/plan.md",
      runtime_ledger_path: ".orchestrator/plans/execution/ledger.yaml",
      session_ids: [sessionID],
    })

    const created = createTaskNode(
      { scope: "plan", container_id: "execution", title: "1. Task 1" },
      TEST_TASK_CONFIG
    )
    transitionTaskNode(
      {
        scope: "plan",
        container_id: "execution",
        id: created.id,
        expected_revision: created.revision,
        next_state: "completed",
      },
      TEST_TASK_CONFIG
    )

    const mockInput = createMockPluginInput()
    const hook = createExecutionOrchestratorHook(mockInput)
    const completionPath = join(TEST_DIR, ".orchestrator", "plans", "execution", "completion.md")

    // #when
    await hook.handler({
      event: {
        type: "session.idle",
        properties: { sessionID },
      },
    })
    await flushMicrotasks()

    // #then
    expect(existsSync(join(TEST_DIR, ".orchestrator", "work.yaml"))).toBe(false)
    expect(existsSync(completionPath)).toBe(true)
    const completionContent = readFileSync(completionPath, "utf-8")
    expect(completionContent).toContain("Plan Complete")
    expect(completionContent).toContain("## Reminder Telemetry")
    expect(completionContent).toContain("Total reminders: 0")
    expect(getSessionAgent(sessionID)).toBe("orchestrator")

    cleanupMessageStorage(sessionID)
  })

  test("records reminder telemetry counts in completion artifact", async () => {
    // #given
    const sessionID = "workflow-automator-completion-telemetry-session"
    setMainSession(sessionID)
    setupMessageStorage(sessionID, "workflow-automator")
    updateSessionAgent(sessionID, "workflow-automator")

    writeWorkState(TEST_DIR, {
      plan_id: "execution",
      executor: "workflow-automator",
      execution_plan_path: ".orchestrator/plans/execution/plan.md",
      runtime_ledger_path: ".orchestrator/plans/execution/ledger.yaml",
      session_ids: [sessionID],
    })

    const created = createTaskNode(
      { scope: "plan", container_id: "execution", title: "1. Task 1" },
      TEST_TASK_CONFIG
    )

    const mockInput = createMockPluginInput()
    const hook = createExecutionOrchestratorHook(mockInput)
    const delegateOutput = {
      title: "delegate_task",
      output: "Subagent done\nSession ID: ses_completiontelemetry001",
      metadata: {},
    }
    const completionPath = join(TEST_DIR, ".orchestrator", "plans", "execution", "completion.md")

    // #when
    await hook["tool.execute.after"](
      { tool: "delegate_task", sessionID, callID: "completion-telemetry-call-1" },
      delegateOutput
    )
    transitionTaskNode(
      {
        scope: "plan",
        container_id: "execution",
        id: created.id,
        expected_revision: created.revision,
        next_state: "completed",
      },
      TEST_TASK_CONFIG
    )
    await hook.handler({
      event: {
        type: "session.idle",
        properties: { sessionID },
      },
    })
    await flushMicrotasks()

    // #then
    const completionContent = readFileSync(completionPath, "utf-8")
    expect(completionContent).toContain("## Reminder Telemetry")
    expect(completionContent).toContain("Total reminders: 1")
    expect(completionContent).toContain("Profiles: full=1, compact=0, ultra-compact=0")
    expect(completionContent).toContain("Budget downgrades: 0")
    expect(completionContent).toContain("Field truncations: 0")
    expect(completionContent).toContain("Hard truncations: 0")

    cleanupMessageStorage(sessionID)
  })

  test("preserves reminder telemetry across session.compacted before completion", async () => {
    // #given
    const sessionID = "workflow-automator-completion-telemetry-compacted-session"
    setMainSession(sessionID)
    setupMessageStorage(sessionID, "workflow-automator")
    updateSessionAgent(sessionID, "workflow-automator")

    writeWorkState(TEST_DIR, {
      plan_id: "execution",
      executor: "workflow-automator",
      execution_plan_path: ".orchestrator/plans/execution/plan.md",
      runtime_ledger_path: ".orchestrator/plans/execution/ledger.yaml",
      session_ids: [sessionID],
    })

    const created = createTaskNode(
      { scope: "plan", container_id: "execution", title: "1. Task 1" },
      TEST_TASK_CONFIG
    )

    const mockInput = createMockPluginInput()
    const hook = createExecutionOrchestratorHook(mockInput)
    const delegateOutput = {
      title: "delegate_task",
      output: "Subagent done\nSession ID: ses_completiontelemetry002",
      metadata: {},
    }
    const completionPath = join(TEST_DIR, ".orchestrator", "plans", "execution", "completion.md")

    // #when
    await hook["tool.execute.after"](
      { tool: "delegate_task", sessionID, callID: "completion-telemetry-call-2" },
      delegateOutput
    )
    await hook.handler({ event: { type: "session.compacted", properties: { sessionID } } })

    transitionTaskNode(
      {
        scope: "plan",
        container_id: "execution",
        id: created.id,
        expected_revision: created.revision,
        next_state: "completed",
      },
      TEST_TASK_CONFIG
    )
    await hook.handler({
      event: {
        type: "session.idle",
        properties: { sessionID },
      },
    })
    await flushMicrotasks()

    // #then
    const completionContent = readFileSync(completionPath, "utf-8")
    expect(completionContent).toContain("Total reminders: 1")
    expect(completionContent).toContain("Profiles: full=1, compact=0, ultra-compact=0")

    cleanupMessageStorage(sessionID)
  })

  test("preserves reminder telemetry across hook recreation (process restart simulation)", async () => {
    // #given
    const sessionID = "workflow-automator-completion-telemetry-restart-session"
    setMainSession(sessionID)
    setupMessageStorage(sessionID, "workflow-automator")
    updateSessionAgent(sessionID, "workflow-automator")

    writeWorkState(TEST_DIR, {
      plan_id: "execution",
      executor: "workflow-automator",
      execution_plan_path: ".orchestrator/plans/execution/plan.md",
      runtime_ledger_path: ".orchestrator/plans/execution/ledger.yaml",
      session_ids: [sessionID],
    })

    const created = createTaskNode(
      { scope: "plan", container_id: "execution", title: "1. Task 1" },
      TEST_TASK_CONFIG
    )

    const mockInput = createMockPluginInput()
    const firstHook = createExecutionOrchestratorHook(mockInput)
    const delegateOutput = {
      title: "delegate_task",
      output: "Subagent done\nSession ID: ses_completiontelemetry003",
      metadata: {},
    }
    const completionPath = join(TEST_DIR, ".orchestrator", "plans", "execution", "completion.md")

    // #when
    await firstHook["tool.execute.after"](
      { tool: "delegate_task", sessionID, callID: "completion-telemetry-call-3" },
      delegateOutput
    )
    const secondHook = createExecutionOrchestratorHook(createMockPluginInput())

    transitionTaskNode(
      {
        scope: "plan",
        container_id: "execution",
        id: created.id,
        expected_revision: created.revision,
        next_state: "completed",
      },
      TEST_TASK_CONFIG
    )
    await secondHook.handler({
      event: {
        type: "session.idle",
        properties: { sessionID },
      },
    })
    await flushMicrotasks()

    // #then
    const completionContent = readFileSync(completionPath, "utf-8")
    expect(completionContent).toContain("Total reminders: 1")
    expect(completionContent).toContain("Profiles: full=1, compact=0, ultra-compact=0")

    cleanupMessageStorage(sessionID)
  })

  test("reports continuation intent when reporter is configured", async () => {
    // #given
    const sessionID = "main-session-reporter"
    setMainSession(sessionID)
    setupMessageStorage(sessionID, "workflow-automator")

    writeWorkState(TEST_DIR, {
      plan_id: "execution",
      execution_plan_path: ".orchestrator/plans/execution/plan.md",
      runtime_ledger_path: ".orchestrator/plans/execution/ledger.yaml",
      session_ids: [sessionID],
    })

    const intents: Array<{ sessionID: string; source: string; round?: number; text: string }> = []
    const mockInput = createMockPluginInput()
    const hook = createExecutionOrchestratorHook(mockInput, {
      getContinuationRound: () => 13,
      reportContinuationIntent: async (intent) => {
        intents.push({
          sessionID: intent.sessionID,
          source: intent.source,
          round: intent.round,
          text: intent.prompt.text,
        })
      },
    })

    // #when
    await hook.handler({
      event: {
        type: "session.idle",
        properties: { sessionID },
      },
    })
    await flushMicrotasks()

    // #then
    expect(mockInput._promptMock).toHaveBeenCalledTimes(0)
    expect(intents).toHaveLength(1)
    expect(intents[0].sessionID).toBe(sessionID)
    expect(intents[0].source).toBe("work-orchestrator")
    expect(intents[0].round).toBe(13)
    expect(intents[0].text).toContain("WORK CONTINUATION")

    cleanupMessageStorage(sessionID)
  })

  test("waits for continuation reporter completion in idle handling", async () => {
    // #given
    const sessionID = "main-session-reporter-await"
    setMainSession(sessionID)
    setupMessageStorage(sessionID, "workflow-automator")

    writeWorkState(TEST_DIR, {
      plan_id: "execution",
      execution_plan_path: ".orchestrator/plans/execution/plan.md",
      runtime_ledger_path: ".orchestrator/plans/execution/ledger.yaml",
      session_ids: [sessionID],
    })

    const mockInput = createMockPluginInput()
    let reporterFinished = false
    const hook = createExecutionOrchestratorHook(mockInput, {
      reportContinuationIntent: async () => {
        await new Promise((resolve) => setTimeout(resolve, 20))
        reporterFinished = true
      },
    })

    // #when
    await hook.handler({
      event: {
        type: "session.idle",
        properties: { sessionID },
      },
    })

    // #then
    expect(reporterFinished).toBe(true)
    expect(mockInput._promptMock).toHaveBeenCalledTimes(0)

    cleanupMessageStorage(sessionID)
  })

  test("does not apply cooldown when continuation intent is rejected due to post-compaction grace", async () => {
    // #given
    const sessionID = "main-session-reject-grace"
    setMainSession(sessionID)
    setupMessageStorage(sessionID, "workflow-automator")

    writeWorkState(TEST_DIR, {
      plan_id: "execution",
      execution_plan_path: ".orchestrator/plans/execution/plan.md",
      runtime_ledger_path: ".orchestrator/plans/execution/ledger.yaml",
      session_ids: [sessionID],
    })

    const reported: Array<{ sessionID: string; round?: number }> = []
    const mockInput = createMockPluginInput()
    const hook = createExecutionOrchestratorHook(mockInput, {
      reportContinuationIntent: async (intent) => {
        reported.push({ sessionID: intent.sessionID, round: intent.round })
        await intent.onResult?.({
          status: "rejected",
          rejectReason: "post_compaction_grace",
        })
      },
    })

    const originalNow = Date.now
    Date.now = () => 1000

    try {
      // #when - idle fires twice within cooldown window
      await hook.handler({ event: { type: "session.idle", properties: { sessionID } } })
      await flushMicrotasks()
      await hook.handler({ event: { type: "session.idle", properties: { sessionID } } })
      await flushMicrotasks()

      // #then
      expect(reported).toHaveLength(2)
    } finally {
      Date.now = originalNow
      cleanupMessageStorage(sessionID)
    }
  })

  test("does not continue when stop guard is active", async () => {
    // #given
    const sessionID = "main-session-stop-guard"
    setMainSession(sessionID)
    setupMessageStorage(sessionID, "workflow-automator")

    writeWorkState(TEST_DIR, {
      plan_id: "execution",
      execution_plan_path: ".orchestrator/plans/execution/plan.md",
      runtime_ledger_path: ".orchestrator/plans/execution/ledger.yaml",
      session_ids: [sessionID],
    })

    const mockInput = createMockPluginInput()
    const hook = createExecutionOrchestratorHook(mockInput, {
      isContinuationStopped: (id) => id === sessionID,
    })

    // #when
    await hook.handler({
      event: {
        type: "session.idle",
        properties: { sessionID },
      },
    })
    await flushMicrotasks()

    // #then
    expect(mockInput._promptMock).toHaveBeenCalledTimes(0)

    cleanupMessageStorage(sessionID)
  })

  test("stops continuation after 2 consecutive prompt failures", async () => {
    // #given
    const sessionID = "main-session-prompt-failure"
    setMainSession(sessionID)
    setupMessageStorage(sessionID, "workflow-automator")
    writeWorkState(TEST_DIR, {
      plan_id: "execution",
      execution_plan_path: ".orchestrator/plans/execution/plan.md",
      runtime_ledger_path: ".orchestrator/plans/execution/ledger.yaml",
      session_ids: [sessionID],
    })

    const promptMock = mock(() => Promise.reject(new Error("Bad Request")))
    const mockInput = createMockPluginInput({ promptMock })
    const hook = createExecutionOrchestratorHook(mockInput)

    const originalDateNow = Date.now
    let now = 0
    Date.now = () => now

    try {
      // #when - idle fires repeatedly, each after cooldown
      await hook.handler({ event: { type: "session.idle", properties: { sessionID } } })
      await flushMicrotasks()
      now += 6000

      await hook.handler({ event: { type: "session.idle", properties: { sessionID } } })
      await flushMicrotasks()
      now += 6000

      await hook.handler({ event: { type: "session.idle", properties: { sessionID } } })
      await flushMicrotasks()

      // #then - only 2 attempts, then disabled
      expect(promptMock).toHaveBeenCalledTimes(2)
    } finally {
      Date.now = originalDateNow
      cleanupMessageStorage(sessionID)
    }
  })

  test("resets prompt-failure continuation lock on session.compacted", async () => {
    // #given
    const sessionID = "main-session-compacted-reset"
    setMainSession(sessionID)
    setupMessageStorage(sessionID, "workflow-automator")
    writeWorkState(TEST_DIR, {
      plan_id: "execution",
      execution_plan_path: ".orchestrator/plans/execution/plan.md",
      runtime_ledger_path: ".orchestrator/plans/execution/ledger.yaml",
      session_ids: [sessionID],
    })

    const promptMock = mock(() => Promise.reject(new Error("Bad Request")))
    const mockInput = createMockPluginInput({ promptMock })
    const hook = createExecutionOrchestratorHook(mockInput)

    const originalDateNow = Date.now
    let now = 0
    Date.now = () => now

    try {
      // #when - fail twice, hit lock, compact, then retry
      await hook.handler({ event: { type: "session.idle", properties: { sessionID } } })
      await flushMicrotasks()
      now += 6000

      await hook.handler({ event: { type: "session.idle", properties: { sessionID } } })
      await flushMicrotasks()
      now += 6000

      await hook.handler({ event: { type: "session.idle", properties: { sessionID } } })
      await flushMicrotasks()

      await hook.handler({ event: { type: "session.compacted", properties: { sessionID } } })
      now += 6000

      await hook.handler({ event: { type: "session.idle", properties: { sessionID } } })
      await flushMicrotasks()

      // #then - 2 failures + 1 post-compaction attempt
      expect(promptMock).toHaveBeenCalledTimes(3)
    } finally {
      Date.now = originalDateNow
      cleanupMessageStorage(sessionID)
    }
  })

  test("blocks direct task tool in execution mode", async () => {
    // #given
    const sessionID = "execution-task-warning"
    setupMessageStorage(sessionID, "workflow-automator")
    writeWorkState(TEST_DIR, {
      plan_id: "execution",
      execution_plan_path: ".orchestrator/plans/execution/plan.md",
      runtime_ledger_path: ".orchestrator/plans/execution/ledger.yaml",
      session_ids: [sessionID],
    })

    const hook = createExecutionOrchestratorHook(createMockPluginInput())
    const output = { args: {}, message: "" }

    // #when
    const call = hook["tool.execute.before"]({ tool: "task", sessionID }, output)

    // #then
    await expect(call).rejects.toThrow("forbidden in Execution Mode")

    cleanupMessageStorage(sessionID)
  })

  test("blocks delegate_task when execution-mode prompt is missing required structure", async () => {
    // #given
    const sessionID = "execution-bad-delegate-prompt"
    setupMessageStorage(sessionID, "workflow-automator")
    writeWorkState(TEST_DIR, {
      plan_id: "execution",
      execution_plan_path: ".orchestrator/plans/execution/plan.md",
      runtime_ledger_path: ".orchestrator/plans/execution/ledger.yaml",
      session_ids: [sessionID],
    })

    const hook = createExecutionOrchestratorHook(createMockPluginInput())
    const output = {
      args: {
        prompt: "Do this quickly and report back.",
      },
      message: "",
    }

    // #when
    const call = hook["tool.execute.before"]({ tool: "delegate_task", sessionID, callID: "call-bad-prompt" }, output)

    // #then
    await expect(call).rejects.toThrow("Delegate prompt missing required execution sections")

    cleanupMessageStorage(sessionID)
  })

  test("allows delegate_task when execution-mode prompt includes required sections", async () => {
    // #given
    const sessionID = "execution-good-delegate-prompt"
    setupMessageStorage(sessionID, "workflow-automator")
    writeWorkState(TEST_DIR, {
      plan_id: "execution",
      execution_plan_path: ".orchestrator/plans/execution/plan.md",
      runtime_ledger_path: ".orchestrator/plans/execution/ledger.yaml",
      session_ids: [sessionID],
    })

    const hook = createExecutionOrchestratorHook(createMockPluginInput())
    const structuredPrompt = `## 1. TASK
Implement atomic fix for login validator.

## 2. EXPECTED OUTCOME
- [ ] Files created/modified: src/auth/login.ts
- [ ] Functionality: Invalid tokens are rejected with 401
- [ ] Verification: bun test src/auth/login.test.ts passes

## 3. REQUIRED TOOLS
- Read: inspect current login validation flow
- Grep: find call-sites for token verification
- Bash: run targeted test suite

## 4. MUST DO
- Preserve public API shape for login handler
- Add regression test for malformed token
- Append findings to notepad

## 5. MUST NOT DO
- Do NOT modify unrelated auth middleware
- Do NOT add new dependencies
- Do NOT skip verification

## 6. CONTEXT
- Plan: .orchestrator/plans/execution/plan.md
- Dependencies: login test fixtures already exist
- Inherited Wisdom: strict token parsing is required for security
`
    const output = {
      args: {
        prompt: structuredPrompt,
      },
      message: "",
    }

    // #when
    await hook["tool.execute.before"]({ tool: "delegate_task", sessionID, callID: "call-good-prompt" }, output)

    // #then
    const nextPrompt = output.args.prompt as string
    expect(nextPrompt).toContain("SINGLE TASK ONLY")
    expect(nextPrompt).toContain("## 1. TASK")
    expect(output.message).toBe("")

    cleanupMessageStorage(sessionID)
  })

  test("injects single-task directive for workflow-automator execution profile delegation", async () => {
    // #given
    const sessionID = "workflow-automator-good-delegate-prompt"
    setupMessageStorage(sessionID, "workflow-automator")
    writeWorkState(TEST_DIR, {
      plan_id: "execution",
      executor: "workflow-automator",
      execution_plan_path: ".orchestrator/plans/execution/plan.md",
      runtime_ledger_path: ".orchestrator/plans/execution/ledger.yaml",
      session_ids: [sessionID],
    })

    const hook = createExecutionOrchestratorHook(createMockPluginInput())
    const output = {
      args: {
        prompt: `## 1. TASK
Implement atomic fix.

## 2. EXPECTED OUTCOME
- [ ] Verification passes
- [ ] Scope is bounded

## 3. REQUIRED TOOLS
- Read
- Edit
- Bash

## 4. MUST DO
- Keep the change minimal
- Verify result

## 5. MUST NOT DO
- Expand scope
- Skip verification

## 6. CONTEXT
- Plan: .orchestrator/plans/execution/plan.md
- Current focus: task-1
- Notes: follow repository style
`,
      },
      message: "",
    }

    // #when
    await hook["tool.execute.before"]({ tool: "delegate_task", sessionID, callID: "call-workflow-automator-prompt" }, output)

    // #then
    expect(output.args.prompt).toContain("SINGLE TASK ONLY")

    cleanupMessageStorage(sessionID)
  })

  test("warns on direct write outside .orchestrator in execution mode", async () => {
    // #given
    const sessionID = "execution-write-warning"
    setupMessageStorage(sessionID, "workflow-automator")
    writeWorkState(TEST_DIR, {
      plan_id: "execution",
      execution_plan_path: ".orchestrator/plans/execution/plan.md",
      runtime_ledger_path: ".orchestrator/plans/execution/ledger.yaml",
      session_ids: [sessionID],
    })

    const hook = createExecutionOrchestratorHook(createMockPluginInput())
    const output = {
      args: { filePath: "src/index.ts" },
      message: "",
    }

    // #when
    await hook["tool.execute.before"]({ tool: "Write", sessionID, callID: "call-1" }, output)

    // #then
    expect(output.message).toContain("DELEGATION REQUIRED")

    cleanupMessageStorage(sessionID)
  })

  test("uses unified delegation-required format for before/after write warnings", async () => {
    // #given
    const sessionID = "execution-write-warning-unified"
    setupMessageStorage(sessionID, "workflow-automator")
    writeWorkState(TEST_DIR, {
      plan_id: "execution",
      execution_plan_path: ".orchestrator/plans/execution/plan.md",
      runtime_ledger_path: ".orchestrator/plans/execution/ledger.yaml",
      session_ids: [sessionID],
    })

    const hook = createExecutionOrchestratorHook(createMockPluginInput())
    const beforeOutput = {
      args: { filePath: "src/unified-warning.ts" },
      message: "",
    }
    const afterOutput = {
      title: "write",
      output: "",
      metadata: {},
    }

    // #when
    await hook["tool.execute.before"]({ tool: "Write", sessionID, callID: "call-unified-warning" }, beforeOutput)
    await hook["tool.execute.after"]({ tool: "Write", sessionID, callID: "call-unified-warning" }, afterOutput)

    // #then
    expect(beforeOutput.message).toContain("DELEGATION REQUIRED")
    expect(beforeOutput.message).toContain("Path: `src/unified-warning.ts`")
    expect(afterOutput.output).toContain("DELEGATION REQUIRED")
    expect(afterOutput.output).toContain("Path: `src/unified-warning.ts`")

    cleanupMessageStorage(sessionID)
  })

  test("applies cooldown to repeated delegation-required warnings in execution mode", async () => {
    // #given
    const sessionID = "execution-write-warning-cooldown"
    setupMessageStorage(sessionID, "workflow-automator")
    writeWorkState(TEST_DIR, {
      plan_id: "execution",
      execution_plan_path: ".orchestrator/plans/execution/plan.md",
      runtime_ledger_path: ".orchestrator/plans/execution/ledger.yaml",
      session_ids: [sessionID],
    })

    const hook = createExecutionOrchestratorHook(createMockPluginInput())
    const first = {
      args: { filePath: "src/first.ts" },
      message: "",
    }
    const second = {
      args: { filePath: "src/second.ts" },
      message: "",
    }

    // #when
    await hook["tool.execute.before"]({ tool: "Write", sessionID, callID: "call-1" }, first)
    await hook["tool.execute.before"]({ tool: "Write", sessionID, callID: "call-2" }, second)

    // #then
    expect(first.message).toContain("DELEGATION REQUIRED")
    expect(second.message).toBe("")

    cleanupMessageStorage(sessionID)
  })

  test("does not warn for write inside .orchestrator", async () => {
    // #given
    const sessionID = "execution-write-plan"
    setupMessageStorage(sessionID, "workflow-automator")
    writeWorkState(TEST_DIR, {
      plan_id: "execution",
      execution_plan_path: ".orchestrator/plans/execution/plan.md",
      runtime_ledger_path: ".orchestrator/plans/execution/ledger.yaml",
      session_ids: [sessionID],
    })

    const hook = createExecutionOrchestratorHook(createMockPluginInput())
    const output = {
      args: { filePath: ".orchestrator/plans/execution/plan.md" },
      message: "",
    }

    // #when
    await hook["tool.execute.before"]({ tool: "Write", sessionID, callID: "call-2" }, output)

    // #then
    expect(output.message).toBe("")

    cleanupMessageStorage(sessionID)
  })

  test("summarizes large file-change sets with omission markers", () => {
    // #given
    const modified: GitFileStat[] = Array.from({ length: 9 }, (_, index) => ({
      path: `src/modified-${index + 1}.ts`,
      added: index + 1,
      removed: index,
      status: "modified",
    }))
    const created: GitFileStat[] = Array.from({ length: 6 }, (_, index) => ({
      path: `src/created-${index + 1}.ts`,
      added: index + 2,
      removed: 0,
      status: "added",
    }))
    const deleted: GitFileStat[] = Array.from({ length: 5 }, (_, index) => ({
      path: `src/deleted-${index + 1}.ts`,
      added: 0,
      removed: index + 2,
      status: "deleted",
    }))
    const stats = [...modified, ...created, ...deleted]

    // #when
    const summary = formatFileChanges(stats)

    // #then
    expect(summary).toContain("[FILE CHANGES SUMMARY]")
    expect(summary).toContain("... (5 more modified files omitted)")
    expect(summary).toContain("... (2 more created files omitted)")
    expect(summary).toContain("... (1 more deleted files omitted)")
    expect(summary).not.toContain("src/modified-9.ts")
    expect(summary).not.toContain("src/created-6.ts")
    expect(summary).not.toContain("src/deleted-5.ts")
  })

  test("reports compact reminder telemetry without downgrade", () => {
    // #given
    const planId = "execution"
    const planPath = ".orchestrator/plans/execution/plan.md"

    // #when
    const result = buildOrchestratorReminderWithTelemetry(
      planId,
      planPath,
      { total: 8, completed: 3 },
      "ses_compactTelemetry001",
      "compact"
    )

    // #then
    expect(result.telemetry.profile).toBe("compact")
    expect(result.telemetry.reason).toBe("none")
    expect(result.telemetry.fieldTruncated).toBe(false)
    expect(result.telemetry.budgetDowngraded).toBe(false)
    expect(result.telemetry.hardTruncated).toBe(false)
    expect(result.content).toContain("VERIFICATION LOOP (COMPACT)")
  })

  test("full reminder includes subagent notepad read step", () => {
    // #when
    const result = buildOrchestratorReminderWithTelemetry(
      "execution",
      ".orchestrator/plans/execution/plan.md",
      { total: 4, completed: 1 },
      "ses_notepad001",
      "full"
    )

    // #then
    expect(result.content).toContain("READ SUBAGENT NOTEPAD")
    expect(result.content).toContain('Glob(".orchestrator/notepads/execution/*.md")')
  })

  test("reports field-truncation telemetry for oversized session id", () => {
    // #given
    const oversizedSessionId = `ses_${"b".repeat(5000)}`

    // #when
    const result = buildOrchestratorReminderWithTelemetry(
      "execution",
      ".orchestrator/plans/execution/plan.md",
      { total: 2, completed: 1 },
      oversizedSessionId,
      "full"
    )

    // #then
    expect(result.telemetry.profile).toBe("ultra-compact")
    expect(result.telemetry.reason).toBe("field-truncation")
    expect(result.telemetry.fieldTruncated).toBe(true)
    expect(result.content).toContain("VERIFICATION LOOP (ULTRA-COMPACT)")
  })

  test("truncates file-change summary when character budget is exceeded", () => {
    // #given
    const longSegment = "very-long-path-segment-".repeat(18)
    const stats: GitFileStat[] = Array.from({ length: 20 }, (_, index) => ({
      path: `src/${longSegment}/module-${index + 1}.ts`,
      added: 10 + index,
      removed: index,
      status: "modified",
    }))

    // #when
    const summary = formatFileChanges(stats)

    // #then
    expect(summary).toContain("[summary truncated to fit context budget]")
    expect(summary.length).toBeLessThanOrEqual(1600)
  })

  test("transforms delegate_task output in execution mode", async () => {
    // #given
    const sessionID = "execution-delegate"
    setupMessageStorage(sessionID, "workflow-automator")

    const planPath = join(TEST_DIR, ".orchestrator", "plans", "execution", "plan.md")
    mkdirSync(join(TEST_DIR, ".orchestrator", "plans", "execution"), { recursive: true })
    writeFileSync(planPath, "# Plan\n\n## Tasks\n\n- 1. Task 1\n- 2. Task 2\n")

    writeWorkState(TEST_DIR, {
      plan_id: "execution",
      execution_plan_path: ".orchestrator/plans/execution/plan.md",
      runtime_ledger_path: ".orchestrator/plans/execution/ledger.yaml",
      session_ids: [sessionID],
    })

    const hook = createExecutionOrchestratorHook(createMockPluginInput())
    const output = {
      title: "delegate_task",
      output: "Subagent done\nSession ID: ses_test123",
      metadata: {},
    }

    // #when
    await hook["tool.execute.after"]({ tool: "delegate_task", sessionID }, output)

    // #then
    expect(output.output).toContain("SUBAGENT WORK COMPLETED")
    expect(output.output).toContain("MANDATORY")
    expect(output.output).toContain('session_id="ses_test123"')

    cleanupMessageStorage(sessionID)
  })

  test("uses compact verification reminder after first delegation completion in same session", async () => {
    // #given
    const sessionID = "execution-delegate-compact-reminder"
    setupMessageStorage(sessionID, "workflow-automator")

    const planPath = join(TEST_DIR, ".orchestrator", "plans", "execution", "plan.md")
    mkdirSync(join(TEST_DIR, ".orchestrator", "plans", "execution"), { recursive: true })
    writeFileSync(planPath, "# Plan\n\n## Tasks\n\n- 1. Task 1\n- 2. Task 2\n")

    writeWorkState(TEST_DIR, {
      plan_id: "execution",
      execution_plan_path: ".orchestrator/plans/execution/plan.md",
      runtime_ledger_path: ".orchestrator/plans/execution/ledger.yaml",
      session_ids: [sessionID],
    })

    const hook = createExecutionOrchestratorHook(createMockPluginInput())
    const firstOutput = {
      title: "delegate_task",
      output: "First subagent done\nSession ID: ses_compact001",
      metadata: {},
    }
    const secondOutput = {
      title: "delegate_task",
      output: "Second subagent done\nSession ID: ses_compact002",
      metadata: {},
    }

    // #when
    await hook["tool.execute.after"]({ tool: "delegate_task", sessionID, callID: "compact-call-1" }, firstOutput)
    await hook["tool.execute.after"]({ tool: "delegate_task", sessionID, callID: "compact-call-2" }, secondOutput)

    // #then
    expect(firstOutput.output).toContain("MANDATORY: WHAT YOU MUST DO RIGHT NOW")
    expect(secondOutput.output).toContain("VERIFICATION LOOP (COMPACT)")

    cleanupMessageStorage(sessionID)
  })

  test("falls back to ultra-compact reminder when orchestration reminder exceeds budget", async () => {
    // #given
    const sessionID = "execution-delegate-ultra-compact"
    setupMessageStorage(sessionID, "workflow-automator")

    const planPath = join(TEST_DIR, ".orchestrator", "plans", "execution", "plan.md")
    mkdirSync(join(TEST_DIR, ".orchestrator", "plans", "execution"), { recursive: true })
    writeFileSync(planPath, "# Plan\n\n## Tasks\n\n- 1. Task 1\n- 2. Task 2\n")

    writeWorkState(TEST_DIR, {
      plan_id: "execution",
      execution_plan_path: ".orchestrator/plans/execution/plan.md",
      runtime_ledger_path: ".orchestrator/plans/execution/ledger.yaml",
      session_ids: [sessionID],
    })

    const hook = createExecutionOrchestratorHook(createMockPluginInput())
    const oversizedSubagentSession = `ses_${"a".repeat(6000)}`
    const output = {
      title: "delegate_task",
      output: `Subagent done\nSession ID: ${oversizedSubagentSession}`,
      metadata: {},
    }

    // #when
    await hook["tool.execute.after"]({ tool: "delegate_task", sessionID, callID: "ultra-compact-call-1" }, output)

    // #then
    expect(output.output).toContain("VERIFICATION LOOP (ULTRA-COMPACT)")
    expect(output.output).toContain("[orchestrator reminder downgraded due to context budget]")
    expect(output.output).not.toContain("MANDATORY: WHAT YOU MUST DO RIGHT NOW")

    cleanupMessageStorage(sessionID)
  })

  test("skips orchestration transform outside execution mode", async () => {
    // #given
    const sessionID = "regular-orchestrator"
    setupMessageStorage(sessionID, "workflow-automator")

    const hook = createExecutionOrchestratorHook(createMockPluginInput())
    const output = {
      title: "delegate_task",
      output: "Subagent done\nSession ID: ses_plain123",
      metadata: {},
    }

    // #when
    await hook["tool.execute.after"]({ tool: "delegate_task", sessionID }, output)

    // #then
    expect(output.output).toBe("Subagent done\nSession ID: ses_plain123")

    cleanupMessageStorage(sessionID)
  })

  test("blocks task_transition completed when verifier evidence is missing", async () => {
    // #given
    const sessionID = "execution-verifier-missing"
    setupMessageStorage(sessionID, "workflow-automator")
    writeWorkState(TEST_DIR, {
      plan_id: "execution",
      execution_plan_path: ".orchestrator/plans/execution/plan.md",
      runtime_ledger_path: ".orchestrator/plans/execution/ledger.yaml",
      session_ids: [sessionID],
    })
    const hook = createExecutionOrchestratorHook(createMockPluginInput())

    await hook["tool.execute.after"](
      { tool: "Write", sessionID, callID: "verifier-write-1" },
      {
        title: "write",
        output: "ok",
        metadata: {
          success: true,
          args: { file_path: "src/verifier.ts" },
        },
      }
    )

    // #when / #then
    await expect(
      hook["tool.execute.before"](
        { tool: "task_transition", sessionID, callID: "verifier-transition-1" },
        {
          args: {
            id: "task-1",
            expected_revision: 1,
            next_state: "completed",
          },
          message: "",
        }
      )
    ).rejects.toThrow("Verifier gate blocked task completion")

    cleanupMessageStorage(sessionID)
  })

  test("allows task_transition completed when verifier evidence is valid", async () => {
    // #given
    const sessionID = "execution-verifier-pass"
    setupMessageStorage(sessionID, "workflow-automator")
    writeWorkState(TEST_DIR, {
      plan_id: "execution",
      execution_plan_path: ".orchestrator/plans/execution/plan.md",
      runtime_ledger_path: ".orchestrator/plans/execution/ledger.yaml",
      session_ids: [sessionID],
    })
    const hook = createExecutionOrchestratorHook(createMockPluginInput())

    await hook["tool.execute.after"](
      { tool: "Write", sessionID, callID: "verifier-write-2" },
      {
        title: "write",
        output: "ok",
        metadata: {
          success: true,
          args: { file_path: "src/verifier-pass.ts" },
        },
      }
    )
    await hook["tool.execute.after"](
      { tool: "lsp_diagnostics", sessionID, callID: "verifier-lsp-2" },
      {
        title: "lsp_diagnostics",
        output: "No diagnostics found.",
        metadata: {
          success: true,
          args: { paths: ["src/verifier-pass.ts"] },
        },
      }
    )
    await hook["tool.execute.after"](
      { tool: "bash", sessionID, callID: "verifier-bash-2" },
      {
        title: "bash",
        output: "All tests passed",
        metadata: {
          success: true,
          exitCode: 0,
          args: { command: "bun test src/verifier-pass.test.ts" },
        },
      }
    )

    // #when / #then
    await expect(
      hook["tool.execute.before"](
        { tool: "task_transition", sessionID, callID: "verifier-transition-2" },
        {
          args: {
            id: "task-2",
            expected_revision: 1,
            next_state: "completed",
          },
          message: "",
        }
      )
    ).resolves.toBeUndefined()

    cleanupMessageStorage(sessionID)
  })

  test("expires verifier evidence by TTL and blocks completion", async () => {
    // #given
    const sessionID = "execution-verifier-ttl"
    setupMessageStorage(sessionID, "workflow-automator")
    writeWorkState(TEST_DIR, {
      plan_id: "execution",
      execution_plan_path: ".orchestrator/plans/execution/plan.md",
      runtime_ledger_path: ".orchestrator/plans/execution/ledger.yaml",
      session_ids: [sessionID],
    })
    const hook = createExecutionOrchestratorHook(createMockPluginInput(), {
      verifierGate: {
        evidence_ttl_ms: 1,
      },
    })

    const originalNow = Date.now
    let now = 1000
    Date.now = () => now

    try {
      await hook["tool.execute.after"](
        { tool: "Write", sessionID, callID: "ttl-write" },
        {
          title: "write",
          output: "ok",
          metadata: {
            success: true,
            args: { file_path: "src/ttl.ts" },
          },
        }
      )
      await hook["tool.execute.after"](
        { tool: "lsp_diagnostics", sessionID, callID: "ttl-lsp" },
        {
          title: "lsp",
          output: "No diagnostics",
          metadata: {
            success: true,
            args: { paths: ["src/ttl.ts"] },
          },
        }
      )
      await hook["tool.execute.after"](
        { tool: "bash", sessionID, callID: "ttl-bash" },
        {
          title: "bash",
          output: "ok",
          metadata: {
            success: true,
            exitCode: 0,
            args: { command: "bun test src/ttl.test.ts" },
          },
        }
      )

      now += 5

      // #when / #then
      await expect(
        hook["tool.execute.before"](
          { tool: "task_transition", sessionID, callID: "ttl-transition" },
          {
            args: {
              id: "task-ttl",
              expected_revision: 1,
              next_state: "completed",
            },
            message: "",
          }
        )
      ).rejects.toThrow("Verifier gate blocked task completion")
    } finally {
      Date.now = originalNow
      cleanupMessageStorage(sessionID)
    }
  })

  test("allows completion when no code changes occurred and allow_no_code_change is enabled", async () => {
    // #given
    const sessionID = "execution-verifier-no-code-change"
    setupMessageStorage(sessionID, "workflow-automator")
    writeWorkState(TEST_DIR, {
      plan_id: "execution",
      execution_plan_path: ".orchestrator/plans/execution/plan.md",
      runtime_ledger_path: ".orchestrator/plans/execution/ledger.yaml",
      session_ids: [sessionID],
    })
    const hook = createExecutionOrchestratorHook(createMockPluginInput())

    // #when / #then
    await expect(
      hook["tool.execute.before"](
        { tool: "task_transition", sessionID, callID: "no-code-transition" },
        {
          args: {
            id: "task-no-code",
            expected_revision: 1,
            next_state: "completed",
          },
          message: "",
        }
      )
    ).resolves.toBeUndefined()

    cleanupMessageStorage(sessionID)
  })

  test("triggers auto handoff after consecutive verifier denials", async () => {
    // #given
    const sessionID = "execution-auto-handoff-verifier"
    setupMessageStorage(sessionID, "workflow-automator")
    writeWorkState(TEST_DIR, {
      plan_id: "execution",
      execution_plan_path: ".orchestrator/plans/execution/plan.md",
      runtime_ledger_path: ".orchestrator/plans/execution/ledger.yaml",
      session_ids: [sessionID],
    })
    const requestAutoHandoff = mock(async () => ({
      status: "preview" as const,
      prompt: "handoff prompt",
      message: "preview",
      fallbackPreview: true,
    }))
    const markContinuationStopped = mock(() => {})
    const hook = createExecutionOrchestratorHook(createMockPluginInput(), {
      requestAutoHandoff,
      markContinuationStopped,
      autoHandoff: {
        trigger_verifier_denials: 2,
        cooldown_ms: 600000,
      },
    })

    await hook["tool.execute.after"](
      { tool: "Write", sessionID, callID: "auto-write" },
      {
        title: "write",
        output: "ok",
        metadata: {
          success: true,
          args: { file_path: "src/auto.ts" },
        },
      }
    )

    await expect(
      hook["tool.execute.before"](
        { tool: "task_transition", sessionID, callID: "auto-transition-1" },
        { args: { id: "task-1", expected_revision: 1, next_state: "completed" }, message: "" }
      )
    ).rejects.toThrow("Verifier gate blocked task completion")
    await expect(
      hook["tool.execute.before"](
        { tool: "task_transition", sessionID, callID: "auto-transition-2" },
        { args: { id: "task-1", expected_revision: 1, next_state: "completed" }, message: "" }
      )
    ).rejects.toThrow("Verifier gate blocked task completion")
    await flushMicrotasks()

    // #then
    expect(requestAutoHandoff).toHaveBeenCalledTimes(1)
    expect(markContinuationStopped).not.toHaveBeenCalled()

    cleanupMessageStorage(sessionID)
  })

  test("stops continuation only when auto handoff launches a new session", async () => {
    // #given
    const sessionID = "execution-auto-handoff-stop-on-launch"
    setupMessageStorage(sessionID, "workflow-automator")
    writeWorkState(TEST_DIR, {
      plan_id: "execution",
      execution_plan_path: ".orchestrator/plans/execution/plan.md",
      runtime_ledger_path: ".orchestrator/plans/execution/ledger.yaml",
      session_ids: [sessionID],
    })
    const requestAutoHandoff = mock(async () => ({
      status: "launched" as const,
      prompt: "handoff prompt",
      message: "launched",
      newSessionId: "ses_auto_launch",
      fallbackPreview: false,
    }))
    const markContinuationStopped = mock(() => {})
    const hook = createExecutionOrchestratorHook(createMockPluginInput(), {
      requestAutoHandoff,
      markContinuationStopped,
      autoHandoff: {
        trigger_verifier_denials: 2,
      },
    })

    await hook["tool.execute.after"](
      { tool: "Write", sessionID, callID: "auto-write-stop" },
      {
        title: "write",
        output: "ok",
        metadata: {
          success: true,
          args: { file_path: "src/auto-stop.ts" },
        },
      }
    )

    await expect(
      hook["tool.execute.before"](
        { tool: "task_transition", sessionID, callID: "auto-stop-transition-1" },
        { args: { id: "task-1", expected_revision: 1, next_state: "completed" }, message: "" }
      )
    ).rejects.toThrow("Verifier gate blocked task completion")
    await expect(
      hook["tool.execute.before"](
        { tool: "task_transition", sessionID, callID: "auto-stop-transition-2" },
        { args: { id: "task-1", expected_revision: 1, next_state: "completed" }, message: "" }
      )
    ).rejects.toThrow("Verifier gate blocked task completion")
    await flushMicrotasks()

    // #then
    expect(requestAutoHandoff).toHaveBeenCalledTimes(1)
    expect(markContinuationStopped).toHaveBeenCalledTimes(1)

    cleanupMessageStorage(sessionID)
  })

  test("includes unresolved discoveries in auto handoff request payload", async () => {
    // #given
    const sessionID = "execution-auto-handoff-discovery"
    setupMessageStorage(sessionID, "workflow-automator")
    writeWorkState(TEST_DIR, {
      plan_id: "execution",
      execution_plan_path: ".orchestrator/plans/execution/plan.md",
      runtime_ledger_path: ".orchestrator/plans/execution/ledger.yaml",
      session_ids: [sessionID],
    })
    const requestAutoHandoff = mock(async () => ({
      status: "preview" as const,
      prompt: "handoff prompt",
      message: "preview",
      fallbackPreview: true,
    }))
    const hook = createExecutionOrchestratorHook(createMockPluginInput(), {
      requestAutoHandoff,
      autoHandoff: {
        trigger_verifier_denials: 2,
      },
    })

    await hook["tool.execute.after"](
      { tool: "delegate_task", sessionID, callID: "discovery-call-1" },
      {
        title: "delegate_task",
        output: "DISCOVERY: race in retry queue\nSession ID: ses_d1",
        metadata: {},
      }
    )
    await hook["tool.execute.after"](
      { tool: "Write", sessionID, callID: "discovery-write-1" },
      {
        title: "write",
        output: "ok",
        metadata: {
          success: true,
          args: { file_path: "src/discovery.ts" },
        },
      }
    )

    await expect(
      hook["tool.execute.before"](
        { tool: "task_transition", sessionID, callID: "discovery-transition-1" },
        { args: { id: "task-1", expected_revision: 1, next_state: "completed" }, message: "" }
      )
    ).rejects.toThrow()
    await expect(
      hook["tool.execute.before"](
        { tool: "task_transition", sessionID, callID: "discovery-transition-2" },
        { args: { id: "task-1", expected_revision: 1, next_state: "completed" }, message: "" }
      )
    ).rejects.toThrow()
    await flushMicrotasks()

    // #then
    expect(requestAutoHandoff).toHaveBeenCalledTimes(1)
    const requestPayload = requestAutoHandoff.mock.calls[0]?.[0] as {
      unresolvedDiscoveries?: Array<{ claim: string; sourceEventId?: string; retrievalPath?: string }>
    }
    expect(requestPayload.unresolvedDiscoveries?.length).toBeGreaterThan(0)
    expect(requestPayload.unresolvedDiscoveries?.[0]?.claim).toContain("race in retry queue")
    expect(requestPayload.unresolvedDiscoveries?.[0]?.sourceEventId).toBe("discovery-call-1")
    expect(requestPayload.unresolvedDiscoveries?.[0]?.retrievalPath).toBe("tool.delegate_task.output")

    cleanupMessageStorage(sessionID)
  })

  test("auto_task_create creates discovery follow-up tasks when enabled", async () => {
    // #given
    const sessionID = "execution-discovery-auto-task"
    const planId = "execution"
    setupMessageStorage(sessionID, "workflow-automator")
    writeWorkState(TEST_DIR, {
      plan_id: planId,
      execution_plan_path: ".orchestrator/plans/execution/plan.md",
      runtime_ledger_path: ".orchestrator/plans/execution/ledger.yaml",
      session_ids: [sessionID],
    })

    const hook = createExecutionOrchestratorHook(createMockPluginInput(), {
      discoveryChannel: {
        enabled: true,
        capture_delegate_output: true,
        auto_task_create: true,
      },
    })

    // #when
    await hook["tool.execute.after"](
      { tool: "delegate_task", sessionID, callID: "discovery-auto-task-1" },
      {
        title: "delegate_task",
        output: "DISCOVERY: race in retry queue\nDISCOVERY: race in retry queue",
        metadata: {},
      }
    )

    // #then
    const tasks = listTaskNodes(
      {
        scope: "plan",
        container_id: planId,
        include_completed: true,
      },
      TEST_TASK_CONFIG
    )
    const discoveryTasks = tasks.filter((task) => task.title.includes("Discovery: race in retry queue"))
    expect(discoveryTasks).toHaveLength(1)

    cleanupMessageStorage(sessionID)
  })

  test("triggers auto handoff after consecutive context-pressure hits", async () => {
    // #given
    const sessionID = "execution-auto-handoff-pressure"
    setupMessageStorage(sessionID, "workflow-automator")
    writeWorkState(TEST_DIR, {
      plan_id: "execution",
      execution_plan_path: ".orchestrator/plans/execution/plan.md",
      runtime_ledger_path: ".orchestrator/plans/execution/ledger.yaml",
      session_ids: [sessionID],
    })
    const requestAutoHandoff = mock(async () => ({
      status: "launched" as const,
      prompt: "handoff prompt",
      message: "launched",
      newSessionId: "ses_new_auto",
      fallbackPreview: false,
    }))
    const hook = createExecutionOrchestratorHook(createMockPluginInput(), {
      requestAutoHandoff,
      autoHandoff: {
        trigger_context_pressure_hits: 2,
        cooldown_ms: 600000,
      },
    })

    // #when
    ;(hook as unknown as {
      onPolicyContextPressure: (input: {
        sessionID: string
        pressureRatio: number
        estimatedRecentTokens: number
        hardLimit: number
      }) => void
    }).onPolicyContextPressure({
      sessionID,
      pressureRatio: 0.95,
      estimatedRecentTokens: 950,
      hardLimit: 1000,
    })
    ;(hook as unknown as {
      onPolicyContextPressure: (input: {
        sessionID: string
        pressureRatio: number
        estimatedRecentTokens: number
        hardLimit: number
      }) => void
    }).onPolicyContextPressure({
      sessionID,
      pressureRatio: 0.96,
      estimatedRecentTokens: 960,
      hardLimit: 1000,
    })
    await flushMicrotasks()

    // #then
    expect(requestAutoHandoff).toHaveBeenCalledTimes(1)

    cleanupMessageStorage(sessionID)
  })
})
