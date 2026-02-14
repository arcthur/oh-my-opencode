import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { randomUUID } from "node:crypto"
import * as yaml from "js-yaml"
import { createWorkStateManager } from "../../../src/features/work-state/manager"
import type { WorkState } from "../../../src/features/work-state/types"

function createTempWorkspace(): string {
  return join(tmpdir(), `work-state-v6-${randomUUID()}`)
}

describe("WorkStateManager v6", () => {
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

  test("initializePlan writes schema v6 state with canonical plan and ledger paths", () => {
    // #given
    const manager = createWorkStateManager(workspaceDir)

    // #when
    const state = manager.initializePlan("auth-refactor", "session-1", undefined)

    // #then
    expect(state.schema_version).toBe(6)
    expect(state.executor).toBe("workflow-automator")
    expect(state.plan_id).toBe("auth-refactor")
    expect(state.execution_plan_path).toBe(".orchestrator/plans/auth-refactor/plan.md")
    expect(state.runtime_ledger_path).toBe(".orchestrator/plans/auth-refactor/ledger.yaml")
    expect(state.session_ids).toEqual(["session-1"])
    expect(state.protocol.research_ops).toBe(0)
    expect(state.protocol.last_findings_mtime).toBe(0)
    expect(state.protocol.stop_verification_last_prompt_at_by_session).toEqual({})
  })

  test("initializePlan rejects non-canonical execution plan path", () => {
    // #given
    const manager = createWorkStateManager(workspaceDir)

    // #when / #then
    expect(() =>
      manager.initializePlan("auth-refactor", "session-1", ".orchestrator/plans/auth-refactor.md")
    ).toThrow("Invalid work-state invariant")
  })

  test("load rejects state with broken plan invariant", () => {
    // #given
    const badState: WorkState = {
      schema_version: 6,
      executor: "workflow-automator",
      plan_id: "demo",
      execution_plan_path: ".orchestrator/plans/demo.md",
      runtime_ledger_path: ".orchestrator/plans/demo/ledger.yaml",
      started_at: new Date().toISOString(),
      session_ids: ["session-1"],
      protocol: {
        research_ops: 0,
        last_findings_mtime: 0,
        stop_verification_last_prompt_at_by_session: {},
      },
      errors: [],
      blockers: [],
      decisions: [],
    }
    mkdirSync(join(workspaceDir, ".orchestrator"), { recursive: true })
    writeFileSync(join(workspaceDir, ".orchestrator", "work.yaml"), yaml.dump(badState), "utf-8")
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
      execution_plan_path: ".orchestrator/plans/legacy-plan/plan.md",
      runtime_ledger_path: ".orchestrator/plans/legacy-plan/ledger.yaml",
      started_at: new Date().toISOString(),
      session_ids: ["session-1"],
      research_ops: 0,
      last_findings_mtime: 0,
      errors: [],
      blockers: [],
      decisions: [],
    }
    mkdirSync(join(workspaceDir, ".orchestrator"), { recursive: true })
    writeFileSync(join(workspaceDir, ".orchestrator", "work.yaml"), yaml.dump(legacyState), "utf-8")
    const manager = createWorkStateManager(workspaceDir)

    // #when
    const loaded = manager.load()

    // #then
    expect(loaded).toBeNull()
  })

  test("load migrates v5 state to v6 and persists protocol fields", () => {
    // #given
    const legacyState = {
      schema_version: 5,
      executor: "workflow-automator",
      plan_id: "migrate-plan",
      execution_plan_path: ".orchestrator/plans/migrate-plan/plan.md",
      runtime_ledger_path: ".orchestrator/plans/migrate-plan/ledger.yaml",
      started_at: "2026-02-01T00:00:00.000Z",
      session_ids: ["session-1", "session-2"],
      research_ops: 4,
      last_findings_mtime: 12345,
      errors: [],
      blockers: [],
      decisions: [],
    }
    mkdirSync(join(workspaceDir, ".orchestrator"), { recursive: true })
    writeFileSync(join(workspaceDir, ".orchestrator", "work.yaml"), yaml.dump(legacyState), "utf-8")
    const manager = createWorkStateManager(workspaceDir)

    // #when
    const loaded = manager.load()
    const persisted = yaml.load(
      readFileSync(join(workspaceDir, ".orchestrator", "work.yaml"), "utf-8")
    ) as Record<string, unknown>

    // #then
    expect(loaded).not.toBeNull()
    expect(loaded?.schema_version).toBe(6)
    expect(loaded?.protocol.research_ops).toBe(4)
    expect(loaded?.protocol.last_findings_mtime).toBe(12345)
    expect(loaded?.protocol.stop_verification_last_prompt_at_by_session).toEqual({})
    expect(persisted.schema_version).toBe(6)
    expect((persisted.protocol as { research_ops?: number }).research_ops).toBe(4)
    expect("research_ops" in persisted).toBe(false)
    expect("last_findings_mtime" in persisted).toBe(false)
  })

  test("switchPlan replaces active plan and resets session list", () => {
    // #given
    const manager = createWorkStateManager(workspaceDir)
    manager.initializePlan("plan-a", "session-a", undefined)

    // #when
    const switched = manager.switchPlan("plan-b", "session-b", undefined)

    // #then
    expect(switched.plan_id).toBe("plan-b")
    expect(switched.execution_plan_path).toBe(".orchestrator/plans/plan-b/plan.md")
    expect(switched.runtime_ledger_path).toBe(".orchestrator/plans/plan-b/ledger.yaml")
    expect(switched.session_ids).toEqual(["session-b"])
  })

  test("findPlans discovers only canonical plan.md files in plan directories", () => {
    // #given
    mkdirSync(join(workspaceDir, ".orchestrator", "plans", "p1"), { recursive: true })
    mkdirSync(join(workspaceDir, ".orchestrator", "plans", "p2"), { recursive: true })
    writeFileSync(join(workspaceDir, ".orchestrator", "plans", "p1", "plan.md"), "# p1")
    writeFileSync(join(workspaceDir, ".orchestrator", "plans", "p2", "plan.md"), "# p2")
    writeFileSync(join(workspaceDir, ".orchestrator", "plans", "legacy.md"), "# legacy")

    const manager = createWorkStateManager(workspaceDir)

    // #when
    const plans = manager.findPlans()

    // #then
    expect(plans).toContain(".orchestrator/plans/p1/plan.md")
    expect(plans).toContain(".orchestrator/plans/p2/plan.md")
    expect(plans.some((p) => p.endsWith("legacy.md"))).toBe(false)
  })
})
