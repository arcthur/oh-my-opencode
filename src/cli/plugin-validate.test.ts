import { describe, test, expect, spyOn, afterEach } from "bun:test"
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { validatePlugins } from "./plugin-validate"

const tempDirs: string[] = []

function createTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), `${prefix}-`))
  tempDirs.push(dir)
  return dir
}

function createPlugin(root: string, name: string): void {
  mkdirSync(join(root, ".claude-plugin"), { recursive: true })
  writeFileSync(
    join(root, ".claude-plugin", "plugin.json"),
    JSON.stringify({ name, version: "1.0.0" })
  )
}

afterEach(() => {
  for (const dir of tempDirs.splice(0, tempDirs.length)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe("validatePlugins command", () => {
  test("returns 0 for a valid plugin path", async () => {
    // #given
    const root = createTempDir("cli-plugin-valid")
    createPlugin(root, "cli-valid")

    // #when
    const exitCode = await validatePlugins({ path: root })

    // #then
    expect(exitCode).toBe(0)
  })

  test("returns 1 for an invalid plugin path", async () => {
    // #given
    const root = createTempDir("cli-plugin-invalid")

    // #when
    const exitCode = await validatePlugins({ path: root })

    // #then
    expect(exitCode).toBe(1)
  })

  test("outputs stable JSON schema with --json", async () => {
    // #given
    const root = createTempDir("cli-plugin-json")
    createPlugin(root, "cli-json")
    const logSpy = spyOn(console, "log").mockImplementation(() => {})

    try {
      // #when
      const exitCode = await validatePlugins({ path: root, json: true })

      // #then
      expect(exitCode).toBe(0)
      const output = logSpy.mock.calls
        .map((call) => String(call[0] ?? ""))
        .find((line) => line.trim().startsWith("{"))
      expect(output).toBeDefined()
      if (!output) {
        throw new Error("Expected JSON output from validatePlugins --json")
      }
      const parsed = JSON.parse(output) as {
        summary: Record<string, unknown>
        reports: unknown[]
      }

      expect(parsed.summary).toBeDefined()
      expect(Array.isArray(parsed.reports)).toBe(true)
    } finally {
      logSpy.mockRestore()
    }
  })

  test("treats warnings as failures with --strict", async () => {
    // #given
    const root = createTempDir("cli-plugin-strict")
    createPlugin(root, "cli-strict")
    mkdirSync(join(root, "commands"), { recursive: true })
    writeFileSync(
      join(root, "commands", "bad.md"),
      "---\ndescription: [broken\n---\ncommand body"
    )

    // #when
    const nonStrictExitCode = await validatePlugins({ path: root, strict: false })
    const strictExitCode = await validatePlugins({ path: root, strict: true })

    // #then
    expect(nonStrictExitCode).toBe(0)
    expect(strictExitCode).toBe(1)
  })
})
