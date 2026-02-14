import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { randomUUID } from "node:crypto"
import { contextBudgetArbiter } from "../../../src/features/context-view"

const truncateMock = mock(async (_sessionID: string, content: string) => ({
  result: content,
  truncated: false,
}))
const loadInjectedPathsMock = mock(() => new Set<string>())
const saveInjectedPathsMock = mock(() => {})
const clearInjectedPathsMock = mock(() => {})

mock.module("../../../src/shared/dynamic-truncator", () => ({
  createDynamicTruncator: () => ({
    truncate: truncateMock,
  }),
}))

mock.module("../../../src/hooks/directory-agents-injector/storage", () => ({
  loadInjectedPaths: loadInjectedPathsMock,
  saveInjectedPaths: saveInjectedPathsMock,
  clearInjectedPaths: clearInjectedPathsMock,
}))

const { createDirectoryAgentsInjectorHook } = require("../../../src/hooks/directory-agents-injector/index")

describe("directory-agents-injector budget integration", () => {
  let testDir: string

  beforeEach(() => {
    contextBudgetArbiter.resetForTesting()
    truncateMock.mockClear()
    loadInjectedPathsMock.mockClear()
    saveInjectedPathsMock.mockClear()
    clearInjectedPathsMock.mockClear()

    testDir = join(tmpdir(), `dir-agents-test-${randomUUID()}`)
    mkdirSync(testDir, { recursive: true })
  })

  afterEach(() => {
    contextBudgetArbiter.resetForTesting()
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true })
    }
  })

  test("injects AGENTS context when budget allows", async () => {
    // #given
    const srcDir = join(testDir, "src")
    mkdirSync(srcDir, { recursive: true })
    const targetFile = join(srcDir, "index.ts")
    writeFileSync(targetFile, "console.log('x')\n")
    writeFileSync(
      join(srcDir, "AGENTS.md"),
      "Use strict typing.\nNever bypass validation steps."
    )
    const hook = createDirectoryAgentsInjectorHook({
      directory: testDir,
      client: {},
    })

    const output = { title: targetFile, output: "read result", metadata: {} }

    // #when
    await hook["tool.execute.after"](
      { tool: "read", sessionID: "s1", callID: "c1" },
      output
    )

    // #then
    expect(output.output).toContain("[Pointer Card]")
    expect(output.output).toContain("Path:")
    expect(output.output).toContain("Next: Read")
    expect(output.output).toContain("Use strict typing.")
    expect(output.output).not.toContain("Never bypass validation steps.")
  })

  test("falls back to minimal AGENTS pointer when budget drops the full card", async () => {
    // #given
    contextBudgetArbiter.setBudgetConfig({
      total_budget: 1,
      reserved_budget: 0,
      overflow_strategy: "drop-low-priority",
    })
    const srcDir = join(testDir, "src")
    mkdirSync(srcDir, { recursive: true })
    const targetFile = join(srcDir, "index.ts")
    writeFileSync(targetFile, "console.log('x')\n")
    writeFileSync(join(srcDir, "AGENTS.md"), "A very long rule block for budget rejection.")
    const hook = createDirectoryAgentsInjectorHook({
      directory: testDir,
      client: {},
    })

    const output = { title: targetFile, output: "read result", metadata: {} }

    // #when
    await hook["tool.execute.after"](
      { tool: "read", sessionID: "s1", callID: "c1" },
      output
    )

    // #then
    expect(output.output).toContain("read result")
    expect(output.output).toContain("[Pointer]")
    expect(output.output).toContain("Path:")
    expect(output.output).toContain("Next: Read")
    expect(output.output).not.toContain("[Pointer Card]")
  })
})
