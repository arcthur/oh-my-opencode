import { describe, expect, test } from "bun:test"
import { join, resolve } from "node:path"

interface ValidationSummary {
  totalPlugins: number
  validPlugins: number
  skippedPlugins: number
  errorCount: number
  warningCount: number
}

interface ValidationReport {
  summary: ValidationSummary
}

async function runValidatePlugins(fixtureDir: string): Promise<{
  exitCode: number
  stdout: string
  stderr: string
}> {
  const repoRoot = resolve(import.meta.dir, "../..")
  const fixturePath = join(repoRoot, fixtureDir)
  const proc = Bun.spawn(
    [
      "bun",
      "run",
      "src/cli/index.ts",
      "validate-plugins",
      "--path",
      fixturePath,
      "--json",
    ],
    {
      cwd: repoRoot,
      stdout: "pipe",
      stderr: "pipe",
    }
  )

  const [exitCode, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ])

  return { exitCode, stdout, stderr }
}

describe("validate-plugins CLI e2e", () => {
  test("returns success for valid plugin fixture", async () => {
    // #when
    const result = await runValidatePlugins("test/fixtures/claude-plugins/valid-plugin")
    const report = JSON.parse(result.stdout) as ValidationReport

    // #then
    expect(result.exitCode).toBe(0)
    expect(result.stderr).toBe("")
    expect(report.summary.totalPlugins).toBe(1)
    expect(report.summary.validPlugins).toBe(1)
    expect(report.summary.errorCount).toBe(0)
  })

  test("returns failure for invalid plugin fixture", async () => {
    // #when
    const result = await runValidatePlugins("test/fixtures/claude-plugins/invalid-plugin-no-manifest")
    const report = JSON.parse(result.stdout) as ValidationReport

    // #then
    expect(result.exitCode).toBe(1)
    expect(report.summary.totalPlugins).toBe(1)
    expect(report.summary.validPlugins).toBe(0)
    expect(report.summary.errorCount).toBeGreaterThan(0)
  })
})
