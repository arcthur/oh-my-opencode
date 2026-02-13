import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

describe("doctor config legacy detection", () => {
  let tempProjectDir: string
  let tempConfigDir: string
  let originalCwd: string
  let originalConfigDir: string | undefined

  beforeEach(() => {
    originalCwd = process.cwd()
    originalConfigDir = process.env.OPENCODE_CONFIG_DIR

    tempProjectDir = join(tmpdir(), `omo-doctor-project-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    tempConfigDir = join(tmpdir(), `omo-doctor-config-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(tempProjectDir, { recursive: true })
    mkdirSync(tempConfigDir, { recursive: true })
    process.chdir(tempProjectDir)
    process.env.OPENCODE_CONFIG_DIR = tempConfigDir
  })

  afterEach(() => {
    process.chdir(originalCwd)
    if (originalConfigDir === undefined) {
      delete process.env.OPENCODE_CONFIG_DIR
    } else {
      process.env.OPENCODE_CONFIG_DIR = originalConfigDir
    }
    rmSync(tempProjectDir, { recursive: true, force: true })
    rmSync(tempConfigDir, { recursive: true, force: true })
  })

  test("fails when legacy single-file config exists", async () => {
    // #given
    const legacyPath = join(tempConfigDir, "oh-my-opencode.json")
    writeFileSync(
      legacyPath,
      JSON.stringify(
        {
          config_version: 1,
          agents: {
            oracle: { model: "openai/gpt-5.2" },
          },
        },
        null,
        2,
      ),
    )

    const configCheck = await import(`./config.ts?legacy=${Date.now()}`)

    // #when
    const info = configCheck.getConfigInfo()
    const result = await configCheck.checkConfigValidity()

    // #then
    expect(info.exists).toBe(true)
    expect(info.path).toBe(legacyPath)
    expect(info.valid).toBe(false)
    expect(info.errors.some((e: string) => e.includes("legacy single-file config"))).toBe(true)

    expect(result.status).toBe("fail")
    expect(result.details?.some((d: string) => d.includes("legacy single-file config"))).toBe(true)
  })
})

