import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import {
  detectActivePlan,
  getExecutionPlanPath,
  getLedgerPath,
  getPlanDir,
  initializePlan,
  isErrorRecorded,
  readLedger,
  readPlan,
  writeLedger,
  writePlan,
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
  })

  test("uses canonical plan directory and files", () => {
    // #given / #when
    const dir = getPlanDir(tmpDir, "demo", { ...DEFAULT_PLANNING_CONFIG, directory: "custom" })

    // #then
    expect(dir).toBe(path.join(tmpDir, ".sisyphus", "plans", "demo"))
    expect(getExecutionPlanPath(tmpDir, "demo")).toBe(path.join(tmpDir, ".sisyphus", "plans", "demo", "plan.md"))
    expect(getLedgerPath(tmpDir, "demo")).toBe(path.join(tmpDir, ".sisyphus", "plans", "demo", "ledger.yaml"))
  })

  test("initializePlan creates canonical files with Tasks section", async () => {
    // #given / #when
    const result = await initializePlan(tmpDir, "demo", "Implement auth")

    // #then
    expect(fs.existsSync(result.planPath)).toBe(true)
    expect(fs.existsSync(result.ledgerPath)).toBe(true)
    expect(fs.existsSync(result.findingsPath)).toBe(true)
    expect(fs.existsSync(result.progressPath)).toBe(true)
    expect(result.planPath.endsWith("/demo/plan.md") || result.planPath.endsWith("\\demo\\plan.md")).toBe(true)

    const plan = fs.readFileSync(result.planPath, "utf-8")
    expect(plan).toContain("# Plan: demo")
    expect(plan).toContain("## Tasks")

    const ledger = await readLedger(tmpDir, "demo")
    expect(ledger?.plan_id).toBe("demo")
    expect(Array.isArray(ledger?.errors)).toBe(true)
  })

  test("readPlan/writePlan operate on plan.md", async () => {
    // #given
    await initializePlan(tmpDir, "demo", "Goal")

    // #when
    await writePlan(tmpDir, "demo", "# Plan: demo\n\n## Tasks\n\n- 1. Done\n")
    const content = await readPlan(tmpDir, "demo")

    // #then
    expect(content).toContain("- 1. Done")
  })

  test("writeLedger persists updates", async () => {
    // #given
    await initializePlan(tmpDir, "demo", "Goal")
    const ledger = await readLedger(tmpDir, "demo")
    expect(ledger).not.toBeNull()

    // #when
    await writeLedger(tmpDir, "demo", {
      schema_version: 1,
      plan_id: "demo",
      errors: [{ key: "Bash:Connection refused", strikes: 2 }],
      blockers: [],
      decisions: [],
      updated_at: new Date().toISOString(),
    })

    // #then
    const updated = await readLedger(tmpDir, "demo")
    expect(updated?.errors[0]?.key).toBe("Bash:Connection refused")
  })

  test("detectActivePlan prefers work.yaml active plan", async () => {
    // #given
    await initializePlan(tmpDir, "plan-a", "A")
    await new Promise((r) => setTimeout(r, 10))
    await initializePlan(tmpDir, "plan-b", "B")
    createWorkStateManager(tmpDir).initializePlan("plan-a", "session-1", undefined)

    // #when
    const active = await detectActivePlan(tmpDir)

    // #then
    expect(active).toBe("plan-a")
  })

  test("detectActivePlan falls back to latest modified plan", async () => {
    // #given
    await initializePlan(tmpDir, "plan-a", "A")
    await new Promise((r) => setTimeout(r, 10))
    await initializePlan(tmpDir, "plan-b", "B")

    // #when
    const active = await detectActivePlan(tmpDir)

    // #then
    expect(active).toBe("plan-b")
  })

  test("isErrorRecorded reads from ledger errors", async () => {
    // #given
    await initializePlan(tmpDir, "err-plan", "Goal")
    await writeLedger(tmpDir, "err-plan", {
      schema_version: 1,
      plan_id: "err-plan",
      errors: [{ key: "Bash:npm install failed", strikes: 2 }],
      blockers: [],
      decisions: [],
      updated_at: new Date().toISOString(),
    })

    // #when / #then
    expect(await isErrorRecorded(tmpDir, "err-plan", "Bash:npm install failed")).toBe(true)
  })

  test("isErrorRecorded returns false when plan ledger missing", async () => {
    // #when / #then
    expect(await isErrorRecorded(tmpDir, "missing", "Bash:error")).toBe(false)
  })
})
