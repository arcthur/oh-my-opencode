import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import {
  parsePlanTodos,
  getStrikeGuidance,
  generateReflectionPrompt,
  generateErrorRecordingPrompt,
  generateBlockerPrompt,
  getPlanDir,
  getExecutionPlanPath,
  getLedgerPath,
  readPlan,
  writePlan,
  readLedger,
  writeLedger,
  detectActivePlan,
  initializePlan,
  detectTodoCompletion,
  isErrorRecorded,
  cleanupSession,
  getCurrentTodo,
  areAllTodosComplete,
  getIncompleteTodos,
} from "./manager"
import { createWorkStateManager } from "../work-state"
import { DEFAULT_PLANNING_CONFIG } from "./types"

function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "planning-with-files-"))
}

describe("planning-with-files manager", () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = createTempDir()
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
    cleanupSession(tmpDir, "plan-a")
    cleanupSession(tmpDir, "plan-b")
    cleanupSession(tmpDir, "detect")
  })

  describe("parsePlanTodos", () => {
    test("parses numbered TODO checkboxes under TODO section", () => {
      const content = `# Plan: demo

## TODOs

- [ ] 1. Discovery
- [x] 2. Implementation

## Notes

- ignore`

      const todos = parsePlanTodos(content)

      expect(todos).toHaveLength(2)
      expect(todos[0]).toEqual({ id: 1, title: "Discovery", status: "pending" })
      expect(todos[1]).toEqual({ id: 2, title: "Implementation", status: "complete" })
    })

    test("returns empty for invalid format", () => {
      const todos = parsePlanTodos("# Plan\n\n- [ ] Not numbered")
      expect(todos).toEqual([])
    })
  })

  describe("prompt helpers", () => {
    test("strike guidance reflects protocol stage", () => {
      expect(getStrikeGuidance(1, false)).toContain("Strike 1/3")
      expect(getStrikeGuidance(2, true)).toContain("REQUIRED")
      expect(getStrikeGuidance(3, true)).toContain("Reassess")
      expect(getStrikeGuidance(4, true)).toContain("ESCALATE")
    })

    test("reflection prompt includes completed todo and pending todos", () => {
      const prompt = generateReflectionPrompt(
        { id: 1, name: "Discovery" },
        [
          { id: 1, title: "Discovery", status: "complete" },
          { id: 2, title: "Implementation", status: "pending" },
        ]
      )

      expect(prompt).toContain("TODO 1 Complete: Discovery")
      expect(prompt).toContain("TODO 2: Implementation")
      expect(prompt).toContain("<phase-reflection>")
    })

    test("error recording prompt references ledger and todo", () => {
      const prompt = generateErrorRecordingPrompt("Bash:npm install failed", 2, 1)
      expect(prompt).toContain("ledger.yaml")
      expect(prompt).toContain("TODO 1")
      expect(prompt).toContain("2 times")
    })

    test("error recording prompt includes blocker suggestion at strike >= 3", () => {
      const prompt = generateErrorRecordingPrompt("Bash:error", 3, null)
      expect(prompt).toContain("blockers")
      expect(prompt).toContain("Current TODO")
    })

    test("blocker prompt includes issue and todo", () => {
      const prompt = generateBlockerPrompt("Missing API key", 2)
      expect(prompt).toContain("Missing API key")
      expect(prompt).toContain("todo: 2")
      expect(prompt).toContain("<blocker-detected>")
    })

    test("getCurrentTodo returns first pending todo", () => {
      const todoId = getCurrentTodo([
        { id: 1, title: "Done", status: "complete" },
        { id: 2, title: "Next", status: "pending" },
      ])
      expect(todoId).toBe(2)
    })
  })

  describe("path and io", () => {
    test("uses canonical plan directory and files", () => {
      const dir = getPlanDir(tmpDir, "demo", { ...DEFAULT_PLANNING_CONFIG, directory: "custom" })
      expect(dir).toBe(path.join(tmpDir, ".sisyphus", "plans", "demo"))
      expect(getExecutionPlanPath(tmpDir, "demo")).toBe(
        path.join(tmpDir, ".sisyphus", "plans", "demo", "plan.md")
      )
      expect(getLedgerPath(tmpDir, "demo")).toBe(
        path.join(tmpDir, ".sisyphus", "plans", "demo", "ledger.yaml")
      )
    })

    test("initializePlan creates canonical files", async () => {
      const result = await initializePlan(tmpDir, "demo", "Implement auth")

      expect(fs.existsSync(result.planPath)).toBe(true)
      expect(fs.existsSync(result.ledgerPath)).toBe(true)
      expect(fs.existsSync(result.findingsPath)).toBe(true)
      expect(fs.existsSync(result.progressPath)).toBe(true)
      expect(result.planPath.endsWith("/demo/plan.md") || result.planPath.endsWith("\\demo\\plan.md")).toBe(true)

      const plan = fs.readFileSync(result.planPath, "utf-8")
      expect(plan).toContain("# Plan: demo")
      expect(plan).toContain("## TODOs")

      const ledger = await readLedger(tmpDir, "demo")
      expect(ledger?.plan_id).toBe("demo")
      expect(Array.isArray(ledger?.errors)).toBe(true)
    })

    test("readPlan/writePlan operate on plan.md", async () => {
      await initializePlan(tmpDir, "demo", "Goal")

      await writePlan(tmpDir, "demo", "# Plan: demo\n\n## TODOs\n\n- [x] 1. Done\n")
      const content = await readPlan(tmpDir, "demo")

      expect(content).toContain("- [x] 1. Done")
    })

    test("writeLedger persists updates", async () => {
      await initializePlan(tmpDir, "demo", "Goal")
      const ledger = await readLedger(tmpDir, "demo")
      expect(ledger).not.toBeNull()

      await writeLedger(tmpDir, "demo", {
        schema_version: 1,
        plan_id: "demo",
        errors: [{ key: "Bash:Connection refused", strikes: 2 }],
        blockers: [],
        decisions: [],
        updated_at: new Date().toISOString(),
      })

      const updated = await readLedger(tmpDir, "demo")
      expect(updated?.errors[0]?.key).toBe("Bash:Connection refused")
    })
  })

  describe("active plan and completion", () => {
    test("detectActivePlan prefers work.yaml active plan", async () => {
      await initializePlan(tmpDir, "plan-a", "A")
      await new Promise((r) => setTimeout(r, 10))
      await initializePlan(tmpDir, "plan-b", "B")

      createWorkStateManager(tmpDir).initializePlan("plan-a", "session-1")

      const active = await detectActivePlan(tmpDir)
      expect(active).toBe("plan-a")
    })

    test("detectActivePlan falls back to latest modified plan", async () => {
      await initializePlan(tmpDir, "plan-a", "A")
      await new Promise((r) => setTimeout(r, 10))
      await initializePlan(tmpDir, "plan-b", "B")

      const active = await detectActivePlan(tmpDir)
      expect(active).toBe("plan-b")
    })

    test("detectTodoCompletion detects pending->complete transition", () => {
      const first = detectTodoCompletion(tmpDir, "detect", [
        { id: 1, title: "Discovery", status: "pending" },
        { id: 2, title: "Implementation", status: "pending" },
      ])
      expect(first).toEqual([])

      const second = detectTodoCompletion(tmpDir, "detect", [
        { id: 1, title: "Discovery", status: "complete" },
        { id: 2, title: "Implementation", status: "pending" },
      ])
      expect(second).toEqual([{ id: 1, name: "Discovery" }])
    })

    test("cleanupSession resets todo completion cache", () => {
      detectTodoCompletion(tmpDir, "detect", [{ id: 1, title: "T1", status: "pending" }])
      cleanupSession(tmpDir, "detect")

      const completed = detectTodoCompletion(tmpDir, "detect", [{ id: 1, title: "T1", status: "complete" }])
      expect(completed).toEqual([])
    })
  })

  describe("ledger-backed checks", () => {
    test("isErrorRecorded reads from ledger errors", async () => {
      await initializePlan(tmpDir, "err-plan", "Goal")
      await writeLedger(tmpDir, "err-plan", {
        schema_version: 1,
        plan_id: "err-plan",
        errors: [{ key: "Bash:npm install failed", strikes: 2 }],
        blockers: [],
        decisions: [],
        updated_at: new Date().toISOString(),
      })

      const recorded = await isErrorRecorded(tmpDir, "err-plan", "Bash:npm install failed")
      expect(recorded).toBe(true)
    })

    test("isErrorRecorded returns false when plan ledger missing", async () => {
      const recorded = await isErrorRecorded(tmpDir, "missing", "Bash:error")
      expect(recorded).toBe(false)
    })
  })

  describe("todo completeness helpers", () => {
    test("areAllTodosComplete and getIncompleteTodos read from plan.md", async () => {
      await initializePlan(tmpDir, "done-plan", "Goal")

      await writePlan(
        tmpDir,
        "done-plan",
        "# Plan: done-plan\n\n## TODOs\n\n- [x] 1. A\n- [ ] 2. B\n"
      )

      expect(await areAllTodosComplete(tmpDir, "done-plan")).toBe(false)
      expect(await getIncompleteTodos(tmpDir, "done-plan")).toEqual(["TODO 2: B (pending)"])

      await writePlan(
        tmpDir,
        "done-plan",
        "# Plan: done-plan\n\n## TODOs\n\n- [x] 1. A\n- [x] 2. B\n"
      )
      expect(await areAllTodosComplete(tmpDir, "done-plan")).toBe(true)
      expect(await getIncompleteTodos(tmpDir, "done-plan")).toEqual([])
    })
  })
})
