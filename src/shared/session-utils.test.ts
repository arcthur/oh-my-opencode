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

  test("treats atlas as the only execution owner caller", () => {
    // #given
    updateSessionAgent("ses-atlas", "atlas")
    updateSessionAgent("ses-sisyphus", "sisyphus")

    // #when / #then
    expect(getExecutionCaller("ses-atlas")).toBe("atlas")
    expect(getExecutionCaller("ses-sisyphus")).toBeNull()
    expect(resolveExecutionOwnership("ses-atlas", "atlas")).toBe("matched")
    expect(resolveExecutionOwnership("ses-sisyphus", "atlas")).toBe("mismatched")
  })

  test("keeps orchestrator detection broad for non-execution hooks", () => {
    // #given
    updateSessionAgent("ses-atlas", "atlas")
    updateSessionAgent("ses-sisyphus", "sisyphus")

    // #when / #then
    expect(getOrchestratorCaller("ses-atlas")).toBe("atlas")
    expect(getOrchestratorCaller("ses-sisyphus")).toBe("sisyphus")
    expect(isCallerOrchestrator("ses-atlas")).toBe(true)
    expect(isCallerOrchestrator("ses-sisyphus")).toBe(true)
  })

  test("returns unknown ownership when caller metadata is absent", () => {
    // #given / #when / #then
    expect(resolveExecutionOwnership(undefined, "atlas")).toBe("unknown")
    expect(resolveExecutionOwnership("ses-missing", "atlas")).toBe("unknown")
  })
})
