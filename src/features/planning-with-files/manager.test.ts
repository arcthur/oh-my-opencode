import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import * as fs from "fs"
import * as os from "os"
import * as path from "path"
import {
  parsePhases,
  getStrikeGuidance,
  getCurrentPhase,
  generateReflectionPrompt,
  generateErrorRecordingPrompt,
  generateBlockerPrompt,
  getPlanDir,
  loadState,
  saveState,
  wasFindingsModified,
  readTaskPlan,
  writeTaskPlan,
  detectActivePlan,
  initializePlan,
  detectPhaseCompletion,
  isErrorRecorded,
  cleanupSession,
} from "./manager"
import type { PlanningState, PhaseStatus } from "./types"

function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "planning-with-files-"))
}

// #region Pure Functions
describe("parsePhases", () => {
  test("parses all status types including blocked", () => {
    // #given
    const content = `# Task Plan
| # | Phase | Status |
|---|-------|--------|
| 1 | Discovery | pending |
| 2 | Implementation | in_progress |
| 3 | Verification | complete |
| 4 | Cleanup | blocked |
`
    // #when
    const phases = parsePhases(content)

    // #then
    expect(phases).toHaveLength(4)
    expect(phases[0]).toEqual({ id: 1, name: "Discovery", status: "pending" })
    expect(phases[1]).toEqual({ id: 2, name: "Implementation", status: "in_progress" })
    expect(phases[2]).toEqual({ id: 3, name: "Verification", status: "complete" })
    expect(phases[3]).toEqual({ id: 4, name: "Cleanup", status: "blocked" })
  })

  test("normalizes status values case-insensitively", () => {
    // #given
    const content = `| 1 | Phase | PENDING |
| 2 | Phase | In_Progress |
| 3 | Phase | COMPLETE |`

    // #when
    const phases = parsePhases(content)

    // #then
    expect(phases[0].status).toBe("pending")
    expect(phases[1].status).toBe("in_progress")
    expect(phases[2].status).toBe("complete")
  })

  test("returns empty array for invalid input", () => {
    // #then - empty string
    expect(parsePhases("")).toHaveLength(0)
    // #then - no table format
    expect(parsePhases("No phases here")).toHaveLength(0)
    // #then - malformed table
    expect(parsePhases("| invalid |")).toHaveLength(0)
  })

  test("trims whitespace from phase names", () => {
    // #given
    const content = `| 1 |   Discovery Phase   | pending |`

    // #when
    const phases = parsePhases(content)

    // #then
    expect(phases[0].name).toBe("Discovery Phase")
  })
})

describe("getStrikeGuidance", () => {
  test("returns diagnose message for strike 1", () => {
    // #when
    const guidance = getStrikeGuidance(1, false)

    // #then
    expect(guidance).toContain("Strike 1/3")
    expect(guidance).toContain("Diagnose")
  })

  test("returns pivot message with recording note for strike 2", () => {
    // #when
    const guidance = getStrikeGuidance(2, true)

    // #then
    expect(guidance).toContain("Strike 2/3")
    expect(guidance).toContain("Pivot")
    expect(guidance).toContain("REQUIRED")
  })

  test("returns reassess message for strike 3", () => {
    // #when
    const guidance = getStrikeGuidance(3, true)

    // #then
    expect(guidance).toContain("Strike 3/3")
    expect(guidance).toContain("Reassess")
  })

  test("returns escalate message for strike 4+", () => {
    // #when
    const guidance = getStrikeGuidance(5, true)

    // #then
    expect(guidance).toContain("Strike 5/3")
    expect(guidance).toContain("ESCALATE")
  })

  test("omits recording note when not required", () => {
    // #when
    const guidance = getStrikeGuidance(2, false)

    // #then
    expect(guidance).not.toContain("REQUIRED")
  })
})

describe("getCurrentPhase", () => {
  test("returns in_progress phase id", () => {
    // #given
    const phases = [
      { id: 1, name: "Done", status: "complete" as PhaseStatus },
      { id: 2, name: "Current", status: "in_progress" as PhaseStatus },
      { id: 3, name: "Next", status: "pending" as PhaseStatus },
    ]

    // #when
    const current = getCurrentPhase(phases)

    // #then
    expect(current).toBe(2)
  })

  test("returns null when no in_progress phase", () => {
    // #given
    const phases = [
      { id: 1, name: "Done", status: "complete" as PhaseStatus },
      { id: 2, name: "Pending", status: "pending" as PhaseStatus },
    ]

    // #when
    const current = getCurrentPhase(phases)

    // #then
    expect(current).toBeNull()
  })

  test("returns first in_progress when multiple exist", () => {
    // #given
    const phases = [
      { id: 1, name: "First", status: "in_progress" as PhaseStatus },
      { id: 2, name: "Second", status: "in_progress" as PhaseStatus },
    ]

    // #when
    const current = getCurrentPhase(phases)

    // #then
    expect(current).toBe(1)
  })
})

describe("generateReflectionPrompt", () => {
  test("includes completed phase info", () => {
    // #given
    const completedPhase = { id: 2, name: "Implementation" }
    const allPhases = [
      { id: 1, name: "Discovery", status: "complete" as PhaseStatus },
      { id: 2, name: "Implementation", status: "complete" as PhaseStatus },
      { id: 3, name: "Verification", status: "pending" as PhaseStatus },
    ]

    // #when
    const prompt = generateReflectionPrompt(completedPhase, allPhases)

    // #then
    expect(prompt).toContain("Phase 2 Complete: Implementation")
    expect(prompt).toContain("<phase-reflection>")
  })

  test("lists remaining phases", () => {
    // #given
    const completedPhase = { id: 1, name: "Discovery" }
    const allPhases = [
      { id: 1, name: "Discovery", status: "complete" as PhaseStatus },
      { id: 2, name: "Implementation", status: "pending" as PhaseStatus },
      { id: 3, name: "Verification", status: "pending" as PhaseStatus },
    ]

    // #when
    const prompt = generateReflectionPrompt(completedPhase, allPhases)

    // #then
    expect(prompt).toContain("Phase 2: Implementation (pending)")
    expect(prompt).toContain("Phase 3: Verification (pending)")
  })

  test("handles empty remaining phases", () => {
    // #given
    const completedPhase = { id: 1, name: "Only Phase" }
    const allPhases = [{ id: 1, name: "Only Phase", status: "complete" as PhaseStatus }]

    // #when
    const prompt = generateReflectionPrompt(completedPhase, allPhases)

    // #then
    expect(prompt).toContain("Phase 1 Complete")
    expect(prompt).not.toContain("Remaining:")
  })
})

describe("generateErrorRecordingPrompt", () => {
  test("includes error key and strikes count", () => {
    // #when
    const prompt = generateErrorRecordingPrompt("Bash:npm install failed", 2, 1)

    // #then
    expect(prompt).toContain("Bash:npm install failed")
    expect(prompt).toContain("2 times")
    expect(prompt).toContain("Phase 1")
  })

  test("includes blocker suggestion for strikes >= 3", () => {
    // #when
    const prompt = generateErrorRecordingPrompt("Bash:error", 3, 2)

    // #then
    expect(prompt).toContain("Consider adding to ## Blockers")
  })

  test("omits blocker suggestion for strikes < 3", () => {
    // #when
    const prompt = generateErrorRecordingPrompt("Bash:error", 2, 1)

    // #then
    expect(prompt).not.toContain("Blockers")
  })

  test("handles null phase", () => {
    // #when
    const prompt = generateErrorRecordingPrompt("Error", 2, null)

    // #then
    expect(prompt).toContain("Current phase")
  })
})

describe("generateBlockerPrompt", () => {
  test("includes issue and phase info", () => {
    // #when
    const prompt = generateBlockerPrompt("Missing API key", 2)

    // #then
    expect(prompt).toContain("Missing API key")
    expect(prompt).toContain("| 2 |")
    expect(prompt).toContain("<blocker-detected>")
  })

  test("handles null phase", () => {
    // #when
    const prompt = generateBlockerPrompt("Issue", null)

    // #then
    expect(prompt).toContain("| ? |")
  })

  test("truncates long issue text", () => {
    // #given
    const longIssue = "A".repeat(100)

    // #when
    const prompt = generateBlockerPrompt(longIssue, 1)

    // #then
    expect(prompt).toContain("A".repeat(40))
    expect(prompt).not.toContain("A".repeat(50))
  })
})
// #endregion

// #region File System Functions
describe("File System Functions", () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = createTempDir()
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
    // Clean up caches - use a non-existent plan to trigger cleanup
    cleanupSession(tmpDir, "test-plan")
  })

  describe("getPlanDir", () => {
    test("generates correct path with default config", () => {
      // #when
      const dir = getPlanDir("/project", "my-plan")

      // #then
      expect(dir).toBe("/project/.sisyphus/plans/my-plan")
    })

    test("generates correct path with custom directory", () => {
      // #when
      const dir = getPlanDir("/project", "my-plan", {
        enabled: true,
        directory: "custom-plans",
        two_action_rule: true,
        three_strike_protocol: true,
        auto_reread: true,
        stop_verification: true,
        reread_trigger_tools: [],
        action_count_tools: [],
        auto_from_multi_plan: true,
      })

      // #then
      expect(dir).toBe("/project/.sisyphus/custom-plans/my-plan")
    })
  })

  describe("loadState / saveState", () => {
    test("saves and loads state correctly", async () => {
      // #given
      const state: PlanningState = {
        planName: "test-plan",
        actionCount: 3,
        lastFindingsMtime: 12345,
        errorStrikes: { "Bash:error": 2 },
        activatedAt: "2024-01-01T00:00:00Z",
        lastActivityAt: "2024-01-01T01:00:00Z",
      }

      // #when
      await saveState(tmpDir, state)
      const loaded = await loadState(tmpDir, "test-plan")

      // #then
      expect(loaded).not.toBeNull()
      expect(loaded!.planName).toBe("test-plan")
      expect(loaded!.actionCount).toBe(3)
      expect(loaded!.errorStrikes["Bash:error"]).toBe(2)
    })

    test("returns null for non-existent state", async () => {
      // #when
      const loaded = await loadState(tmpDir, "non-existent")

      // #then
      expect(loaded).toBeNull()
    })

    test("updates lastActivityAt on save", async () => {
      // #given
      const state: PlanningState = {
        planName: "test-plan",
        actionCount: 0,
        lastFindingsMtime: 0,
        errorStrikes: {},
        activatedAt: "2024-01-01T00:00:00Z",
        lastActivityAt: "2024-01-01T00:00:00Z",
      }

      // #when
      await saveState(tmpDir, state)
      const loaded = await loadState(tmpDir, "test-plan")

      // #then
      expect(loaded!.lastActivityAt).not.toBe("2024-01-01T00:00:00Z")
    })
  })

  describe("wasFindingsModified", () => {
    test("detects modification when mtime > lastMtime", async () => {
      // #given
      const planDir = path.join(tmpDir, ".sisyphus", "plans", "test-plan")
      fs.mkdirSync(planDir, { recursive: true })
      const findingsPath = path.join(planDir, "findings.md")
      fs.writeFileSync(findingsPath, "# Findings")

      const stat = fs.statSync(findingsPath)
      const oldMtime = stat.mtimeMs - 1000

      // #when
      const result = await wasFindingsModified(tmpDir, "test-plan", oldMtime)

      // #then
      expect(result.modified).toBe(true)
      expect(result.newMtime).toBeGreaterThan(oldMtime)
    })

    test("returns false when file not modified", async () => {
      // #given
      const planDir = path.join(tmpDir, ".sisyphus", "plans", "test-plan")
      fs.mkdirSync(planDir, { recursive: true })
      const findingsPath = path.join(planDir, "findings.md")
      fs.writeFileSync(findingsPath, "# Findings")

      const stat = fs.statSync(findingsPath)
      const futureMtime = stat.mtimeMs + 10000

      // #when
      const result = await wasFindingsModified(tmpDir, "test-plan", futureMtime)

      // #then
      expect(result.modified).toBe(false)
    })

    test("handles missing file gracefully", async () => {
      // #when
      const result = await wasFindingsModified(tmpDir, "non-existent", 0)

      // #then
      expect(result.modified).toBe(false)
    })
  })

  describe("readTaskPlan / writeTaskPlan", () => {
    test("reads existing file", async () => {
      // #given
      const planDir = path.join(tmpDir, ".sisyphus", "plans", "test-plan")
      fs.mkdirSync(planDir, { recursive: true })
      fs.writeFileSync(path.join(planDir, "task_plan.md"), "# Task Plan Content")

      // #when
      const content = await readTaskPlan(tmpDir, "test-plan")

      // #then
      expect(content).toBe("# Task Plan Content")
    })

    test("returns null for missing file", async () => {
      // #when
      const content = await readTaskPlan(tmpDir, "non-existent")

      // #then
      expect(content).toBeNull()
    })

    test("writes content correctly", async () => {
      // #given
      const planDir = path.join(tmpDir, ".sisyphus", "plans", "test-plan")
      fs.mkdirSync(planDir, { recursive: true })

      // #when
      await writeTaskPlan(tmpDir, "test-plan", "# New Content")

      // #then
      const content = fs.readFileSync(path.join(planDir, "task_plan.md"), "utf-8")
      expect(content).toBe("# New Content")
    })
  })

  describe("detectActivePlan", () => {
    test("finds most recently modified plan", async () => {
      // #given
      const plansDir = path.join(tmpDir, ".sisyphus", "plans")
      const plan1Dir = path.join(plansDir, "plan-1")
      const plan2Dir = path.join(plansDir, "plan-2")

      fs.mkdirSync(plan1Dir, { recursive: true })
      fs.mkdirSync(plan2Dir, { recursive: true })

      // Create state files with different mtimes
      fs.writeFileSync(path.join(plan1Dir, ".planning-state.json"), "{}")
      await new Promise((r) => setTimeout(r, 10))
      fs.writeFileSync(path.join(plan2Dir, ".planning-state.json"), "{}")

      // #when
      const active = await detectActivePlan(tmpDir)

      // #then
      expect(active).toBe("plan-2")
    })

    test("returns null when no plans exist", async () => {
      // #when
      const active = await detectActivePlan(tmpDir)

      // #then
      expect(active).toBeNull()
    })

    test("ignores non-directory entries", async () => {
      // #given
      const plansDir = path.join(tmpDir, ".sisyphus", "plans")
      fs.mkdirSync(plansDir, { recursive: true })
      fs.writeFileSync(path.join(plansDir, "not-a-plan.txt"), "file")

      const planDir = path.join(plansDir, "real-plan")
      fs.mkdirSync(planDir)
      fs.writeFileSync(path.join(planDir, ".planning-state.json"), "{}")

      // #when
      const active = await detectActivePlan(tmpDir)

      // #then
      expect(active).toBe("real-plan")
    })
  })

  describe("initializePlan", () => {
    test("creates plan directory with all required files and state", async () => {
      // #when
      const result = await initializePlan(tmpDir, "test-plan", "Implement auth")

      // #then - all files exist
      expect(fs.existsSync(result.taskPlanPath)).toBe(true)
      expect(fs.existsSync(result.findingsPath)).toBe(true)
      expect(fs.existsSync(result.progressPath)).toBe(true)

      // #then - state file exists with correct initial values
      const statePath = path.join(tmpDir, ".sisyphus", "plans", "test-plan", ".planning-state.json")
      const state = JSON.parse(fs.readFileSync(statePath, "utf-8"))
      expect(state.planName).toBe("test-plan")
      expect(state.actionCount).toBe(0)
      expect(state.errorStrikes).toEqual({})

      // #then - task_plan.md has correct structure
      const taskPlan = fs.readFileSync(result.taskPlanPath, "utf-8")
      expect(taskPlan).toContain("# Task Plan: test-plan")
      expect(taskPlan).toContain("**Goal**: Implement auth")
      expect(taskPlan).toContain("## Phases")
      expect(taskPlan).toContain("## Errors")
      expect(taskPlan).toContain("## Blockers")

      // #then - other files have correct headers
      expect(fs.readFileSync(result.findingsPath, "utf-8")).toContain("# Findings: test-plan")
      expect(fs.readFileSync(result.progressPath, "utf-8")).toContain("# Progress: test-plan")
    })

    test("does not overwrite existing plan files or state", async () => {
      // #given
      await initializePlan(tmpDir, "safe-plan", "Original goal")

      const planDir = path.join(tmpDir, ".sisyphus", "plans", "safe-plan")
      const taskPlanPath = path.join(planDir, "task_plan.md")
      const findingsPath = path.join(planDir, "findings.md")
      const progressPath = path.join(planDir, "progress.md")

      fs.writeFileSync(taskPlanPath, "# Custom Task Plan\n\n> **Goal**: Custom goal\n")
      fs.writeFileSync(findingsPath, "# Custom Findings\n")
      fs.writeFileSync(progressPath, "# Custom Progress\n")

      const stateBefore = (await loadState(tmpDir, "safe-plan")) as PlanningState
      stateBefore.actionCount = 7
      stateBefore.errorStrikes = { "Bash:Connection refused": 2 }
      await saveState(tmpDir, stateBefore)

      // #when
      await initializePlan(tmpDir, "safe-plan", "New goal")

      // #then
      const taskPlanAfter = fs.readFileSync(taskPlanPath, "utf-8")
      expect(taskPlanAfter).toContain("# Custom Task Plan")
      expect(taskPlanAfter).not.toContain("**Goal**: New goal")

      expect(fs.readFileSync(findingsPath, "utf-8")).toContain("# Custom Findings")
      expect(fs.readFileSync(progressPath, "utf-8")).toContain("# Custom Progress")

      const stateAfter = (await loadState(tmpDir, "safe-plan")) as PlanningState
      expect(stateAfter.actionCount).toBe(7)
      expect(stateAfter.errorStrikes).toEqual({ "Bash:Connection refused": 2 })
    })
  })

  describe("detectPhaseCompletion", () => {
    test("first call initializes cache and returns empty", () => {
      // #given
      const phases = [
        { id: 1, name: "Phase 1", status: "complete" as PhaseStatus },
        { id: 2, name: "Phase 2", status: "pending" as PhaseStatus },
      ]

      // #when - first call
      const completed = detectPhaseCompletion(tmpDir, "detect-test", phases)

      // #then
      expect(completed).toHaveLength(0)
    })

    test("subsequent call detects newly completed phases", () => {
      // #given
      const initialPhases = [
        { id: 1, name: "Phase 1", status: "in_progress" as PhaseStatus },
        { id: 2, name: "Phase 2", status: "pending" as PhaseStatus },
      ]

      // Initialize cache
      detectPhaseCompletion(tmpDir, "detect-test-2", initialPhases)

      const updatedPhases = [
        { id: 1, name: "Phase 1", status: "complete" as PhaseStatus },
        { id: 2, name: "Phase 2", status: "pending" as PhaseStatus },
      ]

      // #when
      const completed = detectPhaseCompletion(tmpDir, "detect-test-2", updatedPhases)

      // #then
      expect(completed).toHaveLength(1)
      expect(completed[0]).toEqual({ id: 1, name: "Phase 1" })
    })

    test("handles multiple phase status transitions", () => {
      // #given
      const initialPhases = [
        { id: 1, name: "Phase 1", status: "in_progress" as PhaseStatus },
        { id: 2, name: "Phase 2", status: "in_progress" as PhaseStatus },
      ]

      detectPhaseCompletion(tmpDir, "detect-test-3", initialPhases)

      const updatedPhases = [
        { id: 1, name: "Phase 1", status: "complete" as PhaseStatus },
        { id: 2, name: "Phase 2", status: "complete" as PhaseStatus },
      ]

      // #when
      const completed = detectPhaseCompletion(tmpDir, "detect-test-3", updatedPhases)

      // #then
      expect(completed).toHaveLength(2)
    })
  })

  describe("isErrorRecorded", () => {
    test("returns true when error in Errors section", async () => {
      // #given
      const planDir = path.join(tmpDir, ".sisyphus", "plans", "error-test")
      fs.mkdirSync(planDir, { recursive: true })
      fs.writeFileSync(
        path.join(planDir, "task_plan.md"),
        `# Task Plan

## Errors

| # | Error | Phase | Attempts |
|---|-------|-------|----------|
| 1 | Bash:npm install failed | 2 | 3 |
`
      )

      // #when
      const recorded = await isErrorRecorded(tmpDir, "error-test", "Bash:npm install failed")

      // #then
      expect(recorded).toBe(true)
    })

    test("returns false when error not found", async () => {
      // #given
      const planDir = path.join(tmpDir, ".sisyphus", "plans", "error-test-2")
      fs.mkdirSync(planDir, { recursive: true })
      fs.writeFileSync(
        path.join(planDir, "task_plan.md"),
        `# Task Plan

## Errors

| # | Error |
|---|-------|
| - | (none yet) |
`
      )

      // #when
      const recorded = await isErrorRecorded(tmpDir, "error-test-2", "Bash:npm install failed")

      // #then
      expect(recorded).toBe(false)
    })

    test("returns false when task plan missing", async () => {
      // #when
      const recorded = await isErrorRecorded(tmpDir, "non-existent", "error")

      // #then
      expect(recorded).toBe(false)
    })
  })

  describe("cleanupSession", () => {
    test("clears caches", async () => {
      // #given - create and load state to populate cache
      const state: PlanningState = {
        planName: "cleanup-test",
        actionCount: 5,
        lastFindingsMtime: 0,
        errorStrikes: {},
        activatedAt: new Date().toISOString(),
        lastActivityAt: new Date().toISOString(),
      }
      await saveState(tmpDir, state)
      await loadState(tmpDir, "cleanup-test")

      // #when
      cleanupSession(tmpDir, "cleanup-test")

      // Verify cache is cleared by checking that next load reads from disk
      // (We can't directly test internal cache, but can verify behavior)
      const reloaded = await loadState(tmpDir, "cleanup-test")

      // #then - should still work (reads from disk)
      expect(reloaded).not.toBeNull()
    })
  })
})
// #endregion
