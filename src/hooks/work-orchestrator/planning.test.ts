import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import * as yaml from "js-yaml"
import type { PluginInput } from "@opencode-ai/plugin"
import { ContextCollector, createContextInjectorMessagesTransformHook } from "../../features/context-injector"
import { initializePlan } from "../../features/planning-with-files/manager"
import { DEFAULT_PLANNING_CONFIG } from "../../features/planning-with-files/types"
import { createTaskNode } from "../../features/task-system"
import { createDirectContinuationReporterForTesting } from "./index"
import {
  createPlanningWithFilesHook as createPlanningWithFilesHookBase,
  type PlanningWithFilesHookOptions,
} from "./planning"

function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "planning-with-files-hook-"))
}

function readWorkState(projectDir: string): Record<string, unknown> | null {
  const workPath = path.join(projectDir, ".sisyphus", "work.yaml")
  if (!fs.existsSync(workPath)) return null
  return (yaml.load(fs.readFileSync(workPath, "utf-8")) as Record<string, unknown> | null) ?? null
}

function createMockPluginInput(
  projectDir: string,
  promptCalls: Array<{ sessionID: string; text: string }>
): PluginInput {
  return {
    directory: projectDir,
    client: {
      session: {
        prompt: async (req: any) => {
          const sessionID = req?.path?.id as string
          const text = req?.body?.parts?.[0]?.text as string
          promptCalls.push({ sessionID, text })
          return { data: true }
        },
      },
      tui: {
        showToast: async () => ({ data: true }),
      },
    },
  } as any
}

type TestPlanningWithFilesHookOptions = Omit<
  PlanningWithFilesHookOptions,
  "reportContinuationIntent"
> & {
  reportContinuationIntent?: PlanningWithFilesHookOptions["reportContinuationIntent"]
}

function createPlanningWithFilesHook(
  input: PluginInput,
  options: TestPlanningWithFilesHookOptions
) {
  return createPlanningWithFilesHookBase(input, {
    ...options,
    reportContinuationIntent:
      options.reportContinuationIntent ?? createDirectContinuationReporterForTesting(input),
  })
}

describe("work-orchestrator planning phase", () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = createTempDir()
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  test("registers plan.md context for trigger tools (injected via ContextCollector)", async () => {
    // given
    await initializePlan(tmpDir, "e2e-plan", "Implement feature X")
    const collector = new ContextCollector()
    const promptCalls: Array<{ sessionID: string; text: string }> = []
    const hook = createPlanningWithFilesHook(createMockPluginInput(tmpDir, promptCalls), {
      config: { enabled: true },
      collector,
    })

    // when
    await hook["tool.execute.before"]?.(
      { tool: "Write", sessionID: "session-1", callID: "call-1" },
      { args: { path: "src/file.ts", content: "export {}" } }
    )

    // then
    expect(collector.hasPending("session-1")).toBe(true)
    const pending = collector.getPending("session-1")
    expect(pending.merged).toContain("<plan-context>")
    expect(pending.merged).toContain("Implement feature X")

    // then - end-to-end injection into last user message
    const ctxInjector = createContextInjectorMessagesTransformHook(collector)
    const output = {
      messages: [
        {
          info: { role: "user", sessionID: "session-1" },
          parts: [{ type: "text", text: "Do the next step" }],
        },
      ],
    }
    await ctxInjector["experimental.chat.messages.transform"]?.({}, output as any)

    expect(output.messages[0].parts[0].text).toContain("<plan-context>")
    expect(output.messages[0].parts[0].text).toContain("# Plan: e2e-plan")
    expect(collector.hasPending("session-1")).toBe(false)
  })

  test("emits two-action-rule reminder after 2 counted research tools", async () => {
    // given
    await initializePlan(tmpDir, "e2e-plan", "Goal")
    const collector = new ContextCollector()
    const promptCalls: Array<{ sessionID: string; text: string }> = []
    const hook = createPlanningWithFilesHook(createMockPluginInput(tmpDir, promptCalls), {
      config: { enabled: true },
      collector,
    })

    // when - first action
    await hook["tool.execute.after"]?.(
      { tool: "Read", sessionID: "session-2", callID: "call-1" },
      { title: "Read", output: "ok", metadata: {} }
    )

    // then - no reminder yet
    expect(collector.hasPending("session-2")).toBe(false)

    // when - second action
    await hook["tool.execute.after"]?.(
      { tool: "Read", sessionID: "session-2", callID: "call-2" },
      { title: "Read", output: "ok", metadata: {} }
    )

    // then - reminder registered
    expect(collector.hasPending("session-2")).toBe(true)
    const pending = collector.getPending("session-2")
    expect(pending.merged).toContain("<two-action-rule>")
    expect(pending.merged).toContain("findings.md")
    const state = readWorkState(tmpDir)
    expect(state).not.toBeNull()
    expect(state?.protocol.research_ops).toBe(2)
  })

  test("does not re-emit two-action-rule on odd action counts", async () => {
    // given
    await initializePlan(tmpDir, "e2e-plan", "Goal")
    const collector = new ContextCollector()
    const promptCalls: Array<{ sessionID: string; text: string }> = []
    const hook = createPlanningWithFilesHook(createMockPluginInput(tmpDir, promptCalls), {
      config: { enabled: true },
      collector,
    })

    // when - reach 2 actions (emit reminder)
    await hook["tool.execute.after"]?.(
      { tool: "Read", sessionID: "session-2-odd", callID: "call-1" },
      { title: "Read", output: "ok", metadata: {} }
    )
    await hook["tool.execute.after"]?.(
      { tool: "Read", sessionID: "session-2-odd", callID: "call-2" },
      { title: "Read", output: "ok", metadata: {} }
    )

    expect(collector.hasPending("session-2-odd")).toBe(true)
    collector.consume("session-2-odd")

    // when - 3rd action (no reminder expected)
    await hook["tool.execute.after"]?.(
      { tool: "Read", sessionID: "session-2-odd", callID: "call-3" },
      { title: "Read", output: "ok", metadata: {} }
    )

    // then
    expect(collector.hasPending("session-2-odd")).toBe(false)
  })

  test("auto-resets two-action counter when findings.md is modified", async () => {
    // given
    await initializePlan(tmpDir, "reset-plan", "Goal")
    const collector = new ContextCollector()
    const promptCalls: Array<{ sessionID: string; text: string }> = []
    const hook = createPlanningWithFilesHook(createMockPluginInput(tmpDir, promptCalls), {
      config: { enabled: true },
      collector,
    })

    // Trigger reminder (2 actions)
    await hook["tool.execute.after"]?.(
      { tool: "Read", sessionID: "session-3", callID: "call-1" },
      { title: "Read", output: "ok", metadata: {} }
    )
    await hook["tool.execute.after"]?.(
      { tool: "Read", sessionID: "session-3", callID: "call-2" },
      { title: "Read", output: "ok", metadata: {} }
    )

    expect(collector.hasPending("session-3")).toBe(true)
    collector.consume("session-3")

    // Modify findings.md (mtime-based reset)
    const findingsPath = path.join(tmpDir, ".sisyphus", "plans", "reset-plan", "findings.md")
    await new Promise((r) => setTimeout(r, 10))
    fs.writeFileSync(findingsPath, "# Updated findings\n")

    // when - next counted action after modification
    await hook["tool.execute.after"]?.(
      { tool: "Read", sessionID: "session-3", callID: "call-3" },
      { title: "Read", output: "ok", metadata: {} }
    )

    // then - counter reset, so no reminder yet
    expect(collector.hasPending("session-3")).toBe(false)
    const state = readWorkState(tmpDir)
    expect(state).not.toBeNull()
    expect(state?.protocol.research_ops).toBe(0)
  })

  test("initializes a new plan from chat directive", async () => {
    // given
    const collector = new ContextCollector()
    const promptCalls: Array<{ sessionID: string; text: string }> = []
    const hook = createPlanningWithFilesHook(createMockPluginInput(tmpDir, promptCalls), {
      config: { enabled: true },
      collector,
    })

    const output = {
      message: {} as Record<string, unknown>,
      parts: [{ type: "text", text: 'init plan "my-plan"' }],
    }

    // when
    await hook["chat.message"]?.({ sessionID: "session-init", messageID: "m1" }, output as any)

    // then
    expect(fs.existsSync(path.join(tmpDir, ".sisyphus", "plans", "my-plan", "plan.md"))).toBe(true)
    expect(fs.existsSync(path.join(tmpDir, ".sisyphus", "plans", "my-plan", "ledger.yaml"))).toBe(true)
    const state = readWorkState(tmpDir)
    expect(state).not.toBeNull()
    expect(state?.plan_id).toBe("my-plan")
    expect(state?.executor).toBe("atlas")
    expect(String(state?.execution_plan_path ?? "")).toContain("my-plan/plan.md")
    expect(output.parts[0].text).toContain("<planning-with-files-active")
  })

  test("stop verification injects continuation prompt when phases are incomplete", async () => {
    // given
    await initializePlan(tmpDir, "stop-plan", "Goal")
    const collector = new ContextCollector()
    const promptCalls: Array<{ sessionID: string; text: string }> = []
    const hook = createPlanningWithFilesHook(createMockPluginInput(tmpDir, promptCalls), {
      config: { enabled: true, stop_verification: true },
      collector,
    })

    // when
    await hook.event?.({
      event: { type: "session.idle", properties: { sessionID: "session-stop" } },
    })

    // then
    expect(promptCalls).toHaveLength(1)
    expect(promptCalls[0].sessionID).toBe("session-stop")
    expect(promptCalls[0].text).toContain("Incomplete plan tasks remain")
    expect(promptCalls[0].text).toContain("ledger.yaml")
    expect(promptCalls[0].text).toContain("/stop --force")
  })

  test("stop verification reports continuation intent when reporter is configured", async () => {
    // given
    await initializePlan(tmpDir, "stop-plan-reporter", "Goal")
    const collector = new ContextCollector()
    const promptCalls: Array<{ sessionID: string; text: string }> = []
    const intents: Array<{ sessionID: string; source: string; round?: number; text: string }> = []
    const hook = createPlanningWithFilesHook(createMockPluginInput(tmpDir, promptCalls), {
      config: { enabled: true, stop_verification: true },
      collector,
      getContinuationRound: () => 11,
      reportContinuationIntent: async (intent) => {
        intents.push({
          sessionID: intent.sessionID,
          source: intent.source,
          round: intent.round,
          text: intent.prompt.text,
        })
      },
    })

    // when
    await hook.event?.({
      event: { type: "session.idle", properties: { sessionID: "session-stop-reporter" } },
    })

    // then
    expect(promptCalls).toHaveLength(0)
    expect(intents).toHaveLength(1)
    expect(intents[0].sessionID).toBe("session-stop-reporter")
    expect(intents[0].source).toBe("work-orchestrator")
    expect(intents[0].round).toBe(11)
    expect(intents[0].text).toContain("Incomplete plan tasks remain")
  })

  test("stop verification respects continuation stop guard", async () => {
    // given
    await initializePlan(tmpDir, "stop-plan-guard", "Goal")
    const collector = new ContextCollector()
    const promptCalls: Array<{ sessionID: string; text: string }> = []
    const hook = createPlanningWithFilesHook(createMockPluginInput(tmpDir, promptCalls), {
      config: { enabled: true, stop_verification: true },
      collector,
      isContinuationStopped: (id) => id === "session-stop-guard",
    })

    // when
    await hook.event?.({
      event: { type: "session.idle", properties: { sessionID: "session-stop-guard" } },
    })

    // then
    expect(promptCalls).toHaveLength(0)
  })

  test("stop verification is throttled per session", async () => {
    // given
    await initializePlan(tmpDir, "stop-plan", "Goal")
    const collector = new ContextCollector()
    const promptCalls: Array<{ sessionID: string; text: string }> = []
    const hook = createPlanningWithFilesHook(createMockPluginInput(tmpDir, promptCalls), {
      config: { enabled: true, stop_verification: true },
      collector,
    })

    // when
    await hook.event?.({
      event: { type: "session.idle", properties: { sessionID: "session-stop-throttle" } },
    })
    await hook.event?.({
      event: { type: "session.idle", properties: { sessionID: "session-stop-throttle" } },
    })

    // then
    expect(promptCalls).toHaveLength(1)
  })

  test("stop verification does not throttle when rejected due to post-compaction grace", async () => {
    // given
    await initializePlan(tmpDir, "stop-plan-grace", "Goal")
    const collector = new ContextCollector()
    const promptCalls: Array<{ sessionID: string; text: string }> = []
    const reported: Array<{ sessionID: string }> = []

    const hook = createPlanningWithFilesHook(createMockPluginInput(tmpDir, promptCalls), {
      config: { enabled: true, stop_verification: true },
      collector,
      reportContinuationIntent: async (intent) => {
        reported.push({ sessionID: intent.sessionID })
        await intent.onResult?.({
          status: "rejected",
          rejectReason: "post_compaction_grace",
        })
      },
    })

    // when
    await hook.event?.({
      event: { type: "session.idle", properties: { sessionID: "session-stop-grace" } },
    })
    await hook.event?.({
      event: { type: "session.idle", properties: { sessionID: "session-stop-grace" } },
    })

    // then
    expect(promptCalls).toHaveLength(0)
    expect(reported).toHaveLength(2)
  })

  test("stop verification throttles when rejected due to lower priority", async () => {
    // given
    await initializePlan(tmpDir, "stop-plan-priority", "Goal")
    const collector = new ContextCollector()
    const promptCalls: Array<{ sessionID: string; text: string }> = []
    const reported: Array<{ sessionID: string }> = []

    const hook = createPlanningWithFilesHook(createMockPluginInput(tmpDir, promptCalls), {
      config: { enabled: true, stop_verification: true },
      collector,
      reportContinuationIntent: async (intent) => {
        reported.push({ sessionID: intent.sessionID })
        await intent.onResult?.({
          status: "rejected",
          rejectReason: "lower_priority",
        })
      },
    })

    // when
    await hook.event?.({
      event: { type: "session.idle", properties: { sessionID: "session-stop-priority" } },
    })
    await hook.event?.({
      event: { type: "session.idle", properties: { sessionID: "session-stop-priority" } },
    })

    // then
    expect(promptCalls).toHaveLength(0)
    expect(reported).toHaveLength(1)
  })

  test("stop verification defers when incomplete tasks exist and task continuation is enabled", async () => {
    // given
    await initializePlan(tmpDir, "stop-plan", "Goal")
    const collector = new ContextCollector()
    const promptCalls: Array<{ sessionID: string; text: string }> = []
    const sessionID = "session-stop-task"
    const taskConfig = {
      sisyphus: {
        tasks: {
          enabled: true,
          storage_path: path.join(tmpDir, ".sisyphus", "tasks"),
        },
      },
    } as const
    createTaskNode(
      {
        scope: "session",
        container_id: sessionID,
        title: "Incomplete runtime task",
      },
      taskConfig
    )
    const hook = createPlanningWithFilesHook(
      createMockPluginInput(tmpDir, promptCalls),
      {
        config: { enabled: true, stop_verification: true },
        collector,
        taskConfig,
        taskContinuationEnabled: true,
      }
    )

    // when
    await hook.event?.({
      event: { type: "session.idle", properties: { sessionID } },
    })

    // then
    expect(promptCalls).toHaveLength(0)
  })

  test("three-strike protocol requires error recording on strike 2+", async () => {
    // given
    await initializePlan(tmpDir, "strike-plan", "Goal")
    const collector = new ContextCollector()
    const promptCalls: Array<{ sessionID: string; text: string }> = []
    const hook = createPlanningWithFilesHook(createMockPluginInput(tmpDir, promptCalls), {
      config: { enabled: true, three_strike_protocol: true },
      collector,
    })

    // when - strike 1
    await hook["tool.execute.after"]?.(
      { tool: "Bash", sessionID: "session-strike", callID: "call-1" },
      { title: "Bash", output: "❌ Connection refused", metadata: {} }
    )

    // then - guidance present, no forced recording yet
    expect(collector.hasPending("session-strike")).toBe(true)
    const strike1 = collector.consume("session-strike").merged
    expect(strike1).toContain('strike="1"')
    expect(strike1).not.toContain("<error-recording-required>")

    // when - strike 2 (same error signature)
    await hook["tool.execute.after"]?.(
      { tool: "Bash", sessionID: "session-strike", callID: "call-2" },
      { title: "Bash", output: "❌ Connection refused", metadata: {} }
    )

    // then - forced recording prompt included
    expect(collector.hasPending("session-strike")).toBe(true)
    const strike2 = collector.consume("session-strike").merged
    expect(strike2).toContain('strike="2"')
    expect(strike2).toContain("<error-recording-required>")
    expect(strike2).toContain("MUST record it in ledger.yaml")
    const state = readWorkState(tmpDir)
    const errors = (state?.errors as Array<Record<string, unknown>> | undefined) ?? []
    const strikeError = errors.find((e) => e.key === "Bash:Connection refused")
    expect(strikeError?.strikes).toBe(2)
  })

  test("three-strike protocol skips recording prompt once error is recorded", async () => {
    // given
    await initializePlan(tmpDir, "strike-plan-recorded", "Goal")
    const collector = new ContextCollector()
    const promptCalls: Array<{ sessionID: string; text: string }> = []
    const hook = createPlanningWithFilesHook(createMockPluginInput(tmpDir, promptCalls), {
      config: { enabled: true, three_strike_protocol: true },
      collector,
    })

    const planDir = path.join(tmpDir, ".sisyphus", "plans", "strike-plan-recorded")
    const ledgerPath = path.join(planDir, "ledger.yaml")

    // when - strike 1
    await hook["tool.execute.after"]?.(
      { tool: "Bash", sessionID: "session-strike-recorded", callID: "call-1" },
      { title: "Bash", output: "❌ Connection refused", metadata: {} }
    )
    collector.consume("session-strike-recorded")

    // Record error in ledger.yaml before strike 2
    fs.writeFileSync(
      ledgerPath,
      `schema_version: 1
plan_id: strike-plan-recorded
errors:
  - key: "Bash:Connection refused"
    strikes: 1
    root_cause: "Network"
    resolution: "Retry"
blockers: []
decisions: []
updated_at: "2026-02-06T00:00:00Z"
`
    )

    // when - strike 2
    await hook["tool.execute.after"]?.(
      { tool: "Bash", sessionID: "session-strike-recorded", callID: "call-2" },
      { title: "Bash", output: "❌ Connection refused", metadata: {} }
    )

    // then - guidance present but no forced recording prompt
    expect(collector.hasPending("session-strike-recorded")).toBe(true)
    const strike2 = collector.consume("session-strike-recorded").merged
    expect(strike2).toContain('strike="2"')
    expect(strike2).not.toContain("<error-recording-required>")
  })

  test("emits blocker prompt for likely external dependency errors", async () => {
    // given
    await initializePlan(tmpDir, "blocker-plan", "Goal")
    const collector = new ContextCollector()
    const promptCalls: Array<{ sessionID: string; text: string }> = []
    const hook = createPlanningWithFilesHook(createMockPluginInput(tmpDir, promptCalls), {
      config: { enabled: true },
      collector,
    })

    // when
    await hook["tool.execute.after"]?.(
      { tool: "Bash", sessionID: "session-blocker", callID: "call-1" },
      { title: "Bash", output: "❌ Missing API key for service", metadata: {} }
    )

    // then
    expect(collector.hasPending("session-blocker")).toBe(true)
    const pending = collector.consume("session-blocker").merged
    expect(pending).toContain("<blocker-detected>")
    expect(pending).toContain("Missing API key")
    const state = readWorkState(tmpDir)
    const blockers = (state?.blockers as Array<Record<string, unknown>> | undefined) ?? []
    expect(blockers).toHaveLength(1)
    expect(String(blockers[0]?.error_text ?? "")).toContain("Missing API key")
  })

  test("does not emit blocker prompt for generic errors", async () => {
    // given
    await initializePlan(tmpDir, "blocker-plan-generic", "Goal")
    const collector = new ContextCollector()
    const promptCalls: Array<{ sessionID: string; text: string }> = []
    const hook = createPlanningWithFilesHook(createMockPluginInput(tmpDir, promptCalls), {
      config: { enabled: true, three_strike_protocol: false },
      collector,
    })

    // when
    await hook["tool.execute.after"]?.(
      { tool: "Bash", sessionID: "session-blocker-generic", callID: "call-1" },
      { title: "Bash", output: "❌ Connection refused", metadata: {} }
    )

    // then
    expect(collector.hasPending("session-blocker-generic")).toBe(false)
  })

  test("ignores custom planning directory and still uses canonical plans path", async () => {
    // given
    await initializePlan(tmpDir, "custom-dir-plan", "Goal", {
      ...DEFAULT_PLANNING_CONFIG,
      enabled: true,
      directory: "custom-plans",
    })

    const collector = new ContextCollector()
    const promptCalls: Array<{ sessionID: string; text: string }> = []
    const hook = createPlanningWithFilesHook(createMockPluginInput(tmpDir, promptCalls), {
      config: { enabled: true, directory: "custom-plans" },
      collector,
    })

    // when
    await hook["tool.execute.before"]?.(
      { tool: "Write", sessionID: "session-custom-dir", callID: "call-1" },
      { args: { path: "src/file.ts", content: "export {}" } }
    )

    // then
    expect(collector.hasPending("session-custom-dir")).toBe(true)
    const pending = collector.getPending("session-custom-dir")
    expect(pending.merged).toContain("<plan-context>")
  })

  test("emits BDD alignment warning when plan tasks miss scenario refs", async () => {
    // given
    await initializePlan(tmpDir, "bdd-warn-plan", "Goal")
    const planPath = path.join(tmpDir, ".sisyphus", "plans", "bdd-warn-plan", "plan.md")
    fs.writeFileSync(
      planPath,
      `# Plan: bdd-warn-plan

## Tasks

- 1. Setup repo
  Scenario Ref: S-001

- 2. Implement feature
  Depends On: 1
`
    )

    const collector = new ContextCollector()
    const promptCalls: Array<{ sessionID: string; text: string }> = []
    const hook = createPlanningWithFilesHook(createMockPluginInput(tmpDir, promptCalls), {
      config: { enabled: true, bdd_alignment: "warn" },
      collector,
    })

    // when
    await hook["tool.execute.before"]?.(
      { tool: "Write", sessionID: "session-bdd-warn", callID: "call-bdd-warn" },
      { args: { path: "src/file.ts", content: "export {}" } }
    )

    // then
    expect(collector.hasPending("session-bdd-warn")).toBe(true)
    const pending = collector.getPending("session-bdd-warn")
    expect(pending.merged).toContain("Scenario Ref")
    expect(pending.merged).toContain("Task 2")
  })

  test("blocks non-plan tool execution in required mode when scenario refs are missing", async () => {
    // given
    await initializePlan(tmpDir, "bdd-required-plan", "Goal")
    const planPath = path.join(tmpDir, ".sisyphus", "plans", "bdd-required-plan", "plan.md")
    fs.writeFileSync(
      planPath,
      `# Plan: bdd-required-plan

## Tasks

- 1. Setup repo
  Scenario Ref: S-001

- 2. Implement feature
  Depends On: 1
`
    )

    const collector = new ContextCollector()
    const promptCalls: Array<{ sessionID: string; text: string }> = []
    const hook = createPlanningWithFilesHook(createMockPluginInput(tmpDir, promptCalls), {
      config: { enabled: true, bdd_alignment: "required" },
      collector,
    })

    // when / #then
    await expect(
      hook["tool.execute.before"]?.(
        { tool: "Write", sessionID: "session-bdd-required", callID: "call-bdd-required-1" },
        { args: { path: "src/file.ts", content: "export {}" } }
      )
    ).rejects.toThrow("Scenario Ref")

    // when - editing plan.md should remain allowed for remediation
    await expect(
      hook["tool.execute.before"]?.(
        { tool: "Edit", sessionID: "session-bdd-required", callID: "call-bdd-required-2" },
        { args: { path: ".sisyphus/plans/bdd-required-plan/plan.md", old_string: "old", new_string: "new" } }
      )
    ).resolves.toBeUndefined()
  })

  test("blocks non-plan tool execution in required mode even when auto_reread is disabled", async () => {
    // given
    await initializePlan(tmpDir, "bdd-required-no-reread-plan", "Goal")
    const planPath = path.join(
      tmpDir,
      ".sisyphus",
      "plans",
      "bdd-required-no-reread-plan",
      "plan.md"
    )
    fs.writeFileSync(
      planPath,
      `# Plan: bdd-required-no-reread-plan

## Tasks

- 1. Setup repo
  Scenario Ref: S-001

- 2. Implement feature
  Depends On: 1
`
    )

    const collector = new ContextCollector()
    const promptCalls: Array<{ sessionID: string; text: string }> = []
    const hook = createPlanningWithFilesHook(createMockPluginInput(tmpDir, promptCalls), {
      config: { enabled: true, bdd_alignment: "required", auto_reread: false },
      collector,
    })

    // when / #then
    await expect(
      hook["tool.execute.before"]?.(
        { tool: "Write", sessionID: "session-bdd-required-no-reread", callID: "call-bdd-required-3" },
        { args: { path: "src/file.ts", content: "export {}" } }
      )
    ).rejects.toThrow("Scenario Ref")

    // when - editing plan.md should still be allowed for remediation
    await expect(
      hook["tool.execute.before"]?.(
        { tool: "Edit", sessionID: "session-bdd-required-no-reread", callID: "call-bdd-required-4" },
        {
          args: {
            path: ".sisyphus/plans/bdd-required-no-reread-plan/plan.md",
            old_string: "old",
            new_string: "new",
          },
        }
      )
    ).resolves.toBeUndefined()
  })

})
