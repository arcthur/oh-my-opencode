import { describe, expect, test } from "bun:test"
import { validateStrictOhMyOpenCodeConfig } from "./strict-config-validation"
import { CURRENT_CONFIG_VERSION } from "./version"

describe("validateStrictOhMyOpenCodeConfig", () => {
  test("fails when config_version is missing", () => {
    // #given
    const rawConfig: Record<string, unknown> = {
      agents: {
        oracle: {
          model: "openai/gpt-5.2",
        },
      },
    }

    // #when
    const result = validateStrictOhMyOpenCodeConfig(rawConfig)

    // #then
    expect(result.success).toBe(false)
    expect(result.errors[0]).toContain("config_version")
  })

  test("fails when config_version is unsupported", () => {
    // #given
    const rawConfig: Record<string, unknown> = {
      config_version: CURRENT_CONFIG_VERSION + 1,
      agents: {
        oracle: {
          model: "openai/gpt-5.2",
        },
      },
    }

    // #when
    const result = validateStrictOhMyOpenCodeConfig(rawConfig)

    // #then
    expect(result.success).toBe(false)
    expect(result.errors[0]).toContain(String(CURRENT_CONFIG_VERSION))
  })

  test("passes when config_version matches current version", () => {
    // #given
    const rawConfig: Record<string, unknown> = {
      config_version: CURRENT_CONFIG_VERSION,
      architecture_version: 2,
      agents: {
        oracle: {
          model: "openai/gpt-5.2",
        },
      },
    }

    // #when
    const result = validateStrictOhMyOpenCodeConfig(rawConfig)

    // #then
    expect(result.success).toBe(true)
  })

  test("fails when unknown top-level key is provided (lsp)", () => {
    // #given
    const rawConfig: Record<string, unknown> = {
      config_version: CURRENT_CONFIG_VERSION,
      architecture_version: 2,
      lsp: {
        "typescript-language-server": {
          command: ["typescript-language-server", "--stdio"],
          extensions: [".ts"],
        },
      },
    }

    // #when
    const result = validateStrictOhMyOpenCodeConfig(rawConfig)

    // #then
    expect(result.success).toBe(false)
    expect(result.errors.some((e) => e.includes('Unrecognized key: "lsp"'))).toBe(true)
  })

  test("fails when architecture_version is missing", () => {
    // #given
    const rawConfig: Record<string, unknown> = {
      config_version: CURRENT_CONFIG_VERSION,
    }

    // #when
    const result = validateStrictOhMyOpenCodeConfig(rawConfig)

    // #then
    expect(result.success).toBe(false)
    expect(result.errors[0]).toContain("architecture_version")
  })
})
