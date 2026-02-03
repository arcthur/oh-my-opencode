import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import { existsSync, mkdirSync, rmSync, writeFileSync, readFileSync, utimesSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import * as yaml from "js-yaml"
import { createWorkStateManager, WorkStateManager } from "./manager"
import type { WorkState } from "./types"

describe("WorkStateManager", () => {
  const TEST_DIR = join(tmpdir(), "work-state-test-" + Date.now())
  const SISYPHUS_DIR = join(TEST_DIR, ".sisyphus")
  const PLANS_DIR = join(SISYPHUS_DIR, "plans")

  beforeEach(() => {
    mkdirSync(PLANS_DIR, { recursive: true })
  })

  afterEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true })
    }
  })

  describe("load()", () => {
    test("should return null when no work.yaml exists", () => {
      // given - no state file
      const manager = createWorkStateManager(TEST_DIR)
      // when
      const state = manager.load()
      // then
      expect(state).toBeNull()
    })

    test("should normalize absolute active_plan to workspace-relative on load", () => {
      // given - work.yaml exists with absolute plan path inside workspace
      const planAbs = join(PLANS_DIR, "abs-plan.md")
      writeFileSync(planAbs, "# Plan\n- [ ] Task 1")

      const workState: Partial<WorkState> = {
        active_plan: planAbs,
        plan_name: "abs-plan",
        started_at: "2026-01-02T10:00:00Z",
        session_ids: ["session-1"],
        research_ops: 0,
        last_findings_mtime: 0,
        errors: [],
        blockers: [],
        phase_completions: [],
        decisions: [],
      }
      writeFileSync(join(SISYPHUS_DIR, "work.yaml"), yaml.dump(workState))

      const manager = createWorkStateManager(TEST_DIR)
      // when
      const loaded = manager.load()
      // then
      expect(loaded).not.toBeNull()
      expect(loaded!.active_plan).toBe(".sisyphus/plans/abs-plan.md")
      expect(loaded!.plan_name).toBe("abs-plan")
    })
  })

  describe("getPlanProgress() phase fallback (P0-3)", () => {
    test("should use checkbox progress when checkboxes exist", () => {
      // given - plan with checkboxes
      const planPath = join(PLANS_DIR, "checkbox-plan.md")
      writeFileSync(
        planPath,
        "# Plan\n- [x] Task 1\n- [x] Task 2\n- [ ] Task 3\n- [ ] Task 4"
      )

      const manager = createWorkStateManager(TEST_DIR)
      manager.initialize(planPath, "session-1")

      // when
      const progress = manager.getPlanProgress()

      // then - checkbox-based progress
      expect(progress.total).toBe(4)
      expect(progress.completed).toBe(2)
      expect(progress.isComplete).toBe(false)
    })

    test("should fallback to phase progress when no checkboxes", () => {
      // given - plan with phases but no checkboxes (Manus-style)
      const planPath = join(PLANS_DIR, "phase-plan.md")
      writeFileSync(
        planPath,
        `# Plan

## Phase 1: Setup [complete]
Description of setup phase

## Phase 2: Implementation [in_progress]
Description of implementation

## Phase 3: Testing [pending]
Description of testing
`
      )

      const manager = createWorkStateManager(TEST_DIR)
      manager.initialize(planPath, "session-1")

      // when
      const progress = manager.getPlanProgress()

      // then - phase-based progress fallback
      expect(progress.total).toBe(3)
      expect(progress.completed).toBe(1) // Only Phase 1 is complete
      expect(progress.isComplete).toBe(false)
    })

    test("should not report complete when plan has no checkboxes and no phases", () => {
      // given - plan with neither checkboxes nor phases
      const planPath = join(PLANS_DIR, "empty-plan.md")
      writeFileSync(planPath, "# Plan\n\nSome description text without tasks.")

      const manager = createWorkStateManager(TEST_DIR)
      manager.initialize(planPath, "session-1")

      // when
      const progress = manager.getPlanProgress()

      // then - should NOT report as complete (isComplete=false to avoid false positives)
      expect(progress.total).toBe(0)
      expect(progress.completed).toBe(0)
      expect(progress.isComplete).toBe(false)
    })

    test("should report complete when all checkboxes are checked", () => {
      // given - fully completed plan
      const planPath = join(PLANS_DIR, "done-plan.md")
      writeFileSync(planPath, "# Plan\n- [x] Task 1\n- [x] Task 2\n- [x] Task 3")

      const manager = createWorkStateManager(TEST_DIR)
      manager.initialize(planPath, "session-1")

      // when
      const progress = manager.getPlanProgress()

      // then
      expect(progress.total).toBe(3)
      expect(progress.completed).toBe(3)
      expect(progress.isComplete).toBe(true)
    })

    test("should report complete when all phases are complete", () => {
      // given - all phases complete (no checkboxes)
      const planPath = join(PLANS_DIR, "done-phases.md")
      writeFileSync(
        planPath,
        `# Plan

## Phase 1: Setup [complete]
Done

## Phase 2: Implementation [done]
Done
`
      )

      const manager = createWorkStateManager(TEST_DIR)
      manager.initialize(planPath, "session-1")

      // when
      const progress = manager.getPlanProgress()

      // then - all phases complete
      expect(progress.total).toBe(2)
      expect(progress.completed).toBe(2)
      expect(progress.isComplete).toBe(true)
    })
  })

  describe("task_snapshot caching", () => {
    test("should cache task progress in work.yaml", () => {
      // given - plan with checkboxes
      const planPath = join(PLANS_DIR, "snapshot-plan.md")
      writeFileSync(planPath, "# Plan\n- [x] Task 1\n- [ ] Task 2\n- [ ] Task 3")

      const manager = createWorkStateManager(TEST_DIR)
      manager.initialize(planPath, "session-1")

      // when - get progress (triggers cache)
      const progress = manager.getPlanProgress()

      // then - snapshot should be cached
      const snapshot = manager.getTaskSnapshot()
      expect(snapshot).not.toBeNull()
      expect(snapshot!.total).toBe(3)
      expect(snapshot!.completed).toBe(1)
      expect(snapshot!.plan_mtime).toBeGreaterThan(0)
      expect(snapshot!.last_sync).toBeTruthy()
    })

    test("should use cached snapshot when plan file unchanged", () => {
      // given - plan with checkboxes
      const planPath = join(PLANS_DIR, "cache-hit-plan.md")
      writeFileSync(planPath, "# Plan\n- [x] Task 1\n- [ ] Task 2")

      const manager = createWorkStateManager(TEST_DIR)
      manager.initialize(planPath, "session-1")

      // First call - cache miss, calculates from file
      const progress1 = manager.getPlanProgress()
      const snapshot1 = manager.getTaskSnapshot()

      // when - second call (should use cache)
      const progress2 = manager.getPlanProgress()
      const snapshot2 = manager.getTaskSnapshot()

      // then - same results, same snapshot
      expect(progress2.total).toBe(progress1.total)
      expect(progress2.completed).toBe(progress1.completed)
      expect(snapshot2!.last_sync).toBe(snapshot1!.last_sync) // Same sync time = cache hit
    })

    test("should invalidate cache when plan file is modified", async () => {
      // given - plan with checkboxes
      const planPath = join(PLANS_DIR, "cache-invalidate-plan.md")
      writeFileSync(planPath, "# Plan\n- [x] Task 1\n- [ ] Task 2")

      const manager = createWorkStateManager(TEST_DIR)
      manager.initialize(planPath, "session-1")

      // First call - cache miss
      const progress1 = manager.getPlanProgress()
      expect(progress1.completed).toBe(1)
      const snapshot1 = manager.getTaskSnapshot()

      // when - modify file (complete task 2)
      writeFileSync(planPath, "# Plan\n- [x] Task 1\n- [x] Task 2")
      // Force bump mtime to avoid FS timestamp granularity flakiness
      const baseMtime = snapshot1?.plan_mtime ?? 0
      const bumpedMtime = new Date((baseMtime > 0 ? baseMtime : Date.now()) + 2000)
      utimesSync(planPath, new Date(), bumpedMtime)

      // then - cache should be invalidated
      const progress2 = manager.getPlanProgress()
      expect(progress2.completed).toBe(2)
      const snapshot2 = manager.getTaskSnapshot()
      expect(snapshot2!.completed).toBe(2)
      expect(snapshot2!.plan_mtime).toBeGreaterThan(snapshot1!.plan_mtime)
    })

    test("syncTaskSnapshot should force recalculate", () => {
      // given - plan with checkboxes and existing snapshot
      const planPath = join(PLANS_DIR, "force-sync-plan.md")
      writeFileSync(planPath, "# Plan\n- [ ] Task 1\n- [ ] Task 2")

      const manager = createWorkStateManager(TEST_DIR)
      manager.initialize(planPath, "session-1")

      // Initial cache
      manager.getPlanProgress()
      const snapshot1 = manager.getTaskSnapshot()

      // Wait 1ms to ensure different timestamp (ISO string precision is ms)
      Bun.sleepSync(1)

      // when - force sync
      const progress = manager.syncTaskSnapshot()

      // then - snapshot should be updated
      expect(progress.total).toBe(2)
      expect(progress.completed).toBe(0)
      const snapshot2 = manager.getTaskSnapshot()
      expect(snapshot2!.last_sync).not.toBe(snapshot1!.last_sync) // Different sync time
    })
  })

  describe("clearPhaseCache() precision (P1)", () => {
    test("should clear cache for specific plan", () => {
      // given - manager with state
      const planPath = join(PLANS_DIR, "test-plan.md")
      writeFileSync(planPath, "# Plan\n## 1. Task [pending]")

      const manager = createWorkStateManager(TEST_DIR)
      manager.initialize(planPath, "session-1")

      // Populate phase cache
      manager.detectPhaseCompletion()

      // when - clear cache for specific plan
      manager.clearPhaseCache("test-plan")

      // then - cache should be cleared (next detectPhaseCompletion returns empty)
      const completions = manager.detectPhaseCompletion()
      expect(completions).toEqual([]) // First call after clear returns empty
    })

    test("should clear all caches for directory", () => {
      // given - manager with state
      const planPath = join(PLANS_DIR, "test-plan.md")
      writeFileSync(planPath, "# Plan\n## 1. Task [pending]")

      const manager = createWorkStateManager(TEST_DIR)
      manager.initialize(planPath, "session-1")

      // Populate phase cache
      manager.detectPhaseCompletion()

      // when - clear all caches
      manager.clearAllPhaseCaches()

      // then - cache should be cleared
      const completions = manager.detectPhaseCompletion()
      expect(completions).toEqual([])
    })
  })
})
