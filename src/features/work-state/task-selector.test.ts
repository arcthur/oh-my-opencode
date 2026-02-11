import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { createWorkStateManager } from "./manager"
import { resolveActiveTaskSelector } from "./task-selector"

describe("work-state/task-selector", () => {
  let workspace: string

  beforeEach(() => {
    workspace = join(tmpdir(), `work-state-task-selector-${Date.now()}-${Math.random().toString(16).slice(2)}`)
    mkdirSync(workspace, { recursive: true })
  })

  afterEach(() => {
    if (existsSync(workspace)) {
      rmSync(workspace, { recursive: true, force: true })
    }
  })

  test("resolves to plan scope for sessions in work.yaml", () => {
    // #given
    createWorkStateManager(workspace).initializePlan("plan-a", "ses-1", undefined)

    // #when
    const resolved = resolveActiveTaskSelector(workspace, "ses-1")

    // #then
    expect(resolved.selector).toEqual({ scope: "plan", container_id: "plan-a" })
  })

  test("falls back to session scope when no active plan binding exists", () => {
    // #given
    createWorkStateManager(workspace).initializePlan("plan-a", "ses-1", undefined)

    // #when
    const resolved = resolveActiveTaskSelector(workspace, "ses-2")

    // #then
    expect(resolved.selector).toEqual({ scope: "session", container_id: "ses-2" })
  })
})
