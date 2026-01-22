import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import type { PluginInput } from "@opencode-ai/plugin"
import { ContextCollector, createContextInjectorMessagesTransformHook } from "../../features/context-injector"
import { initializePlan } from "../../features/planning-with-files/manager"
import { DEFAULT_PLANNING_CONFIG } from "../../features/planning-with-files/types"
import { createPlanningWithFilesHook } from "./index"

function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "planning-with-files-hook-"))
}

function createMockPluginInput(
  projectDir: string,
  promptCalls: Array<{ sessionID: string; text: string }>,
  options: { todos?: Array<{ status?: string }> } = {}
): PluginInput {
  const { todos = [] } = options
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
        todo: async () => ({ data: todos }),
      },
      tui: {
        showToast: async () => ({ data: true }),
      },
    },
  } as any
}

describe("planning-with-files (plugin-native hook)", () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = createTempDir()
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  test("registers task_plan.md context for trigger tools (injected via ContextCollector)", async () => {
    // #given
    await initializePlan(tmpDir, "e2e-plan", "Implement feature X")
    const collector = new ContextCollector()
    const promptCalls: Array<{ sessionID: string; text: string }> = []
    const hook = createPlanningWithFilesHook(createMockPluginInput(tmpDir, promptCalls), {
      config: { enabled: true },
      collector,
    })

    // #when
    await hook["tool.execute.before"]?.(
      { tool: "Write", sessionID: "session-1", callID: "call-1" },
      { args: { path: "src/file.ts", content: "export {}" } }
    )

    // #then
    expect(collector.hasPending("session-1")).toBe(true)
    const pending = collector.getPending("session-1")
    expect(pending.merged).toContain("<task-plan-context>")
    expect(pending.merged).toContain("Implement feature X")

    // #then - end-to-end injection into last user message
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

    expect(output.messages[0].parts[0].text).toContain("<task-plan-context>")
    expect(output.messages[0].parts[0].text).toContain("Task Plan:")
    expect(collector.hasPending("session-1")).toBe(false)
  })

  test("emits two-action-rule reminder after 2 counted research tools", async () => {
    // #given
    await initializePlan(tmpDir, "e2e-plan", "Goal")
    const collector = new ContextCollector()
    const promptCalls: Array<{ sessionID: string; text: string }> = []
    const hook = createPlanningWithFilesHook(createMockPluginInput(tmpDir, promptCalls), {
      config: { enabled: true },
      collector,
    })

    // #when - first action
    await hook["tool.execute.after"]?.(
      { tool: "Read", sessionID: "session-2", callID: "call-1" },
      { title: "Read", output: "ok", metadata: {} }
    )

    // #then - no reminder yet
    expect(collector.hasPending("session-2")).toBe(false)

    // #when - second action
    await hook["tool.execute.after"]?.(
      { tool: "Read", sessionID: "session-2", callID: "call-2" },
      { title: "Read", output: "ok", metadata: {} }
    )

    // #then - reminder registered
    expect(collector.hasPending("session-2")).toBe(true)
    const pending = collector.getPending("session-2")
    expect(pending.merged).toContain("<two-action-rule>")
    expect(pending.merged).toContain("findings.md")
  })

  test("does not re-emit two-action-rule on odd action counts", async () => {
    // #given
    await initializePlan(tmpDir, "e2e-plan", "Goal")
    const collector = new ContextCollector()
    const promptCalls: Array<{ sessionID: string; text: string }> = []
    const hook = createPlanningWithFilesHook(createMockPluginInput(tmpDir, promptCalls), {
      config: { enabled: true },
      collector,
    })

    // #when - reach 2 actions (emit reminder)
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

    // #when - 3rd action (no reminder expected)
    await hook["tool.execute.after"]?.(
      { tool: "Read", sessionID: "session-2-odd", callID: "call-3" },
      { title: "Read", output: "ok", metadata: {} }
    )

    // #then
    expect(collector.hasPending("session-2-odd")).toBe(false)
  })

  test("auto-resets two-action counter when findings.md is modified", async () => {
    // #given
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

    // #when - next counted action after modification
    await hook["tool.execute.after"]?.(
      { tool: "Read", sessionID: "session-3", callID: "call-3" },
      { title: "Read", output: "ok", metadata: {} }
    )

    // #then - counter reset, so no reminder yet
    expect(collector.hasPending("session-3")).toBe(false)
  })

  test("initializes a new plan from chat directive", async () => {
    // #given
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

    // #when
    await hook["chat.message"]?.({ sessionID: "session-init", messageID: "m1" }, output as any)

    // #then
    expect(
      fs.existsSync(path.join(tmpDir, ".sisyphus", "plans", "my-plan", "task_plan.md"))
    ).toBe(true)
    expect(
      fs.existsSync(path.join(tmpDir, ".sisyphus", "plans", "my-plan", ".planning-state.json"))
    ).toBe(true)
    expect(output.parts[0].text).toContain("<planning-with-files-active")
  })

  test("stop verification injects continuation prompt when phases are incomplete", async () => {
    // #given
    await initializePlan(tmpDir, "stop-plan", "Goal")
    const collector = new ContextCollector()
    const promptCalls: Array<{ sessionID: string; text: string }> = []
    const hook = createPlanningWithFilesHook(createMockPluginInput(tmpDir, promptCalls), {
      config: { enabled: true, stop_verification: true },
      collector,
    })

    // #when
    await hook.event?.({
      event: { type: "session.idle", properties: { sessionID: "session-stop" } },
    })

    // #then
    expect(promptCalls).toHaveLength(1)
    expect(promptCalls[0].sessionID).toBe("session-stop")
    expect(promptCalls[0].text).toContain("Incomplete phases")
    expect(promptCalls[0].text).toContain("blocked")
    expect(promptCalls[0].text).toContain("/stop --force")
  })

  test("stop verification is throttled per session", async () => {
    // #given
    await initializePlan(tmpDir, "stop-plan", "Goal")
    const collector = new ContextCollector()
    const promptCalls: Array<{ sessionID: string; text: string }> = []
    const hook = createPlanningWithFilesHook(createMockPluginInput(tmpDir, promptCalls), {
      config: { enabled: true, stop_verification: true },
      collector,
    })

    // #when
    await hook.event?.({
      event: { type: "session.idle", properties: { sessionID: "session-stop-throttle" } },
    })
    await hook.event?.({
      event: { type: "session.idle", properties: { sessionID: "session-stop-throttle" } },
    })

    // #then
    expect(promptCalls).toHaveLength(1)
  })

  test("stop verification defers when incomplete todos exist and todo continuation is enabled", async () => {
    // #given
    await initializePlan(tmpDir, "stop-plan", "Goal")
    const collector = new ContextCollector()
    const promptCalls: Array<{ sessionID: string; text: string }> = []
    const hook = createPlanningWithFilesHook(
      createMockPluginInput(tmpDir, promptCalls, { todos: [{ status: "pending" }] }),
      {
        config: { enabled: true, stop_verification: true },
        collector,
        todoContinuationEnabled: true,
      }
    )

    // #when
    await hook.event?.({
      event: { type: "session.idle", properties: { sessionID: "session-stop-todo" } },
    })

    // #then
    expect(promptCalls).toHaveLength(0)
  })

  test("emits phase-reflection prompt when a phase transitions to complete", async () => {
    // #given
    await initializePlan(tmpDir, "reflection-plan", "Goal")

    const planDir = path.join(tmpDir, ".sisyphus", "plans", "reflection-plan")
    const taskPlanPath = path.join(planDir, "task_plan.md")

    // Make phase 1 in_progress so we can transition it to complete
    fs.writeFileSync(
      taskPlanPath,
      `# Task Plan: reflection-plan

> **Goal**: Goal

## Phases

| # | Phase | Status | Notes |
|---|-------|--------|-------|
| 1 | Discovery | in_progress | -
| 2 | Implementation | pending | -
`
    )

    const collector = new ContextCollector()
    const promptCalls: Array<{ sessionID: string; text: string }> = []
    const hook = createPlanningWithFilesHook(createMockPluginInput(tmpDir, promptCalls), {
      config: { enabled: true },
      collector,
    })

    // First cycle initializes phase cache (no reflection)
    await hook["tool.execute.before"]?.(
      { tool: "Edit", sessionID: "session-reflect", callID: "call-1" },
      { args: { path: taskPlanPath } }
    )
    collector.consume("session-reflect")
    await hook["tool.execute.after"]?.(
      { tool: "Edit", sessionID: "session-reflect", callID: "call-1" },
      { title: "Edit", output: "ok", metadata: {} }
    )

    expect(collector.hasPending("session-reflect")).toBe(false)

    // Transition phase 1 to complete
    fs.writeFileSync(
      taskPlanPath,
      `# Task Plan: reflection-plan

> **Goal**: Goal

## Phases

| # | Phase | Status | Notes |
|---|-------|--------|-------|
| 1 | Discovery | complete | -
| 2 | Implementation | pending | -
`
    )

    // #when - second edit after completion
    await hook["tool.execute.before"]?.(
      { tool: "Edit", sessionID: "session-reflect", callID: "call-2" },
      { args: { path: taskPlanPath } }
    )
    collector.consume("session-reflect")
    await hook["tool.execute.after"]?.(
      { tool: "Edit", sessionID: "session-reflect", callID: "call-2" },
      { title: "Edit", output: "ok", metadata: {} }
    )

    // #then
    expect(collector.hasPending("session-reflect")).toBe(true)
    const pending = collector.getPending("session-reflect")
    expect(pending.merged).toContain("<phase-reflection>")
    expect(pending.merged).toContain("Phase 1 Complete")
  })

  test("three-strike protocol requires error recording on strike 2+", async () => {
    // #given
    await initializePlan(tmpDir, "strike-plan", "Goal")
    const collector = new ContextCollector()
    const promptCalls: Array<{ sessionID: string; text: string }> = []
    const hook = createPlanningWithFilesHook(createMockPluginInput(tmpDir, promptCalls), {
      config: { enabled: true, three_strike_protocol: true },
      collector,
    })

    // #when - strike 1
    await hook["tool.execute.after"]?.(
      { tool: "Bash", sessionID: "session-strike", callID: "call-1" },
      { title: "Bash", output: "❌ Connection refused", metadata: {} }
    )

    // #then - guidance present, no forced recording yet
    expect(collector.hasPending("session-strike")).toBe(true)
    const strike1 = collector.consume("session-strike").merged
    expect(strike1).toContain('strike="1"')
    expect(strike1).not.toContain("<error-recording-required>")

    // #when - strike 2 (same error signature)
    await hook["tool.execute.after"]?.(
      { tool: "Bash", sessionID: "session-strike", callID: "call-2" },
      { title: "Bash", output: "❌ Connection refused", metadata: {} }
    )

    // #then - forced recording prompt included
    expect(collector.hasPending("session-strike")).toBe(true)
    const strike2 = collector.consume("session-strike").merged
    expect(strike2).toContain('strike="2"')
    expect(strike2).toContain("<error-recording-required>")
    expect(strike2).toContain("MUST record it in task_plan.md")
  })

  test("three-strike protocol skips recording prompt once error is recorded", async () => {
    // #given
    await initializePlan(tmpDir, "strike-plan-recorded", "Goal")
    const collector = new ContextCollector()
    const promptCalls: Array<{ sessionID: string; text: string }> = []
    const hook = createPlanningWithFilesHook(createMockPluginInput(tmpDir, promptCalls), {
      config: { enabled: true, three_strike_protocol: true },
      collector,
    })

    const planDir = path.join(tmpDir, ".sisyphus", "plans", "strike-plan-recorded")
    const taskPlanPath = path.join(planDir, "task_plan.md")

    // #when - strike 1
    await hook["tool.execute.after"]?.(
      { tool: "Bash", sessionID: "session-strike-recorded", callID: "call-1" },
      { title: "Bash", output: "❌ Connection refused", metadata: {} }
    )
    collector.consume("session-strike-recorded")

    // Record error in task_plan.md before strike 2
    fs.writeFileSync(
      taskPlanPath,
      `# Task Plan: strike-plan-recorded

## Errors

| # | Error | Phase | Attempts | Root Cause | Resolution |
|---|-------|-------|----------|------------|------------|
| 1 | Bash:Connection refused | Phase 1 | 1 | Network | Retry |
`
    )

    // #when - strike 2
    await hook["tool.execute.after"]?.(
      { tool: "Bash", sessionID: "session-strike-recorded", callID: "call-2" },
      { title: "Bash", output: "❌ Connection refused", metadata: {} }
    )

    // #then - guidance present but no forced recording prompt
    expect(collector.hasPending("session-strike-recorded")).toBe(true)
    const strike2 = collector.consume("session-strike-recorded").merged
    expect(strike2).toContain('strike="2"')
    expect(strike2).not.toContain("<error-recording-required>")
  })

  test("emits blocker prompt for likely external dependency errors", async () => {
    // #given
    await initializePlan(tmpDir, "blocker-plan", "Goal")
    const collector = new ContextCollector()
    const promptCalls: Array<{ sessionID: string; text: string }> = []
    const hook = createPlanningWithFilesHook(createMockPluginInput(tmpDir, promptCalls), {
      config: { enabled: true },
      collector,
    })

    // #when
    await hook["tool.execute.after"]?.(
      { tool: "Bash", sessionID: "session-blocker", callID: "call-1" },
      { title: "Bash", output: "❌ Missing API key for service", metadata: {} }
    )

    // #then
    expect(collector.hasPending("session-blocker")).toBe(true)
    const pending = collector.consume("session-blocker").merged
    expect(pending).toContain("<blocker-detected>")
    expect(pending).toContain("Missing API key")
  })

  test("does not emit blocker prompt for generic errors", async () => {
    // #given
    await initializePlan(tmpDir, "blocker-plan-generic", "Goal")
    const collector = new ContextCollector()
    const promptCalls: Array<{ sessionID: string; text: string }> = []
    const hook = createPlanningWithFilesHook(createMockPluginInput(tmpDir, promptCalls), {
      config: { enabled: true, three_strike_protocol: false },
      collector,
    })

    // #when
    await hook["tool.execute.after"]?.(
      { tool: "Bash", sessionID: "session-blocker-generic", callID: "call-1" },
      { title: "Bash", output: "❌ Connection refused", metadata: {} }
    )

    // #then
    expect(collector.hasPending("session-blocker-generic")).toBe(false)
  })

  test("respects custom planning directory for active plan detection", async () => {
    // #given
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

    // #when
    await hook["tool.execute.before"]?.(
      { tool: "Write", sessionID: "session-custom-dir", callID: "call-1" },
      { args: { path: "src/file.ts", content: "export {}" } }
    )

    // #then
    expect(collector.hasPending("session-custom-dir")).toBe(true)
    const pending = collector.getPending("session-custom-dir")
    expect(pending.merged).toContain("<task-plan-context>")
  })

  test("auto_from_multi_plan initializes planning files after successful multi_plan", async () => {
    // #given
    const collector = new ContextCollector()
    const promptCalls: Array<{ sessionID: string; text: string }> = []
    const hook = createPlanningWithFilesHook(createMockPluginInput(tmpDir, promptCalls), {
      config: { enabled: true, auto_from_multi_plan: true },
      collector,
    })

    // #when - multi_plan completes successfully
    await hook["tool.execute.before"]?.(
      { tool: "multi_plan", sessionID: "session-mp", callID: "call-mp" },
      { args: { planName: "auto-plan", context: "ctx" } }
    )
    await hook["tool.execute.after"]?.(
      { tool: "multi_plan", sessionID: "session-mp", callID: "call-mp" },
      { title: "multi_plan", output: "✅ Multi-model planning completed successfully!", metadata: {} }
    )

    // #then - plan directory scaffold created
    expect(
      fs.existsSync(path.join(tmpDir, ".sisyphus", "plans", "auto-plan", "task_plan.md"))
    ).toBe(true)
    expect(
      fs.existsSync(path.join(tmpDir, ".sisyphus", "plans", "auto-plan", ".planning-state.json"))
    ).toBe(true)
  })

  test("auto_from_multi_plan uses structured result (MULTI_PLAN_RESULT block)", async () => {
    // #given
    const collector = new ContextCollector()
    const promptCalls: Array<{ sessionID: string; text: string }> = []
    const hook = createPlanningWithFilesHook(createMockPluginInput(tmpDir, promptCalls), {
      config: { enabled: true, auto_from_multi_plan: true },
      collector,
    })

    // #when - multi_plan completes with structured result (new format)
    await hook["tool.execute.before"]?.(
      { tool: "multi_plan", sessionID: "session-mp-struct", callID: "call-mp-struct" },
      { args: { planName: "structured-plan", context: "ctx" } }
    )
    const structuredOutput = `✅ Multi-model planning completed successfully!
[MULTI_PLAN_RESULT]{"status":"success","planName":"structured-plan","finalPlanPath":".sisyphus/plans/structured-plan.md"}[/MULTI_PLAN_RESULT]

Some summary text...`
    await hook["tool.execute.after"]?.(
      { tool: "multi_plan", sessionID: "session-mp-struct", callID: "call-mp-struct" },
      { title: "multi_plan", output: structuredOutput, metadata: {} }
    )

    // #then - plan directory scaffold created using planName from structured result
    expect(
      fs.existsSync(path.join(tmpDir, ".sisyphus", "plans", "structured-plan", "task_plan.md"))
    ).toBe(true)
    expect(
      fs.existsSync(path.join(tmpDir, ".sisyphus", "plans", "structured-plan", ".planning-state.json"))
    ).toBe(true)
  })

  test("tracks active plan per session (multi_plan -> subsequent tool injection)", async () => {
    // #given
    await initializePlan(tmpDir, "plan-a", "Goal A")
    await new Promise((r) => setTimeout(r, 5))
    await initializePlan(tmpDir, "plan-b", "Goal B")

    const collector = new ContextCollector()
    const promptCalls: Array<{ sessionID: string; text: string }> = []
    const hook = createPlanningWithFilesHook(createMockPluginInput(tmpDir, promptCalls), {
      config: { enabled: true, auto_from_multi_plan: true },
      collector,
    })

    // #when - multi_plan completes successfully for plan-a
    await hook["tool.execute.before"]?.(
      { tool: "multi_plan", sessionID: "session-map", callID: "call-mp" },
      { args: { planName: "plan-a", context: "ctx" } }
    )
    await hook["tool.execute.after"]?.(
      { tool: "multi_plan", sessionID: "session-map", callID: "call-mp" },
      { title: "multi_plan", output: "✅ ok", metadata: {} }
    )

    // #when - next write tool should inject plan-a (not latest plan-b)
    await hook["tool.execute.before"]?.(
      { tool: "Write", sessionID: "session-map", callID: "call-write" },
      { args: { path: "src/file.ts", content: "export {}" } }
    )

    // #then
    const pending = collector.getPending("session-map")
    expect(pending.merged).toContain("Goal A")
    expect(pending.merged).not.toContain("Goal B")
  })
})
