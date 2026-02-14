import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { contextBudgetArbiter } from "../../../src/features/context-view"
import { injectHookMessage } from "../../../src/features/hook-message-injector/injector"
import {
  resetOpenCodeStorageDirForTesting,
  setOpenCodeStorageDirForTesting,
} from "../../../src/features/hook-message-injector/constants"

describe("injectHookMessage budget integration", () => {
  let storageDir: string

  beforeEach(() => {
    contextBudgetArbiter.resetForTesting()
    storageDir = mkdtempSync(join(tmpdir(), "omo-hook-message-"))
    setOpenCodeStorageDirForTesting(storageDir)
  })

  afterEach(() => {
    resetOpenCodeStorageDirForTesting()
    if (existsSync(storageDir)) {
      rmSync(storageDir, { recursive: true, force: true })
    }
  })

  test("drops synthetic message when budget is exhausted", () => {
    // #given
    contextBudgetArbiter.setBudgetConfig({
      total_budget: 1,
      reserved_budget: 0,
      overflow_strategy: "drop-low-priority",
    })

    // #when
    const success = injectHookMessage(
      "session-1",
      "very long synthetic content that should not fit budget",
      { agent: "general" }
    )

    // #then
    expect(success).toBe(false)
  })

  test("injects synthetic message when budget allows", () => {
    // #given
    contextBudgetArbiter.setBudgetConfig({
      total_budget: 2000,
      reserved_budget: 400,
      overflow_strategy: "drop-low-priority",
    })

    // #when
    const success = injectHookMessage(
      "session-1",
      "short content",
      { agent: "general" }
    )

    // #then
    expect(success).toBe(true)
  })
})
