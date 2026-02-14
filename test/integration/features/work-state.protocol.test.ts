import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createWorkStateManager } from "../../../src/features/work-state/manager"

describe("work-state protocol integration", () => {
  let workspace: string

  beforeEach(() => {
    workspace = join(tmpdir(), `work-state-protocol-${Date.now()}-${Math.random().toString(16).slice(2)}`)
    mkdirSync(workspace, { recursive: true })
  })

  afterEach(() => {
    if (existsSync(workspace)) {
      rmSync(workspace, { recursive: true, force: true })
    }
  })

  test("3-strike flow requires recording on strike 2 and clears after markErrorRecorded", () => {
    // #given
    const manager = createWorkStateManager(workspace)
    manager.initializePlan("plan-protocol", "session-1", undefined)

    // #when
    const first = manager.recordError("Write:EACCES", "permission denied")
    const second = manager.recordError("Write:EACCES", "permission denied again")
    manager.markErrorRecorded("Write:EACCES")

    // #then
    expect(first).toEqual({ strikes: 1, requiresRecording: false })
    expect(second).toEqual({ strikes: 2, requiresRecording: true })
    expect(manager.isErrorRecorded("Write:EACCES")).toBe(true)
    expect(manager.getStrikeGuidance(2, true)).toContain("MUST record this error")
    expect(manager.generateErrorRecordingPrompt("Write:EACCES", 2)).toContain("Record Error Before Continuing")
  })

  test("blocker lifecycle deduplicates unresolved blocker and supports resolve", () => {
    // #given
    const manager = createWorkStateManager(workspace)
    manager.initializePlan("plan-blocker", "session-1", undefined)
    const blockerText = "External API is down with 503"

    // #when
    manager.addBlocker(blockerText)
    manager.addBlocker(blockerText)
    const unresolvedBeforeResolve = manager.getUnresolvedBlockers()
    manager.resolveBlocker("External API is down", "API recovered")
    const unresolvedAfterResolve = manager.getUnresolvedBlockers()

    // #then
    expect(unresolvedBeforeResolve).toHaveLength(1)
    expect(unresolvedBeforeResolve[0]?.error_text).toContain("External API is down")
    expect(unresolvedAfterResolve).toHaveLength(0)
    expect(manager.generateBlockerPrompt("DB migration blocked")).toContain("Blocker Identified")
  })

  test("two-action counter reminds every second research op and resets after findings update", () => {
    // #given
    const manager = createWorkStateManager(workspace)
    manager.initializePlan("plan-two-action", "session-1", undefined)
    const findingsPath = join(
      workspace,
      ".orchestrator",
      "plans",
      "plan-two-action",
      "findings.md"
    )
    mkdirSync(join(workspace, ".orchestrator", "plans", "plan-two-action"), { recursive: true })
    writeFileSync(findingsPath, "# Findings\n", "utf-8")

    // #when
    const firstCount = manager.incrementResearchOps()
    const firstReminder = manager.shouldRemindTwoAction()
    const secondCount = manager.incrementResearchOps()
    const secondReminder = manager.shouldRemindTwoAction()
    const findingsCheck = manager.checkFindingsModified(findingsPath)
    manager.resetResearchOps()
    const reminderAfterReset = manager.shouldRemindTwoAction()

    // #then
    expect(firstCount).toBe(1)
    expect(firstReminder).toBe(false)
    expect(secondCount).toBe(2)
    expect(secondReminder).toBe(true)
    expect(findingsCheck.modified).toBe(true)
    expect(reminderAfterReset).toBe(false)
  })

  test("appendSessionId avoids duplicates while preserving original order", () => {
    // #given
    const manager = createWorkStateManager(workspace)
    manager.initializePlan("plan-sessions", "session-1", undefined)

    // #when
    manager.appendSessionId("session-2")
    manager.appendSessionId("session-2")
    const state = manager.getState()

    // #then
    expect(state?.session_ids).toEqual(["session-1", "session-2"])
  })

  test("persists work state to disk and reloads across manager instances", () => {
    // #given
    const managerA = createWorkStateManager(workspace)
    managerA.initializePlan("plan-persist", "session-1", undefined)

    // #when
    managerA.appendSessionId("session-2")
    managerA.recordError("Write:EACCES", "permission denied")
    managerA.markErrorRecorded("Write:EACCES")
    managerA.addBlocker("External API outage")

    const managerB = createWorkStateManager(workspace)
    const state = managerB.getState()

    // #then
    expect(state?.plan_id).toBe("plan-persist")
    expect(state?.session_ids).toEqual(["session-1", "session-2"])
    expect(state?.errors.some((e) => e.key === "Write:EACCES" && e.recorded === true)).toBe(true)
    expect(state?.blockers.some((b) => b.error_text.includes("External API outage") && b.resolved === false)).toBe(true)
  })
})
