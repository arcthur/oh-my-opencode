import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import { existsSync, mkdirSync, rmSync, writeFileSync, utimesSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { randomUUID } from "node:crypto"
import * as yaml from "js-yaml"
import { createWorkStateManager } from "./manager"
import type { WorkState } from "./types"

function createTempWorkspace(): string {
  return join(tmpdir(), `work-state-v2-${randomUUID()}`)
}

describe("WorkStateManager v2", () => {
  let workspaceDir: string

  beforeEach(() => {
    workspaceDir = createTempWorkspace()
    mkdirSync(workspaceDir, { recursive: true })
  })

  afterEach(() => {
    if (existsSync(workspaceDir)) {
      rmSync(workspaceDir, { recursive: true, force: true })
    }
  })

  test("load returns null when work.yaml is missing", () => {
    // #given
    const manager = createWorkStateManager(workspaceDir)

    // #when
    const loaded = manager.load()

    // #then
    expect(loaded).toBeNull()
  })

  test("initializePlan writes schema v2 state with canonical plan and ledger paths", () => {
    // #given
    const manager = createWorkStateManager(workspaceDir)

    // #when
    const state = manager.initializePlan("auth-refactor", "session-1")

    // #then
    expect(state.schema_version).toBe(2)
    expect(state.plan_id).toBe("auth-refactor")
    expect(state.execution_plan_path).toBe(".sisyphus/plans/auth-refactor/plan.md")
    expect(state.runtime_ledger_path).toBe(".sisyphus/plans/auth-refactor/ledger.yaml")
    expect(state.session_ids).toEqual(["session-1"])
  })

  test("initializePlan rejects non-canonical execution plan path", () => {
    // #given
    const manager = createWorkStateManager(workspaceDir)

    // #when / #then
    expect(() =>
      manager.initializePlan(
        "auth-refactor",
        "session-1",
        ".sisyphus/plans/auth-refactor.md"
      )
    ).toThrow("Invalid work-state invariant")
  })

  test("load rejects state with broken plan invariant", () => {
    // #given
    const badState: WorkState = {
      schema_version: 2,
      plan_id: "demo",
      execution_plan_path: ".sisyphus/plans/demo.md",
      runtime_ledger_path: ".sisyphus/plans/demo/ledger.yaml",
      started_at: new Date().toISOString(),
      session_ids: ["session-1"],
      research_ops: 0,
      last_findings_mtime: 0,
      errors: [],
      blockers: [],
      phase_completions: [],
      decisions: [],
    }
    mkdirSync(join(workspaceDir, ".sisyphus"), { recursive: true })
    writeFileSync(join(workspaceDir, ".sisyphus", "work.yaml"), yaml.dump(badState), "utf-8")
    const manager = createWorkStateManager(workspaceDir)

    // #when
    const loaded = manager.load()

    // #then
    expect(loaded).toBeNull()
  })

  test("switchPlan replaces active plan and resets session list", () => {
    // #given
    const manager = createWorkStateManager(workspaceDir)
    manager.initializePlan("plan-a", "session-a")

    // #when
    const switched = manager.switchPlan("plan-b", "session-b")

    // #then
    expect(switched.plan_id).toBe("plan-b")
    expect(switched.execution_plan_path).toBe(".sisyphus/plans/plan-b/plan.md")
    expect(switched.runtime_ledger_path).toBe(".sisyphus/plans/plan-b/ledger.yaml")
    expect(switched.session_ids).toEqual(["session-b"])
  })

  test("getPlanProgress reads numbered checkbox todos from canonical plan.md", () => {
    // #given
    const planDir = join(workspaceDir, ".sisyphus", "plans", "demo")
    mkdirSync(planDir, { recursive: true })
    writeFileSync(
      join(planDir, "plan.md"),
      "# Demo\n\n## TODOs\n\n- [x] 1. Setup\n- [ ] 2. Implement\n- [ ] 3. Verify\n",
      "utf-8"
    )

    const manager = createWorkStateManager(workspaceDir)
    manager.initializePlan("demo", "session-1")

    // #when
    const progress = manager.getPlanProgress()

    // #then
    expect(progress.total).toBe(3)
    expect(progress.completed).toBe(1)
    expect(progress.isComplete).toBe(false)
  })

  test("task snapshot invalidates when plan.md mtime changes", () => {
    // #given
    const planDir = join(workspaceDir, ".sisyphus", "plans", "snapshot")
    const planPath = join(planDir, "plan.md")
    mkdirSync(planDir, { recursive: true })
    writeFileSync(planPath, "# Demo\n- [x] 1. Done\n- [ ] 2. Pending\n", "utf-8")

    const manager = createWorkStateManager(workspaceDir)
    manager.initializePlan("snapshot", "session-1")

    const first = manager.getPlanProgress()
    expect(first.completed).toBe(1)
    const firstSnapshot = manager.getTaskSnapshot()

    // #when
    writeFileSync(planPath, "# Demo\n- [x] 1. Done\n- [x] 2. Pending\n", "utf-8")
    const baselineMtime = firstSnapshot?.plan_mtime ?? Date.now()
    const bumpedMtime = new Date(baselineMtime + 2000)
    utimesSync(planPath, new Date(), bumpedMtime)

    const second = manager.getPlanProgress()
    const secondSnapshot = manager.getTaskSnapshot()

    // #then
    expect(second.completed).toBe(2)
    expect(secondSnapshot?.plan_mtime).toBeGreaterThan(firstSnapshot?.plan_mtime ?? 0)
  })

  test("findPlans discovers only canonical plan.md files in plan directories", () => {
    // #given
    mkdirSync(join(workspaceDir, ".sisyphus", "plans", "p1"), { recursive: true })
    mkdirSync(join(workspaceDir, ".sisyphus", "plans", "p2"), { recursive: true })
    writeFileSync(join(workspaceDir, ".sisyphus", "plans", "p1", "plan.md"), "# p1\n- [ ] 1. a")
    writeFileSync(join(workspaceDir, ".sisyphus", "plans", "p2", "plan.md"), "# p2\n- [ ] 1. b")
    writeFileSync(join(workspaceDir, ".sisyphus", "plans", "legacy.md"), "# legacy")

    const manager = createWorkStateManager(workspaceDir)

    // #when
    const plans = manager.findPlans()

    // #then
    expect(plans).toContain(".sisyphus/plans/p1/plan.md")
    expect(plans).toContain(".sisyphus/plans/p2/plan.md")
    expect(plans.some((p) => p.endsWith("legacy.md"))).toBe(false)
  })
})
