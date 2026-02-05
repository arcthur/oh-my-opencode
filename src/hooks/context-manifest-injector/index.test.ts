import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { randomUUID } from "node:crypto"
import * as yaml from "js-yaml"
import { createContextManifestInjectorHook, extractRequestedContextPackIds } from "./index"
import type { WorkState } from "../../features/work-state"

function writeWorkState(directory: string, state: Partial<WorkState>): void {
  const sisyphusDir = join(directory, ".sisyphus")
  mkdirSync(sisyphusDir, { recursive: true })

  const fullState: WorkState = {
    active_plan: state.active_plan ?? "",
    plan_name: state.plan_name ?? "",
    started_at: state.started_at ?? new Date().toISOString(),
    session_ids: state.session_ids ?? [],
    research_ops: state.research_ops ?? 0,
    last_findings_mtime: state.last_findings_mtime ?? 0,
    errors: state.errors ?? [],
    blockers: state.blockers ?? [],
    phase_completions: state.phase_completions ?? [],
    decisions: state.decisions ?? [],
  }
  writeFileSync(join(sisyphusDir, "work.yaml"), yaml.dump(fullState, { indent: 2 }))
}

describe("context-manifest-injector hook", () => {
  let testDir: string

  function createMockPluginInput() {
    return {
      directory: testDir,
      client: {},
    } as Parameters<typeof createContextManifestInjectorHook>[0]
  }

  beforeEach(() => {
    testDir = join(tmpdir(), `context-manifest-injector-test-${randomUUID()}`)
    mkdirSync(testDir, { recursive: true })
  })

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true })
    }
  })

  test("should not modify delegate_task prompt when no Context Packs are requested", async () => {
    // #given
    const hook = createContextManifestInjectorHook(createMockPluginInput())
    const output = {
      args: {
        prompt: "## 1. TASK\nDo something\n",
      },
    }

    // #when
    await hook["tool.execute.before"]?.({ tool: "delegate_task", sessionID: "s1", callID: "c1" }, output)

    // #then
    expect(output.args.prompt).toBe("## 1. TASK\nDo something\n")
  })

  test("should inject selected packs into delegate_task prompt when manifest exists", async () => {
    // #given
    const hook = createContextManifestInjectorHook(createMockPluginInput())

    writeWorkState(testDir, {
      active_plan: ".sisyphus/plans/demo.md",
      plan_name: "demo",
      session_ids: ["s1"],
    })

    const manifestPath = join(testDir, ".sisyphus", "context-manifests", "demo.md")
    mkdirSync(join(testDir, ".sisyphus", "context-manifests"), { recursive: true })
    writeFileSync(
      manifestPath,
      `# demo\n\n[CONTEXT_MANIFEST]\n${JSON.stringify({
        schemaVersion: 1,
        planName: "demo",
        generatedAt: "2026-02-05T00:00:00Z",
        packs: [
          {
            id: "global",
            title: "Global",
            items: [{ kind: "doc", ref: "docs/a.md", why: "A" }],
          },
        ],
      })}\n[/CONTEXT_MANIFEST]\n`
    )

    const output = {
      args: {
        prompt: "## 1. TASK\nWire it\n\nContext Packs: global\n",
      },
    }

    // #when
    await hook["tool.execute.before"]?.({ tool: "delegate_task", sessionID: "s1", callID: "c1" }, output)

    // #then
    expect(output.args.prompt).toContain("## CONTEXT PACKS (auto-injected)")
    expect(output.args.prompt).toContain("docs/a.md")
  })

  test("should not inject twice when marker already present", async () => {
    // #given
    const hook = createContextManifestInjectorHook(createMockPluginInput())

    writeWorkState(testDir, {
      active_plan: ".sisyphus/plans/demo.md",
      plan_name: "demo",
      session_ids: ["s1"],
    })

    const manifestPath = join(testDir, ".sisyphus", "context-manifests", "demo.md")
    mkdirSync(join(testDir, ".sisyphus", "context-manifests"), { recursive: true })
    writeFileSync(
      manifestPath,
      `# demo\n\n[CONTEXT_MANIFEST]\n${JSON.stringify({
        schemaVersion: 1,
        planName: "demo",
        generatedAt: "2026-02-05T00:00:00Z",
        packs: [
          {
            id: "global",
            title: "Global",
            items: [{ kind: "doc", ref: "docs/a.md", why: "A" }],
          },
        ],
      })}\n[/CONTEXT_MANIFEST]\n`
    )

    const originalPrompt =
      "Context Packs: global\n\n## CONTEXT PACKS (auto-injected)\n\n(existing)\n"
    const output = {
      args: {
        prompt: originalPrompt,
      },
    }

    // #when
    await hook["tool.execute.before"]?.({ tool: "delegate_task", sessionID: "s1", callID: "c1" }, output)

    // #then
    expect(output.args.prompt).toBe(originalPrompt)
  })

  test("should parse Context Packs from bullet list format", () => {
    // #given
    const prompt = "Context Packs:\n- global\n- tooling\n"

    // #when
    const ids = extractRequestedContextPackIds(prompt)

    // #then
    expect(ids).toEqual(["global", "tooling"])
  })

  test("should not allow plan_name path traversal (even if file exists)", async () => {
    // #given
    const hook = createContextManifestInjectorHook(createMockPluginInput())

    writeWorkState(testDir, {
      active_plan: ".sisyphus/plans/demo.md",
      plan_name: "../escape",
      session_ids: ["s1"],
    })

    // This creates a file reachable via .sisyphus/context-manifests/../escape.md
    const escapedPath = join(testDir, ".sisyphus", "escape.md")
    mkdirSync(join(testDir, ".sisyphus"), { recursive: true })
    writeFileSync(
      escapedPath,
      `# escape\n\n[CONTEXT_MANIFEST]\n${JSON.stringify({
        schemaVersion: 1,
        planName: "escape",
        generatedAt: "2026-02-05T00:00:00Z",
        packs: [
          {
            id: "global",
            title: "Global",
            items: [{ kind: "doc", ref: "docs/escape.md", why: "Escape" }],
          },
        ],
      })}\n[/CONTEXT_MANIFEST]\n`
    )

    const output = {
      args: {
        prompt: "Context Packs: global\n",
      },
    }

    // #when
    await hook["tool.execute.before"]?.({ tool: "delegate_task", sessionID: "s1", callID: "c1" }, output)

    // #then
    expect(output.args.prompt).not.toContain("auto-injected")
    expect(output.args.prompt).not.toContain("docs/escape.md")
  })

  test("should not inject when manifest is missing", async () => {
    // #given
    const hook = createContextManifestInjectorHook(createMockPluginInput())
    writeWorkState(testDir, {
      active_plan: ".sisyphus/plans/demo.md",
      plan_name: "demo",
      session_ids: ["s1"],
    })

    const output = {
      args: {
        prompt: "Context Packs: global\n",
      },
    }

    // #when
    await hook["tool.execute.before"]?.({ tool: "delegate_task", sessionID: "s1", callID: "c1" }, output)

    // #then
    expect(output.args.prompt).not.toContain("auto-injected")
  })

  test("should not inject when work state is unavailable", async () => {
    // #given
    const hook = createContextManifestInjectorHook(createMockPluginInput())

    const output = {
      args: {
        prompt: "Context Packs: global\n",
      },
    }

    // #when
    await hook["tool.execute.before"]?.({ tool: "delegate_task", sessionID: "s1", callID: "c1" }, output)

    // #then
    expect(output.args.prompt).not.toContain("auto-injected")
  })
})

