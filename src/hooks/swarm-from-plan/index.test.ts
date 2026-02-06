import { describe, expect, mock, test, beforeEach, afterEach } from "bun:test"
import type { PluginInput } from "@opencode-ai/plugin"
import { existsSync, mkdirSync, rmSync, writeFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import type { OhMyOpenCodeConfig } from "../../config/schema"
import { clearSwarmRuntimeRegistry } from "../../features/sisyphus-swarm/runtime/registry"
import { cleanupAllOrchestrators, getSessionTeam } from "../../tools/swarm"

const mockCreateCoordinator = mock(async () => ({ stub: true }))

mock.module("../../features/sisyphus-swarm/agent", () => ({
  createCoordinator: mockCreateCoordinator,
}))

describe("swarm-from-plan hook", () => {
  let projectDir: string
  let tasksDir: string
  let config: Partial<OhMyOpenCodeConfig>

  beforeEach(() => {
    mockCreateCoordinator.mockReset()
    mockCreateCoordinator.mockImplementation(async () => ({ stub: true }))
    clearSwarmRuntimeRegistry()
    cleanupAllOrchestrators()

    projectDir = join(tmpdir(), `swarm-from-plan-hook-${Date.now()}`)
    tasksDir = join(tmpdir(), `swarm-from-plan-tasks-${Date.now()}`)
    mkdirSync(projectDir, { recursive: true })
    mkdirSync(tasksDir, { recursive: true })

    mkdirSync(join(projectDir, ".sisyphus", "plans"), { recursive: true })
    mkdirSync(join(projectDir, ".sisyphus", "context-manifests"), { recursive: true })

    // Minimal work.yaml
    writeFileSync(
      join(projectDir, ".sisyphus", "work.yaml"),
      [
        `active_plan: ".sisyphus/plans/demo.md"`,
        `plan_name: "demo"`,
        `started_at: "2026-02-05T00:00:00Z"`,
      ].join("\n"),
      "utf-8"
    )

    // Plan + manifest
    writeFileSync(
      join(projectDir, ".sisyphus", "plans", "demo.md"),
      `# Demo\n\n## TODOs\n\n- [ ] 1. Task A\n\n  **Context Packs (REQUIRED)**:\n  - Context Packs: global\n`,
      "utf-8"
    )
    writeFileSync(
      join(projectDir, ".sisyphus", "context-manifests", "demo.md"),
      `[CONTEXT_MANIFEST]\n{"schemaVersion":1,"planName":"demo","generatedAt":"2026-02-05T00:00:00Z","packs":[{"id":"global","title":"G","items":[{"kind":"doc","ref":"docs/x.md"}]}]}\n[/CONTEXT_MANIFEST]`,
      "utf-8"
    )

    config = {
      sisyphus: {
        tasks: { enabled: true, storage_path: tasksDir, claude_code_compat: false },
        swarm: { enabled: true, storage_path: join(projectDir, ".sisyphus", "teams"), ui_mode: "toast", swarm_first: true, worker_count: 0 },
      },
      tmux_parallel_agents: { enabled: false },
    }
  })

  afterEach(() => {
    clearSwarmRuntimeRegistry()
    cleanupAllOrchestrators()
    if (existsSync(projectDir)) rmSync(projectDir, { recursive: true })
    if (existsSync(tasksDir)) rmSync(tasksDir, { recursive: true })
  })

  test("syncs plan todos to task pool on /start-work", async () => {
    // #given
    const { createSwarmFromPlanHook } = await import("./index")
    const hook = createSwarmFromPlanHook({ directory: projectDir } as unknown as PluginInput, config)
    type ChatMessageHandler = (typeof hook)["chat.message"]
    type HookInput = Parameters<ChatMessageHandler>[0]
    type HookOutput = Parameters<ChatMessageHandler>[1]

    const output: HookOutput = {
      parts: [
        { type: "text", text: "run /start-work\n<session-context>\n..." },
      ],
    }

    // #when
    const input: HookInput = { sessionID: "ses_main" }
    await hook["chat.message"](input, output)

    // #then
    expect(mockCreateCoordinator).toHaveBeenCalledTimes(1)
    const teamName = getSessionTeam("ses_main")
    expect(teamName).toBeDefined()
    expect(teamName?.startsWith("demo-")).toBe(true)

    const listDir = join(tasksDir, teamName!)
    const entries = existsSync(listDir) ? readdirSync(listDir) : []
    expect(entries.filter((e) => e.endsWith(".json"))).toHaveLength(1)

    const text = output.parts[0]?.text ?? ""
    expect(text).toContain("## Swarm-first Execution")
    expect(text).toContain(`Team: ${teamName}`)
    expect(text).toContain("Plan: demo")
  })
})
