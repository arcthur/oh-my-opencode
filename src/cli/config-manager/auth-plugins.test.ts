import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import type { InstallConfig } from "../types"
import { parseJsonc } from "../../shared/jsonc-parser"
import { addAuthPlugins } from "./auth-plugins"
import { initConfigContext, resetConfigContext } from "./config-context"

const BASE_INSTALL_CONFIG: InstallConfig = {
  hasClaude: false,
  isMax20: false,
  hasOpenAI: false,
  hasGemini: false,
  hasCopilot: false,
  hasOpencodeZen: false,
  hasZaiCodingPlan: false,
  hasKimiForCoding: false,
}

describe("auth-plugins", () => {
  let configDir = ""
  const originalFetch = globalThis.fetch
  const originalConfigDir = process.env.OPENCODE_CONFIG_DIR

  beforeEach(() => {
    configDir = mkdtempSync(join(tmpdir(), "omo-auth-plugins-"))
    process.env.OPENCODE_CONFIG_DIR = configDir
    resetConfigContext()
    initConfigContext("opencode", null)
    globalThis.fetch = mock(async () => {
      return new Response(JSON.stringify({ version: "1.2.3" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    }) as typeof fetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    if (originalConfigDir === undefined) {
      delete process.env.OPENCODE_CONFIG_DIR
    } else {
      process.env.OPENCODE_CONFIG_DIR = originalConfigDir
    }
    resetConfigContext()
    rmSync(configDir, { recursive: true, force: true })
  })

  test("updates only top-level plugin key when nested plugin key exists in JSONC", async () => {
    // #given
    mkdirSync(configDir, { recursive: true })
    const configPath = join(configDir, "opencode.jsonc")
    writeFileSync(
      configPath,
      `{
  // keep this nested plugin untouched
  "nested": {
    "plugin": ["nested-value"]
  }
}
`,
      "utf-8",
    )

    // #when
    const result = await addAuthPlugins({
      ...BASE_INSTALL_CONFIG,
      hasGemini: true,
    })

    // #then
    expect(result.success).toBe(true)
    const updated = readFileSync(configPath, "utf-8")
    const parsed = parseJsonc<Record<string, unknown>>(updated)
    expect(parsed.plugin).toEqual(["opencode-antigravity-auth@1.2.3"])
    expect((parsed.nested as Record<string, unknown>).plugin).toEqual(["nested-value"])
  })

  test("creates backup file before writing existing JSONC config", async () => {
    // #given
    mkdirSync(configDir, { recursive: true })
    const configPath = join(configDir, "opencode.jsonc")
    writeFileSync(configPath, `{"plugin":["existing"]}\n`, "utf-8")

    // #when
    const result = await addAuthPlugins({
      ...BASE_INSTALL_CONFIG,
      hasGemini: true,
    })

    // #then
    expect(result.success).toBe(true)
    expect(existsSync(`${configPath}.bak`)).toBe(true)
  })

  test("treats non-array plugin values as empty and still writes valid plugin array", async () => {
    // #given
    mkdirSync(configDir, { recursive: true })
    const configPath = join(configDir, "opencode.jsonc")
    writeFileSync(
      configPath,
      `{
  "plugin": "legacy-single-plugin"
}
`,
      "utf-8",
    )

    // #when
    const result = await addAuthPlugins({
      ...BASE_INSTALL_CONFIG,
      hasGemini: true,
    })

    // #then
    expect(result.success).toBe(true)
    const updated = readFileSync(configPath, "utf-8")
    const parsed = parseJsonc<Record<string, unknown>>(updated)
    expect(parsed.plugin).toEqual(["opencode-antigravity-auth@1.2.3"])
  })
})
