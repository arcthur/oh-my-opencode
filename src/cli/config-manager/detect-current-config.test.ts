import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { initConfigContext, resetConfigContext } from "../config-manager"
import { detectCurrentConfig } from "./detect-current-config"

describe("detect-current-config", () => {
  let tempDir: string
  let originalConfigDir: string | undefined

  beforeEach(() => {
    tempDir = join(tmpdir(), `omo-detect-config-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(tempDir, { recursive: true })

    originalConfigDir = process.env.OPENCODE_CONFIG_DIR
    process.env.OPENCODE_CONFIG_DIR = tempDir
    resetConfigContext()
    initConfigContext("opencode", null)
  })

  afterEach(() => {
    if (originalConfigDir === undefined) {
      delete process.env.OPENCODE_CONFIG_DIR
    } else {
      process.env.OPENCODE_CONFIG_DIR = originalConfigDir
    }
    resetConfigContext()
    rmSync(tempDir, { recursive: true, force: true })
  })

  test("detects providers from modular config files, not only 00-core", () => {
    // #given
    writeFileSync(
      join(tempDir, "opencode.json"),
      JSON.stringify({ plugin: ["oh-my-opencode@latest"] }, null, 2),
    )

    const omoDir = join(tempDir, "oh-my-opencode")
    mkdirSync(omoDir, { recursive: true })
    writeFileSync(
      join(omoDir, "00-core.json"),
      JSON.stringify({ config_version: 1 }, null, 2),
    )
    writeFileSync(
      join(omoDir, "20-providers.json"),
      JSON.stringify(
        {
          agents: {
            advisor: { model: "openai/gpt-5.2" },
            navigator: { model: "opencode/gpt-5-nano" },
            librarian: { model: "zai-coding-plan/glm-4.7" },
            "scope-analyst": { model: "kimi-for-coding/k2p5" },
          },
        },
        null,
        2,
      ),
    )

    // #when
    const detected = detectCurrentConfig()

    // #then
    expect(detected.isInstalled).toBe(true)
    expect(detected.hasOpenAI).toBe(true)
    expect(detected.hasOpencodeZen).toBe(true)
    expect(detected.hasZaiCodingPlan).toBe(true)
    expect(detected.hasKimiForCoding).toBe(true)
  })
})
