import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import type { PluginInput } from "@opencode-ai/plugin"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { ContextCollector } from "../../features/context-injector"
import { initializePlan } from "../../features/planning-with-files/manager"
import { createWorkStateManager } from "../../features/work-state"
import { updateSessionAgent } from "../../features/claude-code-session-state"
import { createTaskNode } from "../../features/task-system"
import { createWorkOrchestratorHook } from "./index"
import type { ContinuationIntentOutcome } from "./continuation"

function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "work-orchestrator-hook-"))
}

function createMockPluginInput(
  projectDir: string,
  promptCalls: Array<{ sessionID: string; text: string }>
): PluginInput {
  const prompt = async (req: any) => {
    const sessionID = req?.path?.id as string
    const text = req?.body?.parts?.[0]?.text as string
    promptCalls.push({ sessionID, text })
    return { data: true }
  }

  return {
    directory: projectDir,
    client: {
      session: {
        prompt,
        promptAsync: prompt,
      },
      tui: {
        showToast: async () => ({ data: true }),
      },
    },
  } as any
}

async function dispatchEvent(
  hook: ReturnType<typeof createWorkOrchestratorHook>,
  event: { type: string; properties?: unknown }
): Promise<void> {
  const wrapped = { event }
  hook.beginEvent(wrapped)
  try {
    await hook.event?.(wrapped)
  } finally {
    await hook.flushEvent(wrapped)
  }
}

describe("work-orchestrator unified hook", () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = createTempDir()
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  test("injects plan context on tool.execute.before (auto-reread)", async () => {
    // #given
    await initializePlan(tmpDir, "plan-reread", "Implement unified orchestrator")
    const collector = new ContextCollector()
    const promptCalls: Array<{ sessionID: string; text: string }> = []
    const hook = createWorkOrchestratorHook(createMockPluginInput(tmpDir, promptCalls), {
      config: {
        enabled: true,
        planning_with_files: {
          enabled: true,
          auto_reread: true,
        },
      },
      collector,
    })

    // #when
    await hook["tool.execute.before"]?.(
      { tool: "Write", sessionID: "ses-reread", callID: "c1" },
      { args: { path: "src/a.ts", content: "export {}" } }
    )

    // #then
    const pending = collector.getPending("ses-reread")
    expect(pending.merged).toContain("<plan-context>")
    expect(pending.merged).toContain("Implement unified orchestrator")
  })

  test("enforces BDD required gate in planning mode", async () => {
    // #given
    await initializePlan(tmpDir, "plan-bdd", "Add scenario refs")
    const collector = new ContextCollector()
    const promptCalls: Array<{ sessionID: string; text: string }> = []
    const hook = createWorkOrchestratorHook(createMockPluginInput(tmpDir, promptCalls), {
      config: {
        enabled: true,
        planning_with_files: {
          enabled: true,
          bdd_alignment: "required",
        },
      },
      collector,
    })

    // #when
    const output = { args: {}, message: "" }
    const invoke = async () =>
      hook["tool.execute.before"]?.(
        { tool: "Read", sessionID: "ses-bdd", callID: "c2" },
        output
      )

    // #then
    expect(invoke).toThrow("BDD alignment required")
  })

  test("emits two-action reminder and 3-strike recording prompt", async () => {
    // #given
    await initializePlan(tmpDir, "plan-rules", "Follow planning protocol")
    const collector = new ContextCollector()
    const promptCalls: Array<{ sessionID: string; text: string }> = []
    const hook = createWorkOrchestratorHook(createMockPluginInput(tmpDir, promptCalls), {
      config: {
        enabled: true,
        planning_with_files: {
          enabled: true,
          two_action_rule: true,
          three_strike_protocol: true,
        },
      },
      collector,
    })

    // #when - two research actions
    await hook["tool.execute.after"]?.(
      { tool: "Read", sessionID: "ses-rules", callID: "a1" },
      { title: "Read", output: "ok", metadata: {} }
    )
    await hook["tool.execute.after"]?.(
      { tool: "Read", sessionID: "ses-rules", callID: "a2" },
      { title: "Read", output: "ok", metadata: {} }
    )

    // #then - two-action reminder exists
    expect(collector.getPending("ses-rules").merged).toContain("<two-action-rule>")

    // #when - hit same error twice
    await hook["tool.execute.after"]?.(
      { tool: "Edit", sessionID: "ses-rules", callID: "e1" },
      { title: "Edit", output: "❌ Type mismatch", metadata: {} }
    )
    await hook["tool.execute.after"]?.(
      { tool: "Edit", sessionID: "ses-rules", callID: "e2" },
      { title: "Edit", output: "❌ Type mismatch", metadata: {} }
    )

    // #then - 3-strike protocol prompt exists
    expect(collector.getPending("ses-rules").merged).toContain("<error-recording-required>")
  })

  test("stop verification injects once per cooldown window", async () => {
    // #given
    await initializePlan(tmpDir, "plan-stop", "Complete all tasks")
    const collector = new ContextCollector()
    const promptCalls: Array<{ sessionID: string; text: string }> = []
    const hook = createWorkOrchestratorHook(createMockPluginInput(tmpDir, promptCalls), {
      config: {
        enabled: true,
        planning_with_files: {
          enabled: true,
          stop_verification: true,
        },
      },
      collector,
    })

    // #when
    await dispatchEvent(hook, { type: "session.idle", properties: { sessionID: "ses-stop" } })
    await dispatchEvent(hook, { type: "session.idle", properties: { sessionID: "ses-stop" } })

    // #then
    expect(promptCalls).toHaveLength(1)
    expect(promptCalls[0]?.text).toContain("Incomplete plan tasks remain")
  })

  test("arbitrates idle continuation as single writer", async () => {
    // #given
    const promptCalls: Array<{ sessionID: string; text: string }> = []
    const hook = createWorkOrchestratorHook(createMockPluginInput(tmpDir, promptCalls), {
      config: {
        enabled: true,
        planning_with_files: { enabled: false },
      },
    })

    const outcomes: Record<string, ContinuationIntentOutcome> = {}
    hook.beginEvent({
      event: { type: "session.idle", properties: { sessionID: "ses-arbiter" } },
    })
    const round = hook.getContinuationRound("ses-arbiter")

    // #when
    await hook.reportContinuationIntent({
      sessionID: "ses-arbiter",
      round,
      source: "task-auto-continuation",
      reason: "task",
      prompt: { text: "task continuation" },
      onResult: (result) => {
        outcomes.task = result
      },
    })
    await hook.reportContinuationIntent({
      sessionID: "ses-arbiter",
      round,
      source: "work-orchestrator",
      reason: "work",
      prompt: { text: "work continuation" },
      onResult: (result) => {
        outcomes.work = result
      },
    })
    await hook.flushEvent({
      event: { type: "session.idle", properties: { sessionID: "ses-arbiter" } },
    })

    // #then
    expect(promptCalls).toHaveLength(1)
    expect(promptCalls[0]?.text).toBe("work continuation")
    expect(outcomes.work?.status).toBe("accepted")
    expect(outcomes.task?.status).toBe("rejected")
    expect(outcomes.task?.rejectReason).toBe("lower_priority")
  })

  test("stop continuation blocks idle injection until next user message", async () => {
    // #given
    const promptCalls: Array<{ sessionID: string; text: string }> = []
    const hook = createWorkOrchestratorHook(createMockPluginInput(tmpDir, promptCalls), {
      config: {
        enabled: true,
        planning_with_files: { enabled: false },
      },
    })

    // prime one successful continuation
    hook.beginEvent({
      event: { type: "session.idle", properties: { sessionID: "ses-stop-guard" } },
    })
    await hook.reportContinuationIntent({
      sessionID: "ses-stop-guard",
      round: hook.getContinuationRound("ses-stop-guard"),
      source: "work-orchestrator",
      reason: "prime",
      prompt: { text: "prime continuation" },
    })
    await hook.flushEvent({
      event: { type: "session.idle", properties: { sessionID: "ses-stop-guard" } },
    })
    expect(promptCalls).toHaveLength(1)

    // #when - stop guard active
    hook.stopContinuation("ses-stop-guard")
    const blockedOutcomes: ContinuationIntentOutcome[] = []
    hook.beginEvent({
      event: { type: "session.idle", properties: { sessionID: "ses-stop-guard" } },
    })
    await hook.reportContinuationIntent({
      sessionID: "ses-stop-guard",
      round: hook.getContinuationRound("ses-stop-guard"),
      source: "work-orchestrator",
      reason: "blocked",
      prompt: { text: "blocked continuation" },
      onResult: (result) => blockedOutcomes.push(result),
    })
    await hook.flushEvent({
      event: { type: "session.idle", properties: { sessionID: "ses-stop-guard" } },
    })

    // #then - blocked
    expect(promptCalls).toHaveLength(1)
    expect(blockedOutcomes[0]?.rejectReason).toBe("stop_guard")

    // #when - next user message clears stop guard
    await hook["chat.message"]?.(
      { sessionID: "ses-stop-guard", messageID: "m1" },
      { parts: [{ type: "text", text: "continue" }] as Array<{ type: string; text?: string }> }
    )

    hook.beginEvent({
      event: { type: "session.idle", properties: { sessionID: "ses-stop-guard" } },
    })
    await hook.reportContinuationIntent({
      sessionID: "ses-stop-guard",
      round: hook.getContinuationRound("ses-stop-guard"),
      source: "work-orchestrator",
      reason: "resume",
      prompt: { text: "resume continuation" },
    })
    await hook.flushEvent({
      event: { type: "session.idle", properties: { sessionID: "ses-stop-guard" } },
    })

    // #then - resumed
    expect(promptCalls).toHaveLength(2)
    expect(promptCalls[1]?.text).toBe("resume continuation")
  })

  test("execution phase guards direct task tool usage in execution mode", async () => {
    // #given
    await initializePlan(tmpDir, "plan-exec", "Execute safely")
    createWorkStateManager(tmpDir).initializePlan("plan-exec", "ses-exec", undefined)
    updateSessionAgent("ses-exec", "workflow-automator")
    createTaskNode(
      { scope: "plan", container_id: "plan-exec", title: "1. Task 1" },
      {
        orchestrator: {
          tasks: {
            enabled: true,
            storage_path: path.join(tmpDir, ".orchestrator", "tasks"),
          },
        },
      }
    )

    const promptCalls: Array<{ sessionID: string; text: string }> = []
    const hook = createWorkOrchestratorHook(createMockPluginInput(tmpDir, promptCalls), {
      config: {
        enabled: true,
        planning_with_files: { enabled: false },
      },
      taskConfig: {
        orchestrator: {
          tasks: {
            enabled: true,
            storage_path: path.join(tmpDir, ".orchestrator", "tasks"),
          },
        },
      },
    })

    // #when
    const output = { args: {}, message: "" }
    const invoke = async () =>
      hook["tool.execute.before"]?.(
        { tool: "task", sessionID: "ses-exec", callID: "x1" },
        output
      )

    // #then
    expect(invoke).toThrow("The `task` tool is forbidden in Execution Mode")
    expect(output.message).toContain("Execution Mode policy forbids direct use of `task`")
  })
})
