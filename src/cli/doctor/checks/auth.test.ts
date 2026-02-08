import { describe, it, expect, spyOn, afterEach } from "bun:test"
import * as auth from "./auth"

describe("auth check", () => {
  describe("google auth env detection", () => {
    const trackedEnvKeys = [
      "GOOGLE_GENERATIVE_AI_API_KEY",
      "GEMINI_API_KEY",
      "GOOGLE_API_KEY",
    ] as const
    const originalEnv: Partial<Record<(typeof trackedEnvKeys)[number], string | undefined>> = {}

    for (const key of trackedEnvKeys) {
      originalEnv[key] = process.env[key]
    }

    afterEach(() => {
      for (const key of trackedEnvKeys) {
        const previousValue = originalEnv[key]
        if (previousValue === undefined) {
          delete process.env[key]
        } else {
          process.env[key] = previousValue
        }
      }
    })

    it("detects GOOGLE_GENERATIVE_AI_API_KEY as configured", () => {
      // given google env key is configured
      process.env.GOOGLE_GENERATIVE_AI_API_KEY = "google-secret"
      delete process.env.GEMINI_API_KEY
      delete process.env.GOOGLE_API_KEY

      // when checking env
      const envKey = auth.getGoogleConfiguredEnvKey()

      // then should detect canonical key
      expect(envKey).toBe("GOOGLE_GENERATIVE_AI_API_KEY")
    })

    it("detects GEMINI_API_KEY as fallback env key", () => {
      // given gemini legacy env key is configured
      delete process.env.GOOGLE_GENERATIVE_AI_API_KEY
      process.env.GEMINI_API_KEY = "gemini-secret"
      delete process.env.GOOGLE_API_KEY

      // when checking env
      const envKey = auth.getGoogleConfiguredEnvKey()

      // then should detect fallback key
      expect(envKey).toBe("GEMINI_API_KEY")
    })
  })

  describe("getAuthProviderInfo", () => {
    it("returns anthropic as always available", () => {
      // given anthropic provider
      // when getting info
      const info = auth.getAuthProviderInfo("anthropic")

      // then should show plugin installed (builtin)
      expect(info.id).toBe("anthropic")
      expect(info.pluginInstalled).toBe(true)
    })

    it("returns correct name for each provider", () => {
      // given each provider
      // when getting info
      // then should have correct names
      expect(auth.getAuthProviderInfo("anthropic").name).toContain("Claude")
      expect(auth.getAuthProviderInfo("openai").name).toContain("ChatGPT")
      expect(auth.getAuthProviderInfo("google").name).toContain("Gemini")
      expect(auth.getAuthProviderInfo("github-copilot").name).toContain("Copilot")
    })
  })

  describe("checkAuthProvider", () => {
    let getInfoSpy: ReturnType<typeof spyOn>

    afterEach(() => {
      getInfoSpy?.mockRestore()
    })

    it("returns pass when plugin installed", async () => {
      // given plugin installed
      getInfoSpy = spyOn(auth, "getAuthProviderInfo").mockReturnValue({
        id: "anthropic",
        name: "Anthropic (Claude)",
        pluginInstalled: true,
        configured: true,
      })

      // when checking
      const result = await auth.checkAuthProvider("anthropic")

      // then should pass
      expect(result.status).toBe("pass")
    })

    it("returns skip when plugin not installed", async () => {
      // given plugin not installed
      getInfoSpy = spyOn(auth, "getAuthProviderInfo").mockReturnValue({
        id: "openai",
        name: "OpenAI (ChatGPT)",
        pluginInstalled: false,
        configured: false,
      })

      // when checking
      const result = await auth.checkAuthProvider("openai")

      // then should skip
      expect(result.status).toBe("skip")
      expect(result.message).toContain("not installed")
    })

    it("returns warn when plugin is installed but auth is not configured", async () => {
      // given plugin installed but no valid auth state
      getInfoSpy = spyOn(auth, "getAuthProviderInfo").mockReturnValue({
        id: "google",
        name: "Google (Gemini)",
        pluginInstalled: true,
        configured: false,
      })

      // when checking
      const result = await auth.checkAuthProvider("google")

      // then should warn with remediation guidance
      expect(result.status).toBe("warn")
      expect(result.message).toContain("not configured")
      expect(result.details?.some((line) => line.includes("opencode auth login"))).toBe(true)
    })
  })

  describe("checkAnthropicAuth", () => {
    it("returns a check result", async () => {
      // given
      // when checking anthropic
      const result = await auth.checkAnthropicAuth()

      // then should return valid result
      expect(result.name).toBeDefined()
      expect(["pass", "fail", "warn", "skip"]).toContain(result.status)
    })
  })

  describe("checkOpenAIAuth", () => {
    it("returns a check result", async () => {
      // given
      // when checking openai
      const result = await auth.checkOpenAIAuth()

      // then should return valid result
      expect(result.name).toBeDefined()
      expect(["pass", "fail", "warn", "skip"]).toContain(result.status)
    })
  })

  describe("checkGoogleAuth", () => {
    it("returns a check result", async () => {
      // given
      // when checking google
      const result = await auth.checkGoogleAuth()

      // then should return valid result
      expect(result.name).toBeDefined()
      expect(["pass", "fail", "warn", "skip"]).toContain(result.status)
    })
  })

  describe("getAuthCheckDefinitions", () => {
    it("returns definitions for all supported providers", () => {
      // given
      // when getting definitions
      const defs = auth.getAuthCheckDefinitions()

      // then should have 4 definitions
      expect(defs.length).toBe(4)
      expect(defs.every((d) => d.category === "authentication")).toBe(true)
    })
  })
})
