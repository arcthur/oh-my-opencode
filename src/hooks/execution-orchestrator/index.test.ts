import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { isAbsolute, join } from "node:path"
import * as yaml from "js-yaml"
import { createDirectContinuationReporterForTesting } from "../continuation-control"
import {
  createExecutionOrchestratorHook as createExecutionOrchestratorHookBase,
  type ExecutionOrchestratorHookOptions,
} from "./index"
import type { WorkState } from "../../features/work-state"
import { _resetForTesting, setMainSession } from "../../features/claude-code-session-state"
import { MESSAGE_STORAGE, setOpenCodeStorageDirForTesting } from "../../features/hook-message-injector"

function writeWorkState(directory: string, state: Partial<WorkState>): void {
  const sisyphusDir = join(directory, ".sisyphus")
  if (!existsSync(sisyphusDir)) {
    mkdirSync(sisyphusDir, { recursive: true })
  }

  const planId = state.plan_id ?? "test-plan"
  const canonicalPlanPath = `.sisyphus/plans/${planId}/plan.md`
  const canonicalLedgerPath = `.sisyphus/plans/${planId}/ledger.yaml`
  const canonicalPlanAbsPath = join(directory, canonicalPlanPath)
  const canonicalPlanDir = join(directory, ".sisyphus", "plans", planId)
  mkdirSync(canonicalPlanDir, { recursive: true })

  const rawPath = state.execution_plan_path
  const legacyPlanPath =
    typeof rawPath === "string" && rawPath.length > 0
      ? (isAbsolute(rawPath) ? rawPath : join(directory, rawPath))
      : null

  if (legacyPlanPath && existsSync(legacyPlanPath)) {
    writeFileSync(canonicalPlanAbsPath, readFileSync(legacyPlanPath, "utf-8"))
  } else if (!existsSync(canonicalPlanAbsPath)) {
    writeFileSync(canonicalPlanAbsPath, "# Plan\n\n- [ ] 1. Task\n")
  }

  const canonicalLedgerAbsPath = join(directory, canonicalLedgerPath)
  if (!existsSync(canonicalLedgerAbsPath)) {
    writeFileSync(
      canonicalLedgerAbsPath,
      `schema_version: 1\nplan_id: ${planId}\nerrors: []\nblockers: []\ndecisions: []\nupdated_at: \"2026-02-06T00:00:00Z\"\n`
    )
  }

  const fullState: WorkState = {
    schema_version: 2,
    plan_id: planId,
    execution_plan_path: canonicalPlanPath,
    runtime_ledger_path: canonicalLedgerPath,
    started_at: state.started_at ?? new Date().toISOString(),
    session_ids: state.session_ids ?? [],
    research_ops: state.research_ops ?? 0,
    last_findings_mtime: state.last_findings_mtime ?? 0,
    errors: state.errors ?? [],
    blockers: state.blockers ?? [],
    phase_completions: state.phase_completions ?? [],
    decisions: state.decisions ?? [],
    task_snapshot: state.task_snapshot,
    last_updated: state.last_updated,
  }

  writeFileSync(join(sisyphusDir, "work.yaml"), yaml.dump(fullState, { indent: 2 }))
}

describe("execution-orchestrator hook", () => {
  const TEST_DIR = join(tmpdir(), "execution-orchestrator-test")
  const TEST_STORAGE_DIR = join(tmpdir(), "opencode-storage-execution-orchestrator-test")

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
    setOpenCodeStorageDirForTesting(TEST_STORAGE_DIR)
    _resetForTesting()
    if (!existsSync(TEST_DIR)) {
      mkdirSync(TEST_DIR, { recursive: true })
    }
    mkdirSync(join(TEST_DIR, ".sisyphus"), { recursive: true })
  })

  afterEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true })
    }
    _resetForTesting()
  })

  test("injects continuation for execution-mode session on idle", async () => {
    // #given
    const sessionID = "main-session"
    setMainSession(sessionID)
    setupMessageStorage(sessionID, "sisyphus")

    const planPath = join(TEST_DIR, ".sisyphus", "plans", "execution", "plan.md")
    mkdirSync(join(TEST_DIR, ".sisyphus", "plans", "execution"), { recursive: true })
    writeFileSync(planPath, "# Plan\n- [ ] Task 1\n- [x] Task 2\n")

    writeWorkState(TEST_DIR, {
      plan_id: "execution",
      execution_plan_path: ".sisyphus/plans/execution/plan.md",
      runtime_ledger_path: ".sisyphus/plans/execution/ledger.yaml",
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
    expect(args.body.agent).toBe("sisyphus")
    expect(args.body.parts[0].text).toContain("WORK CONTINUATION")

    cleanupMessageStorage(sessionID)
  })

  test("reports continuation intent when reporter is configured", async () => {
    // #given
    const sessionID = "main-session-reporter"
    setMainSession(sessionID)
    setupMessageStorage(sessionID, "sisyphus")

    writeWorkState(TEST_DIR, {
      plan_id: "execution",
      execution_plan_path: ".sisyphus/plans/execution/plan.md",
      runtime_ledger_path: ".sisyphus/plans/execution/ledger.yaml",
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
    expect(intents[0].source).toBe("execution-orchestrator")
    expect(intents[0].round).toBe(13)
    expect(intents[0].text).toContain("WORK CONTINUATION")

    cleanupMessageStorage(sessionID)
  })

  test("waits for continuation reporter completion in idle handling", async () => {
    // #given
    const sessionID = "main-session-reporter-await"
    setMainSession(sessionID)
    setupMessageStorage(sessionID, "sisyphus")

    writeWorkState(TEST_DIR, {
      plan_id: "execution",
      execution_plan_path: ".sisyphus/plans/execution/plan.md",
      runtime_ledger_path: ".sisyphus/plans/execution/ledger.yaml",
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
    setupMessageStorage(sessionID, "sisyphus")

    writeWorkState(TEST_DIR, {
      plan_id: "execution",
      execution_plan_path: ".sisyphus/plans/execution/plan.md",
      runtime_ledger_path: ".sisyphus/plans/execution/ledger.yaml",
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
    setupMessageStorage(sessionID, "sisyphus")

    writeWorkState(TEST_DIR, {
      plan_id: "execution",
      execution_plan_path: ".sisyphus/plans/execution/plan.md",
      runtime_ledger_path: ".sisyphus/plans/execution/ledger.yaml",
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
    setupMessageStorage(sessionID, "sisyphus")
    writeWorkState(TEST_DIR, {
      plan_id: "execution",
      execution_plan_path: ".sisyphus/plans/execution/plan.md",
      runtime_ledger_path: ".sisyphus/plans/execution/ledger.yaml",
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
    setupMessageStorage(sessionID, "sisyphus")
    writeWorkState(TEST_DIR, {
      plan_id: "execution",
      execution_plan_path: ".sisyphus/plans/execution/plan.md",
      runtime_ledger_path: ".sisyphus/plans/execution/ledger.yaml",
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
    setupMessageStorage(sessionID, "sisyphus")
    writeWorkState(TEST_DIR, {
      plan_id: "execution",
      execution_plan_path: ".sisyphus/plans/execution/plan.md",
      runtime_ledger_path: ".sisyphus/plans/execution/ledger.yaml",
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
    setupMessageStorage(sessionID, "sisyphus")
    writeWorkState(TEST_DIR, {
      plan_id: "execution",
      execution_plan_path: ".sisyphus/plans/execution/plan.md",
      runtime_ledger_path: ".sisyphus/plans/execution/ledger.yaml",
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
    setupMessageStorage(sessionID, "sisyphus")
    writeWorkState(TEST_DIR, {
      plan_id: "execution",
      execution_plan_path: ".sisyphus/plans/execution/plan.md",
      runtime_ledger_path: ".sisyphus/plans/execution/ledger.yaml",
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
- Plan: .sisyphus/plans/execution/plan.md
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

  test("warns on direct write outside .sisyphus in execution mode", async () => {
    // #given
    const sessionID = "execution-write-warning"
    setupMessageStorage(sessionID, "sisyphus")
    writeWorkState(TEST_DIR, {
      plan_id: "execution",
      execution_plan_path: ".sisyphus/plans/execution/plan.md",
      runtime_ledger_path: ".sisyphus/plans/execution/ledger.yaml",
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

  test("does not warn for write inside .sisyphus", async () => {
    // #given
    const sessionID = "execution-write-plan"
    setupMessageStorage(sessionID, "sisyphus")
    writeWorkState(TEST_DIR, {
      plan_id: "execution",
      execution_plan_path: ".sisyphus/plans/execution/plan.md",
      runtime_ledger_path: ".sisyphus/plans/execution/ledger.yaml",
      session_ids: [sessionID],
    })

    const hook = createExecutionOrchestratorHook(createMockPluginInput())
    const output = {
      args: { filePath: ".sisyphus/plans/execution/plan.md" },
      message: "",
    }

    // #when
    await hook["tool.execute.before"]({ tool: "Write", sessionID, callID: "call-2" }, output)

    // #then
    expect(output.message).toBe("")

    cleanupMessageStorage(sessionID)
  })

  test("transforms delegate_task output in execution mode", async () => {
    // #given
    const sessionID = "execution-delegate"
    setupMessageStorage(sessionID, "sisyphus")

    const planPath = join(TEST_DIR, ".sisyphus", "plans", "execution", "plan.md")
    mkdirSync(join(TEST_DIR, ".sisyphus", "plans", "execution"), { recursive: true })
    writeFileSync(planPath, "# Plan\n- [ ] Task 1\n- [x] Task 2\n")

    writeWorkState(TEST_DIR, {
      plan_id: "execution",
      execution_plan_path: ".sisyphus/plans/execution/plan.md",
      runtime_ledger_path: ".sisyphus/plans/execution/ledger.yaml",
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

  test("skips orchestration transform outside execution mode", async () => {
    // #given
    const sessionID = "regular-sisyphus"
    setupMessageStorage(sessionID, "sisyphus")

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
})
