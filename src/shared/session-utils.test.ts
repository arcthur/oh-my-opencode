import { beforeEach, describe, expect, test } from "bun:test"
import { _resetForTesting, updateSessionAgent } from "../features/claude-code-session-state"
import {
  getExecutionCaller,
  getOrchestratorCaller,
  isCallerOrchestrator,
  resolveExecutionOwnership,
} from "./session-utils"

describe("session-utils execution ownership", () => {
  beforeEach(() => {
    _resetForTesting()
  })

  test("treats workflow-automator as the only execution owner caller", () => {
    // #given
    updateSessionAgent("ses-workflow-automator", "workflow-automator")
    updateSessionAgent("ses-orchestrator", "orchestrator")

    // #when / #then
    expect(getExecutionCaller("ses-workflow-automator")).toBe("workflow-automator")
    expect(getExecutionCaller("ses-orchestrator")).toBeNull()
    expect(resolveExecutionOwnership("ses-workflow-automator", "workflow-automator")).toBe("matched")
    expect(resolveExecutionOwnership("ses-orchestrator", "workflow-automator")).toBe("mismatched")
  })

  test("keeps orchestrator detection broad for non-execution hooks", () => {
    // #given
    updateSessionAgent("ses-workflow-automator", "workflow-automator")
    updateSessionAgent("ses-orchestrator", "orchestrator")

    // #when / #then
    expect(getOrchestratorCaller("ses-workflow-automator")).toBe("workflow-automator")
    expect(getOrchestratorCaller("ses-orchestrator")).toBe("orchestrator")
    expect(isCallerOrchestrator("ses-workflow-automator")).toBe(true)
    expect(isCallerOrchestrator("ses-orchestrator")).toBe(true)
  })

  test("returns unknown ownership when caller metadata is absent", () => {
    // #given / #when / #then
    expect(resolveExecutionOwnership(undefined, "workflow-automator")).toBe("unknown")
    expect(resolveExecutionOwnership("ses-missing", "workflow-automator")).toBe("unknown")
  })
})
