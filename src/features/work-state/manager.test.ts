import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { randomUUID } from "node:crypto"
import * as yaml from "js-yaml"
import { createWorkStateManager } from "./manager"
import type { WorkState } from "./types"

function createTempWorkspace(): string {
  return join(tmpdir(), `work-state-v5-${randomUUID()}`)
}

describe("WorkStateManager v5", () => {
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

  test("initializePlan writes schema v5 state with canonical plan and ledger paths", () => {
    // #given
    const manager = createWorkStateManager(workspaceDir)

    // #when
    const state = manager.initializePlan("auth-refactor", "session-1", undefined)

    // #then
    expect(state.schema_version).toBe(5)
    expect(state.executor).toBe("atlas")
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
      manager.initializePlan("auth-refactor", "session-1", ".sisyphus/plans/auth-refactor.md")
    ).toThrow("Invalid work-state invariant")
  })

  test("load rejects state with broken plan invariant", () => {
    // #given
    const badState: WorkState = {
      schema_version: 5,
      executor: "atlas",
      plan_id: "demo",
      execution_plan_path: ".sisyphus/plans/demo.md",
      runtime_ledger_path: ".sisyphus/plans/demo/ledger.yaml",
      started_at: new Date().toISOString(),
      session_ids: ["session-1"],
      research_ops: 0,
      last_findings_mtime: 0,
      errors: [],
      blockers: [],
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

  test("load rejects legacy v3 work-state", () => {
    // #given
    const legacyState = {
      schema_version: 3,
      plan_id: "legacy-plan",
      execution_plan_path: ".sisyphus/plans/legacy-plan/plan.md",
      runtime_ledger_path: ".sisyphus/plans/legacy-plan/ledger.yaml",
      started_at: new Date().toISOString(),
      session_ids: ["session-1"],
      research_ops: 0,
      last_findings_mtime: 0,
      errors: [],
      blockers: [],
      decisions: [],
    }
    mkdirSync(join(workspaceDir, ".sisyphus"), { recursive: true })
    writeFileSync(join(workspaceDir, ".sisyphus", "work.yaml"), yaml.dump(legacyState), "utf-8")
    const manager = createWorkStateManager(workspaceDir)

    // #when
    const loaded = manager.load()

    // #then
    expect(loaded).toBeNull()
  })

  test("switchPlan replaces active plan and resets session list", () => {
    // #given
    const manager = createWorkStateManager(workspaceDir)
    manager.initializePlan("plan-a", "session-a", undefined)

    // #when
    const switched = manager.switchPlan("plan-b", "session-b", undefined)

    // #then
    expect(switched.plan_id).toBe("plan-b")
    expect(switched.execution_plan_path).toBe(".sisyphus/plans/plan-b/plan.md")
    expect(switched.runtime_ledger_path).toBe(".sisyphus/plans/plan-b/ledger.yaml")
    expect(switched.session_ids).toEqual(["session-b"])
  })

  test("findPlans discovers only canonical plan.md files in plan directories", () => {
    // #given
    mkdirSync(join(workspaceDir, ".sisyphus", "plans", "p1"), { recursive: true })
    mkdirSync(join(workspaceDir, ".sisyphus", "plans", "p2"), { recursive: true })
    writeFileSync(join(workspaceDir, ".sisyphus", "plans", "p1", "plan.md"), "# p1")
    writeFileSync(join(workspaceDir, ".sisyphus", "plans", "p2", "plan.md"), "# p2")
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
