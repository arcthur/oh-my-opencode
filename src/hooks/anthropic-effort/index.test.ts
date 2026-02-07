import { describe, expect, it } from "bun:test"
import { createAnthropicEffortHook } from "./index"

interface ChatParamsInput {
  sessionID: string
  agent: { name?: string }
  model: { providerID: string; modelID: string | undefined; id?: string; api?: { npm?: string } }
  provider: { id: string }
  message: { variant?: string }
}

interface ChatParamsOutput {
  temperature?: number
  topP?: number
  topK?: number
  options: Record<string, unknown>
}

function createMockParams(overrides: {
  providerID?: string
  modelID?: string
  variant?: string
  agentName?: string
  existingOptions?: Record<string, unknown>
}): { input: ChatParamsInput; output: ChatParamsOutput } {
  const providerID = overrides.providerID ?? "anthropic"
  const modelID = overrides.modelID ?? "claude-opus-4-6"
  const variant = "variant" in overrides ? overrides.variant : "max"
  const agentName = overrides.agentName ?? "sisyphus"
  const existingOptions = overrides.existingOptions ?? {}

  return {
    input: {
      sessionID: "test-session",
      agent: { name: agentName },
      model: { providerID, modelID },
      provider: { id: providerID },
      message: { variant },
    },
    output: {
      temperature: 0.1,
      options: { ...existingOptions },
    },
  }
}

describe("createAnthropicEffortHook", () => {
  describe("opus 4-6 with variant max", () => {
    it("injects effort=max for anthropic claude-opus-4-6", async () => {
      // #given
      const hook = createAnthropicEffortHook()
      const { input, output } = createMockParams({})

      // #when
      await hook["chat.params"](input, output)

      // #then
      expect(output.options.effort).toBe("max")
    })

    it("injects effort=max for github-copilot claude-opus-4-6", async () => {
      // #given
      const hook = createAnthropicEffortHook()
      const { input, output } = createMockParams({
        providerID: "github-copilot",
        modelID: "claude-opus-4-6",
      })

      // #when
      await hook["chat.params"](input, output)

      // #then
      expect(output.options.effort).toBe("max")
    })

    it("normalizes dotted model id (claude-opus-4.6)", async () => {
      // #given
      const hook = createAnthropicEffortHook()
      const { input, output } = createMockParams({
        modelID: "claude-opus-4.6",
      })

      // #when
      await hook["chat.params"](input, output)

      // #then
      expect(output.options.effort).toBe("max")
    })
  })

  describe("skip conditions", () => {
    it("does not inject when variant is not max", async () => {
      // #given
      const hook = createAnthropicEffortHook()
      const { input, output } = createMockParams({ variant: "high" })

      // #when
      await hook["chat.params"](input, output)

      // #then
      expect(output.options.effort).toBeUndefined()
    })

    it("does not inject for non-opus model", async () => {
      // #given
      const hook = createAnthropicEffortHook()
      const { input, output } = createMockParams({
        modelID: "claude-sonnet-4-5",
      })

      // #when
      await hook["chat.params"](input, output)

      // #then
      expect(output.options.effort).toBeUndefined()
    })

    it("does not throw when modelID is undefined", async () => {
      // #given
      const hook = createAnthropicEffortHook()
      const input: ChatParamsInput = {
        sessionID: "test-session",
        agent: { name: "sisyphus" },
        model: { providerID: "anthropic", modelID: undefined },
        provider: { id: "anthropic" },
        message: { variant: "max" },
      }
      const output: ChatParamsOutput = { temperature: 0.1, options: {} }

      // #when
      await hook["chat.params"](input, output)

      // #then
      expect(output.options.effort).toBeUndefined()
    })
  })

  describe("preserve existing options", () => {
    it("does not overwrite existing effort", async () => {
      // #given
      const hook = createAnthropicEffortHook()
      const { input, output } = createMockParams({
        existingOptions: { effort: "high" },
      })

      // #when
      await hook["chat.params"](input, output)

      // #then
      expect(output.options.effort).toBe("high")
    })
  })
})
