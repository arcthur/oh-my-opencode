import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { createOrchestratorContextualInjectorHook } from "./index"
import { _resetForTesting, updateSessionAgent } from "../../features/claude-code-session-state"

function createMockCtx() {
  return {
    directory: "/test",
    client: {},
  } as any
}

describe("orchestrator-contextual-injector hook", () => {
  beforeEach(() => {
    _resetForTesting()
  })

  afterEach(() => {
    _resetForTesting()
  })

  test("injects github workflow context on matching chat.message", async () => {
    // #given
    const sessionID = "session-github"
    updateSessionAgent(sessionID, "orchestrator")
    const hook = createOrchestratorContextualInjectorHook(createMockCtx())
    const output = {
      message: {},
      parts: [{ type: "text", text: "Please look into issue #123 and create PR." }],
    }

    // #when
    await hook["chat.message"]?.({ sessionID }, output)

    // #then
    expect(output.parts[0].text).toContain("GitHub Workflow (Detailed)")
  })

  test("injects first delegate reminder only once per session", async () => {
    // #given
    const sessionID = "session-delegate-once"
    updateSessionAgent(sessionID, "orchestrator")
    const hook = createOrchestratorContextualInjectorHook(createMockCtx())
    const firstOutput = { args: { prompt: "Do the task", run_in_background: false, load_skills: [] as string[] } }
    const secondOutput = { args: { prompt: "Do another task", run_in_background: false, load_skills: [] as string[] } }

    // #when
    await hook["tool.execute.before"]?.({ tool: "delegate_task", sessionID, callID: "call-1" }, firstOutput)
    await hook["tool.execute.before"]?.({ tool: "delegate_task", sessionID, callID: "call-2" }, secondOutput)

    // #then
    expect((firstOutput as { message?: string }).message).toContain("Pre-Delegation Planning (Detailed Schema)")
    expect((secondOutput as { message?: string }).message).toBeUndefined()
  })

  test("injects category-skill prompt context for category delegations", async () => {
    // #given
    const sessionID = "session-category"
    updateSessionAgent(sessionID, "orchestrator")
    const hook = createOrchestratorContextualInjectorHook(createMockCtx())
    const output = {
      args: {
        category: "visual-engineering",
        prompt: "Build a dashboard",
        run_in_background: false,
        load_skills: [] as string[],
      },
    }

    // #when
    await hook["tool.execute.before"]?.({ tool: "delegate_task", sessionID, callID: "call-3" }, output)

    // #then
    expect(output.args.prompt).toContain("category-skills-context")
  })

  test("does not inject for non-orchestrator sessions", async () => {
    // #given
    const sessionID = "session-non-orchestrator"
    updateSessionAgent(sessionID, "workflow-automator")
    const hook = createOrchestratorContextualInjectorHook(createMockCtx())
    const output = {
      message: {},
      parts: [{ type: "text", text: "look into this and create PR" }],
    }

    // #when
    await hook["chat.message"]?.({ sessionID }, output)

    // #then
    expect(output.parts[0].text).not.toContain("GitHub Workflow (Detailed)")
  })

  test("phase1 is deduplicated between chat.message and edit tool", async () => {
    // #given
    const sessionID = "session-phase1-dedup"
    updateSessionAgent(sessionID, "orchestrator")
    const hook = createOrchestratorContextualInjectorHook(createMockCtx())
    const chatOutput = {
      message: {},
      parts: [{ type: "text", text: "Add feature for caching" }],
    }

    // #when — chat.message injects phase1 via open-ended pattern
    await hook["chat.message"]?.({ sessionID }, chatOutput)
    expect(chatOutput.parts[0].text).toContain("Phase 1 - Codebase Assessment")

    // #when — edit tool should NOT re-inject phase1 (same ID, oncePerSession)
    const editOutput = { args: { file_path: "foo.ts", content: "bar" } } as { args: Record<string, unknown>; message?: string }
    await hook["tool.execute.before"]?.({ tool: "edit", sessionID, callID: "call-edit" }, editOutput)

    // #then
    expect(editOutput.message).toBeUndefined()
  })

  test("injects parallel dispatch matrix on background delegation", async () => {
    // #given
    const sessionID = "session-bg-dispatch"
    updateSessionAgent(sessionID, "orchestrator")
    const hook = createOrchestratorContextualInjectorHook(createMockCtx())
    const output = { args: { prompt: "Search logs", run_in_background: true, load_skills: [] as string[] } }

    // #when
    await hook["tool.execute.before"]?.({ tool: "delegate_task", sessionID, callID: "call-bg" }, output)

    // #then
    const msg = (output as { message?: string }).message ?? ""
    expect(msg).toContain("Pre-Delegation Planning (Detailed Schema)")
    expect(msg).toContain("Parallel Dispatch Decision Matrix (Detailed)")
  })

  test("does not inject parallel dispatch matrix on foreground delegation", async () => {
    // #given
    const sessionID = "session-fg-dispatch"
    updateSessionAgent(sessionID, "orchestrator")
    const hook = createOrchestratorContextualInjectorHook(createMockCtx())
    const output = { args: { prompt: "Fix bug", run_in_background: false, load_skills: [] as string[] } }

    // #when
    await hook["tool.execute.before"]?.({ tool: "delegate_task", sessionID, callID: "call-fg" }, output)

    // #then
    const msg = (output as { message?: string }).message ?? ""
    expect(msg).toContain("Pre-Delegation Planning (Detailed Schema)")
    expect(msg).not.toContain("Parallel Dispatch Decision Matrix (Detailed)")
  })

  test("resets session state on compaction and allows re-injection", async () => {
    // #given
    const sessionID = "session-reset"
    updateSessionAgent(sessionID, "orchestrator")
    const hook = createOrchestratorContextualInjectorHook(createMockCtx())
    const firstOutput = { args: { prompt: "First task", run_in_background: false, load_skills: [] as string[] } }
    const secondOutput = { args: { prompt: "Second task", run_in_background: false, load_skills: [] as string[] } }

    // #when
    await hook["tool.execute.before"]?.({ tool: "delegate_task", sessionID, callID: "call-4" }, firstOutput)
    await hook.event?.({ event: { type: "session.compacted", properties: { sessionID } } } as never)
    await hook["tool.execute.before"]?.({ tool: "delegate_task", sessionID, callID: "call-5" }, secondOutput)

    // #then
    expect((firstOutput as { message?: string }).message).toContain("Pre-Delegation Planning (Detailed Schema)")
    expect((secondOutput as { message?: string }).message).toContain("Pre-Delegation Planning (Detailed Schema)")
  })
})

