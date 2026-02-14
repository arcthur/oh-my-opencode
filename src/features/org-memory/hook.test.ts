import { describe, test, expect, spyOn, beforeEach, afterEach, mock } from "bun:test"
import type { PluginInput } from "@opencode-ai/plugin"
import { createOrgMemoryHook } from "../../../src/features/org-memory/hook"
import * as storage from "../../../src/features/org-memory/storage"

describe("createOrgMemoryHook", () => {
  let ctx: PluginInput

  beforeEach(() => {
    ctx = {
      directory: "/test/project",
      client: {},
    } as unknown as PluginInput

    spyOn(storage, "getOrgMemorySummary").mockReturnValue("[Org Memory]\n- rule: do X")
  })

  afterEach(() => {
    mock.restore()
  })

  test("registers org memory context with collector (once per session)", async () => {
    // given
    const mockCollector = {
      register: mock(() => {}),
      resetOncePerSession: mock(() => {}),
    }
    const hook = createOrgMemoryHook(ctx, undefined, { collector: mockCollector as never })

    const input = { tool: "Read", sessionID: "s1", callID: "c1" }
    const output = {}

    // when
    await hook["tool.execute.before"]?.(input as never, output as never)
    await hook["tool.execute.before"]?.(input as never, output as never)

    // then - collector handles once-per-session internally via oncePerSession flag
    expect(mockCollector.register).toHaveBeenCalledTimes(2)
    const calls = mockCollector.register.mock.calls as unknown as [string, { source: string; oncePerSession: boolean }][]
    expect(calls[0][1]).toMatchObject({
      source: "org-memory",
      oncePerSession: true,
    })
  })

  test("captures protected paths from 'never modify'", async () => {
    // given
    const addProtectedPathSpy = spyOn(storage, "addProtectedPath").mockImplementation(() => {})
    const hook = createOrgMemoryHook(ctx)

    // when
    await hook["user.prompt.submit"]({ message: { content: "Never modify config/secrets.json." } } as never)

    // then
    expect(addProtectedPathSpy).toHaveBeenCalledWith(
      "/test/project",
      "config/secrets.json"
    )
  })

  test("captures project rules", async () => {
    // given
    const addCustomRuleSpy = spyOn(storage, "addCustomRule").mockImplementation(() => {})
    const hook = createOrgMemoryHook(ctx)

    // when
    await hook["user.prompt.submit"]({ message: { content: "project rule: use snake_case for endpoints" } } as never)

    // then
    expect(addCustomRuleSpy).toHaveBeenCalledWith(
      "/test/project",
      "use snake_case for endpoints"
    )
  })

  test("captures ADRs from user messages", async () => {
    // given
    const addAdrSpy = spyOn(storage, "addArchitecturalDecision").mockImplementation(() => true)
    const hook = createOrgMemoryHook(ctx)

    // when
    await hook["user.prompt.submit"]({ message: { content: "We should use Zod schema because schema validation." } } as never)

    // then
    expect(addAdrSpy).toHaveBeenCalledWith(
      "/test/project",
      expect.objectContaining({
        title: "Use Zod schema",
        rationale: "schema validation",
      })
    )
  })

  test("extracts ADRs from compaction summary", async () => {
    // given
    const addAdrSpy = spyOn(storage, "addArchitecturalDecision").mockImplementation(() => true)
    const hook = createOrgMemoryHook(ctx)

    const summary = [
      "## 4. Key Decisions & Rationale",
      "- Use Zod: Schema validation",
      "- Use Bun: Faster test runs",
    ].join("\n")

    // when
    await hook.event({ event: { type: "session.summarized", properties: { summary } } } as never)

    // then
    expect(addAdrSpy).toHaveBeenCalledTimes(2)
    expect(addAdrSpy).toHaveBeenCalledWith(
      "/test/project",
      expect.objectContaining({ title: "Use Zod", rationale: "Schema validation" })
    )
    expect(addAdrSpy).toHaveBeenCalledWith(
      "/test/project",
      expect.objectContaining({ title: "Use Bun", rationale: "Faster test runs" })
    )
  })
})
