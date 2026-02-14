import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { loadAllPluginComponents } from "../../../src/features/claude-code-plugin-loader/loader"

const createdDirs: string[] = []

function createTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), `${prefix}-`))
  createdDirs.push(dir)
  return dir
}

function writeInstalledPluginsDb(baseDir: string, plugins: Record<string, string>): void {
  const db = {
    version: 2,
    plugins: Object.fromEntries(
      Object.entries(plugins).map(([pluginKey, installPath]) => [
        pluginKey,
        [
          {
            scope: "local",
            installPath,
            version: "1.0.0",
            installedAt: "2026-01-01T00:00:00.000Z",
            lastUpdated: "2026-01-01T00:00:00.000Z",
          },
        ],
      ])
    ),
  }

  writeFileSync(join(baseDir, "installed_plugins.json"), JSON.stringify(db, null, 2))
}

beforeEach(() => {
  const pluginsHome = createTempDir("claude-plugins-home")
  process.env.CLAUDE_PLUGINS_HOME = pluginsHome
  process.env.CLAUDE_SETTINGS_PATH = join(pluginsHome, "settings.json")
})

afterEach(() => {
  delete process.env.CLAUDE_PLUGINS_HOME
  delete process.env.CLAUDE_SETTINGS_PATH

  for (const dir of createdDirs.splice(0, createdDirs.length)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe("loadAllPluginComponents validation integration", () => {
  test("skips invalid plugins and keeps valid plugins loadable", async () => {
    // #given
    const pluginsHome = process.env.CLAUDE_PLUGINS_HOME!
    const validRoot = createTempDir("plugin-valid")
    const invalidRoot = createTempDir("plugin-invalid")

    mkdirSync(join(validRoot, ".claude-plugin"), { recursive: true })
    mkdirSync(join(validRoot, "commands"), { recursive: true })
    writeFileSync(
      join(validRoot, ".claude-plugin", "plugin.json"),
      JSON.stringify({ name: "valid-plugin", version: "1.0.0" })
    )
    writeFileSync(
      join(validRoot, "commands", "hello.md"),
      "---\ndescription: hello\n---\nHello from valid plugin"
    )

    mkdirSync(join(invalidRoot, ".claude-plugin"), { recursive: true })
    writeFileSync(
      join(invalidRoot, ".claude-plugin", "plugin.json"),
      JSON.stringify({ name: "invalid-plugin", version: "1.0.0" })
    )
    // commands path exists but is not a directory
    writeFileSync(join(invalidRoot, "commands"), "not-a-directory")

    writeInstalledPluginsDb(pluginsHome, {
      "valid-plugin@test": validRoot,
      "invalid-plugin@test": invalidRoot,
    })

    // #when
    const result = await loadAllPluginComponents()

    // #then
    expect(Object.keys(result.commands)).toContain("valid-plugin:hello")
    expect(result.plugins.map((p) => p.name)).toEqual(["valid-plugin"])
    expect(result.validation).toBeDefined()
    expect(result.validation?.totalPlugins).toBe(2)
    expect(result.validation?.skippedPlugins).toBe(1)
    expect(result.validation?.errorCount).toBeGreaterThan(0)
  })

  test("respects Claude settings enabledPlugins for plugin filtering", async () => {
    // #given
    const pluginsHome = process.env.CLAUDE_PLUGINS_HOME!
    const enabledRoot = createTempDir("plugin-enabled")
    const disabledRoot = createTempDir("plugin-disabled")

    for (const [root, pluginName, command] of [
      [enabledRoot, "enabled-plugin", "enabled-cmd"],
      [disabledRoot, "disabled-plugin", "disabled-cmd"],
    ] as const) {
      mkdirSync(join(root, ".claude-plugin"), { recursive: true })
      mkdirSync(join(root, "commands"), { recursive: true })
      writeFileSync(
        join(root, ".claude-plugin", "plugin.json"),
        JSON.stringify({ name: pluginName, version: "1.0.0" })
      )
      writeFileSync(
        join(root, "commands", `${command}.md`),
        `---\ndescription: ${command}\n---\n${command}`
      )
    }

    writeInstalledPluginsDb(pluginsHome, {
      "enabled-plugin@test": enabledRoot,
      "disabled-plugin@test": disabledRoot,
    })
    writeFileSync(
      process.env.CLAUDE_SETTINGS_PATH!,
      JSON.stringify({
        enabledPlugins: {
          "enabled-plugin@test": true,
          "disabled-plugin@test": false,
        },
      })
    )

    // #when
    const result = await loadAllPluginComponents()

    // #then
    expect(result.plugins.map((plugin) => plugin.name)).toEqual(["enabled-plugin"])
    expect(Object.keys(result.commands)).toContain("enabled-plugin:enabled-cmd")
    expect(Object.keys(result.commands)).not.toContain("disabled-plugin:disabled-cmd")
  })
})
