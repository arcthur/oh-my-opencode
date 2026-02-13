import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { randomUUID } from "node:crypto"
import * as yaml from "js-yaml"
import { createContextManifestInjectorHook, extractRequestedContextPackIds } from "./index"
import type { WorkState } from "../../features/work-state"
import { contextBudgetArbiter } from "../../features/context-budget"

function writeWorkState(directory: string, state: Partial<WorkState>): void {
  const sisyphusDir = join(directory, ".sisyphus")
  mkdirSync(sisyphusDir, { recursive: true })

  const planId = state.plan_id ?? "demo"
  const fullState: WorkState = {
    schema_version: 6,
    executor: state.executor ?? "atlas",
    execution_plan_path: state.execution_plan_path ?? `.sisyphus/plans/${planId}/plan.md`,
    runtime_ledger_path: state.runtime_ledger_path ?? `.sisyphus/plans/${planId}/ledger.yaml`,
    plan_id: planId,
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
    contextBudgetArbiter.resetForTesting()
    testDir = join(tmpdir(), `context-manifest-injector-test-${randomUUID()}`)
    mkdirSync(testDir, { recursive: true })
  })

  afterEach(() => {
    contextBudgetArbiter.resetForTesting()
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
      execution_plan_path: ".sisyphus/plans/demo/plan.md",
      runtime_ledger_path: ".sisyphus/plans/demo/ledger.yaml",
      plan_id: "demo",
      session_ids: ["s1"],
    })

    const manifestPath = join(testDir, ".sisyphus", "context-manifests", "demo.md")
    mkdirSync(join(testDir, ".sisyphus", "context-manifests"), { recursive: true })
    writeFileSync(
      manifestPath,
      `# demo\n\n[CONTEXT_MANIFEST]\n${JSON.stringify({
        schemaVersion: 2,
        planId: "demo",
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
      execution_plan_path: ".sisyphus/plans/demo/plan.md",
      runtime_ledger_path: ".sisyphus/plans/demo/ledger.yaml",
      plan_id: "demo",
      session_ids: ["s1"],
    })

    const manifestPath = join(testDir, ".sisyphus", "context-manifests", "demo.md")
    mkdirSync(join(testDir, ".sisyphus", "context-manifests"), { recursive: true })
    writeFileSync(
      manifestPath,
      `# demo\n\n[CONTEXT_MANIFEST]\n${JSON.stringify({
        schemaVersion: 2,
        planId: "demo",
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

  test("should not allow plan_id path traversal (even if file exists)", async () => {
    // #given
    const hook = createContextManifestInjectorHook(createMockPluginInput())

    writeWorkState(testDir, {
      execution_plan_path: ".sisyphus/escape/plan.md",
      runtime_ledger_path: ".sisyphus/escape/ledger.yaml",
      plan_id: "../escape",
      session_ids: ["s1"],
    })

    // This creates a file reachable via .sisyphus/context-manifests/../escape.md
    const escapedPath = join(testDir, ".sisyphus", "escape.md")
    mkdirSync(join(testDir, ".sisyphus"), { recursive: true })
    writeFileSync(
      escapedPath,
      `# escape\n\n[CONTEXT_MANIFEST]\n${JSON.stringify({
        schemaVersion: 2,
        planId: "escape",
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
      execution_plan_path: ".sisyphus/plans/demo/plan.md",
      runtime_ledger_path: ".sisyphus/plans/demo/ledger.yaml",
      plan_id: "demo",
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

  test("should skip delegate prompt injection when budget is exhausted", async () => {
    // #given
    contextBudgetArbiter.setBudgetConfig({
      total_budget: 1,
      reserved_budget: 0,
      overflow_strategy: "drop-low-priority",
    })
    const hook = createContextManifestInjectorHook(createMockPluginInput())

    writeWorkState(testDir, {
      execution_plan_path: ".sisyphus/plans/demo/plan.md",
      runtime_ledger_path: ".sisyphus/plans/demo/ledger.yaml",
      plan_id: "demo",
      session_ids: ["s1"],
    })

    const manifestPath = join(testDir, ".sisyphus", "context-manifests", "demo.md")
    mkdirSync(join(testDir, ".sisyphus", "context-manifests"), { recursive: true })
    writeFileSync(
      manifestPath,
      `# demo\n\n[CONTEXT_MANIFEST]\n${JSON.stringify({
        schemaVersion: 2,
        planId: "demo",
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
    expect(output.args.prompt).not.toContain("auto-injected")
  })
})
