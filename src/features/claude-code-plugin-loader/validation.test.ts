import { describe, test, expect, afterEach } from "bun:test"
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { LoadedPlugin } from "./types"
import { validateDiscoveredPlugins } from "./validation"

const tempDirs: string[] = []

function createTempPluginRoot(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), `${prefix}-`))
  tempDirs.push(dir)
  return dir
}

function createLoadedPlugin(root: string, name: string): LoadedPlugin {
  return {
    name,
    version: "1.0.0",
    scope: "local",
    installPath: root,
    pluginKey: `${name}@test-marketplace`,
  }
}

afterEach(() => {
  for (const dir of tempDirs.splice(0, tempDirs.length)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe("validateDiscoveredPlugins", () => {
  test("accepts a valid plugin", () => {
    // #given
    const root = createTempPluginRoot("plugin-valid")
    mkdirSync(join(root, ".claude-plugin"), { recursive: true })
    mkdirSync(join(root, "commands"), { recursive: true })

    writeFileSync(
      join(root, ".claude-plugin", "plugin.json"),
      JSON.stringify({ name: "valid-plugin", version: "1.0.0" })
    )
    writeFileSync(
      join(root, "commands", "hello.md"),
      "---\ndescription: hello\n---\nRun hello"
    )

    const plugin = createLoadedPlugin(root, "valid-plugin")
    plugin.commandsDir = join(root, "commands")

    // #when
    const result = validateDiscoveredPlugins([plugin])

    // #then
    expect(result.summary.totalPlugins).toBe(1)
    expect(result.summary.validPlugins).toBe(1)
    expect(result.summary.skippedPlugins).toBe(0)
    expect(result.summary.errorCount).toBe(0)
    expect(result.summary.warningCount).toBe(0)
    expect(result.reports[0]?.issues).toHaveLength(0)
  })

  test("reports error when manifest is missing", () => {
    // #given
    const root = createTempPluginRoot("plugin-missing-manifest")
    const plugin = createLoadedPlugin(root, "missing-manifest")

    // #when
    const result = validateDiscoveredPlugins([plugin])

    // #then
    expect(result.summary.errorCount).toBe(1)
    expect(result.summary.skippedPlugins).toBe(1)
    expect(result.reports[0]?.issues.some((issue) => issue.code === "manifest-missing")).toBe(true)
  })

  test("reports error when manifest JSON is malformed", () => {
    // #given
    const root = createTempPluginRoot("plugin-bad-manifest")
    mkdirSync(join(root, ".claude-plugin"), { recursive: true })
    writeFileSync(join(root, ".claude-plugin", "plugin.json"), "{ not-json }")

    const plugin = createLoadedPlugin(root, "bad-manifest")

    // #when
    const result = validateDiscoveredPlugins([plugin])

    // #then
    expect(result.summary.errorCount).toBe(1)
    expect(result.summary.skippedPlugins).toBe(1)
    expect(result.reports[0]?.issues.some((issue) => issue.code === "manifest-invalid-json")).toBe(true)
  })

  test("reports error when a symlinked skill escapes plugin root", () => {
    // #given
    const root = createTempPluginRoot("plugin-symlink-escape")
    const outsideRoot = createTempPluginRoot("plugin-outside")

    mkdirSync(join(root, ".claude-plugin"), { recursive: true })
    mkdirSync(join(root, "skills"), { recursive: true })
    mkdirSync(join(outsideRoot, "unsafe-skill"), { recursive: true })

    writeFileSync(
      join(root, ".claude-plugin", "plugin.json"),
      JSON.stringify({ name: "symlink-escape" })
    )
    writeFileSync(
      join(outsideRoot, "unsafe-skill", "SKILL.md"),
      "---\nname: unsafe\n---\n# Unsafe"
    )

    symlinkSync(join(outsideRoot, "unsafe-skill"), join(root, "skills", "unsafe"), "dir")

    const plugin = createLoadedPlugin(root, "symlink-escape")
    plugin.skillsDir = join(root, "skills")

    // #when
    const result = validateDiscoveredPlugins([plugin])

    // #then
    expect(result.summary.errorCount).toBeGreaterThan(0)
    expect(result.summary.skippedPlugins).toBe(1)
    expect(result.reports[0]?.issues.some((issue) => issue.code === "path-escape")).toBe(true)
  })

  test("allows symlinked component paths when they resolve within plugin root", () => {
    // #given
    const root = createTempPluginRoot("plugin-symlink-safe")
    mkdirSync(join(root, ".claude-plugin"), { recursive: true })
    mkdirSync(join(root, "commands-real"), { recursive: true })
    writeFileSync(
      join(root, ".claude-plugin", "plugin.json"),
      JSON.stringify({ name: "symlink-safe" })
    )
    writeFileSync(
      join(root, "commands-real", "hello.md"),
      "---\ndescription: hello\n---\nhello"
    )
    symlinkSync(join(root, "commands-real"), join(root, "commands"), "dir")

    const plugin = createLoadedPlugin(root, "symlink-safe")
    plugin.commandsDir = join(root, "commands")

    // #when
    const result = validateDiscoveredPlugins([plugin])

    // #then
    expect(result.summary.errorCount).toBe(0)
    expect(result.summary.skippedPlugins).toBe(0)
  })

  test("reports warning for malformed frontmatter in markdown", () => {
    // #given
    const root = createTempPluginRoot("plugin-warn-frontmatter")
    mkdirSync(join(root, ".claude-plugin"), { recursive: true })
    mkdirSync(join(root, "commands"), { recursive: true })

    writeFileSync(
      join(root, ".claude-plugin", "plugin.json"),
      JSON.stringify({ name: "warn-frontmatter" })
    )
    writeFileSync(
      join(root, "commands", "bad.md"),
      "---\ndescription: [broken\n---\ncontent"
    )

    const plugin = createLoadedPlugin(root, "warn-frontmatter")
    plugin.commandsDir = join(root, "commands")

    // #when
    const result = validateDiscoveredPlugins([plugin])

    // #then
    expect(result.summary.errorCount).toBe(0)
    expect(result.summary.warningCount).toBeGreaterThan(0)
    expect(result.summary.skippedPlugins).toBe(0)
    expect(result.reports[0]?.issues.some((issue) => issue.code === "frontmatter-parse-failed")).toBe(true)
  })
})
