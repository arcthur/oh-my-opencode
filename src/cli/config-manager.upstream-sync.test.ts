import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import {
  addAuthPlugins,
  addProviderConfig,
  fetchLatestVersion,
  initConfigContext,
  resetConfigContext,
} from "./config-manager"
import { parseJsonc } from "../shared"
import type { InstallConfig } from "./types"

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

describe("config-manager upstream sync behaviors", () => {
  let tempDir: string
  let originalConfigDir: string | undefined
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    tempDir = join(tmpdir(), `omo-config-sync-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(tempDir, { recursive: true })
    originalConfigDir = process.env.OPENCODE_CONFIG_DIR
    process.env.OPENCODE_CONFIG_DIR = tempDir

    resetConfigContext()
    initConfigContext("opencode", null)
  })

  afterEach(() => {
    globalThis.fetch = originalFetch

    if (originalConfigDir === undefined) {
      delete process.env.OPENCODE_CONFIG_DIR
    } else {
      process.env.OPENCODE_CONFIG_DIR = originalConfigDir
    }

    resetConfigContext()
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  test("fetchLatestVersion URL-encodes package name", async () => {
    // #given
    let requestedUrl = ""
    globalThis.fetch = mock((url: string | URL | Request) => {
      requestedUrl = typeof url === "string" ? url : String(url)
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ version: "1.2.3" }),
      } as Response)
    }) as unknown as typeof fetch

    // #when
    const version = await fetchLatestVersion("@scope/pkg")

    // #then
    expect(version).toBe("1.2.3")
    expect(requestedUrl).toContain("%40scope%2Fpkg")
  })

  test("addAuthPlugins preserves JSONC comments and updates plugin array", async () => {
    // #given
    const configPath = join(tempDir, "opencode.jsonc")
    writeFileSync(
      configPath,
      `{
  // keep this comment
  "plugin": ["oh-my-opencode@latest"],
  "other": true
}
`
    )
    globalThis.fetch = mock(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ version: "9.9.9" }),
      } as Response)
    ) as unknown as typeof fetch

    // #when
    const result = await addAuthPlugins({ ...BASE_INSTALL_CONFIG, hasGemini: true })

    // #then
    expect(result.success).toBe(true)
    const updated = readFileSync(configPath, "utf-8")
    expect(updated).toContain("// keep this comment")
    const parsed = parseJsonc<{ plugin?: string[]; other?: boolean }>(updated)
    expect(parsed.plugin).toContain("oh-my-opencode@latest")
    expect(parsed.plugin?.some((p) => p.startsWith("opencode-antigravity-auth@9.9.9"))).toBe(true)
    expect(parsed.other).toBe(true)
  })

  test("addAuthPlugins returns failure when existing config is invalid", async () => {
    // #given
    const configPath = join(tempDir, "opencode.jsonc")
    writeFileSync(configPath, "{ invalid jsonc")

    // #when
    const result = await addAuthPlugins({ ...BASE_INSTALL_CONFIG, hasGemini: true })

    // #then
    expect(result.success).toBe(false)
    expect(result.error).toContain("Failed to parse config file")
  })

  test("addProviderConfig preserves JSONC and safely replaces nested provider object", () => {
    // #given
    const configPath = join(tempDir, "opencode.jsonc")
    writeFileSync(
      configPath,
      `{
  // preserve me
  "provider": {
    "custom": {
      "note": "contains } and { inside string"
    }
  },
  "plugin": []
}
`
    )

    // #when
    const result = addProviderConfig({ ...BASE_INSTALL_CONFIG, hasGemini: true })

    // #then
    expect(result.success).toBe(true)
    const updated = readFileSync(configPath, "utf-8")
    expect(updated).toContain("// preserve me")
    const parsed = parseJsonc<{
      provider?: {
        custom?: { note?: string }
        google?: unknown
      }
      plugin?: unknown[]
    }>(updated)
    expect(parsed.provider?.custom?.note).toBe("contains } and { inside string")
    expect(parsed.provider?.google).toBeDefined()
    expect(Array.isArray(parsed.plugin)).toBe(true)
  })

  test("addProviderConfig returns failure when existing config is invalid", () => {
    // #given
    const configPath = join(tempDir, "opencode.jsonc")
    writeFileSync(configPath, "{ invalid jsonc")

    // #when
    const result = addProviderConfig({ ...BASE_INSTALL_CONFIG, hasGemini: true })

    // #then
    expect(result.success).toBe(false)
    expect(result.error).toContain("Failed to parse config file")
  })
})
