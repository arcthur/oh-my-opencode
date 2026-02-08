import { afterEach, describe, expect, it } from "bun:test"
import { applyProviderEnvCompat } from "./provider-env-compat"

const ENV_KEYS = [
  "GEMINI_API_KEY",
  "GOOGLE_API_KEY",
  "GOOGLE_GENERATIVE_AI_API_KEY",
] as const

const originalEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {}

function clearCompatEnv(): void {
  for (const key of ENV_KEYS) {
    delete process.env[key]
  }
}

describe("provider env compatibility", () => {
  afterEach(() => {
    clearCompatEnv()
    for (const key of ENV_KEYS) {
      const previousValue = originalEnv[key]
      if (previousValue === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = previousValue
      }
    }
  })

  for (const key of ENV_KEYS) {
    originalEnv[key] = process.env[key]
  }

  it("maps GEMINI_API_KEY to GOOGLE_GENERATIVE_AI_API_KEY when target is missing", () => {
    // given only GEMINI_API_KEY is set
    clearCompatEnv()
    process.env.GEMINI_API_KEY = "gemini-secret"

    // when applying compatibility aliases
    const result = applyProviderEnvCompat(process.env)

    // then GOOGLE_GENERATIVE_AI_API_KEY should be populated
    expect(process.env.GOOGLE_GENERATIVE_AI_API_KEY).toBe("gemini-secret")
    expect(result.applied).toContainEqual({
      source: "GEMINI_API_KEY",
      target: "GOOGLE_GENERATIVE_AI_API_KEY",
    })
  })

  it("does not overwrite GOOGLE_GENERATIVE_AI_API_KEY when already set", () => {
    // given both source and target are set
    clearCompatEnv()
    process.env.GEMINI_API_KEY = "legacy-value"
    process.env.GOOGLE_GENERATIVE_AI_API_KEY = "preferred-value"

    // when applying compatibility aliases
    const result = applyProviderEnvCompat(process.env)

    // then target should keep original value
    expect(process.env.GOOGLE_GENERATIVE_AI_API_KEY).toBe("preferred-value")
    expect(result.applied.length).toBe(0)
  })
})
