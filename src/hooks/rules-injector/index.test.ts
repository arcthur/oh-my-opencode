import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { contextBudgetArbiter } from "../../../src/features/context-view"
import { createRulesInjectorHook } from "../../../src/hooks/rules-injector"

describe("rules-injector budget integration", () => {
  const TEST_DIR = join(tmpdir(), `rules-injector-budget-test-${Date.now()}`)
  const SOURCE_FILE = join(TEST_DIR, "src", "a.ts")
  const COPILOT_INSTRUCTIONS_FILE = join(TEST_DIR, ".github", "copilot-instructions.md")

  beforeEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true })
    }
    mkdirSync(join(TEST_DIR, ".git"), { recursive: true })
    mkdirSync(join(TEST_DIR, "src"), { recursive: true })
    mkdirSync(join(TEST_DIR, ".github"), { recursive: true })
    writeFileSync(SOURCE_FILE, "export const a = 1\n")
    writeFileSync(
      COPILOT_INSTRUCTIONS_FILE,
      "Apply coding standards\nDo not skip typecheck."
    )

    contextBudgetArbiter.resetForTesting()
  })

  afterEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true })
    }
  })

  test("injects rule content when budget allows", async () => {
    // #given
    const sessionID = `rules-budget-allow-${Date.now()}-${Math.random()}`
    const hook = createRulesInjectorHook({
      directory: TEST_DIR,
      client: {},
    })
    const output = {
      title: SOURCE_FILE,
      output: "base output",
      metadata: {},
    }

    // #when
    await hook["tool.execute.after"](
      { tool: "read", sessionID, callID: "c1" },
      output
    )

    // #then
    expect(output.output).toContain("[Pointer Card]")
    expect(output.output).toContain("Path:")
    expect(output.output).toContain("Next: Read")
    expect(output.output).toContain("Apply coding standards")
    expect(output.output).not.toContain("Do not skip typecheck.")
  })

  test("falls back to minimal rule pointer when budget drops the full card", async () => {
    // #given
    const sessionID = `rules-budget-drop-${Date.now()}-${Math.random()}`
    contextBudgetArbiter.setBudgetConfig({
      total_budget: 2000,
      source_limits: {
        "rules-injector": 0,
      },
      overflow_strategy: "drop-low-priority",
    })
    const hook = createRulesInjectorHook({
      directory: TEST_DIR,
      client: {},
    })
    const output = {
      title: SOURCE_FILE,
      output: "base output",
      metadata: {},
    }

    // #when
    await hook["tool.execute.after"](
      { tool: "read", sessionID, callID: "c2" },
      output
    )

    // #then
    expect(output.output).toContain("base output")
    expect(output.output).toContain("[Pointer]")
    expect(output.output).toContain("Path:")
    expect(output.output).toContain("Next: Read")
    expect(output.output).not.toContain("[Pointer Card]")
  })
})
