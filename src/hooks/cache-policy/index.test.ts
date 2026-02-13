import { describe, expect, test } from "bun:test"
import { createCachePolicyHook } from "./index"

interface ChatParamsInput {
  sessionID: string
  agent: { name?: string }
  model: { providerID?: string; modelID?: string }
  provider: { id: string }
  message: { variant?: string }
}

interface ChatParamsOutput {
  options: Record<string, unknown>
}

function createInput(providerID: string, modelID = "test-model"): ChatParamsInput {
  return {
    sessionID: "session-cache-policy",
    agent: { name: "orchestrator" },
    model: { providerID, modelID },
    provider: { id: providerID },
    message: { variant: "max" },
  }
}

describe("cache-policy hook", () => {
  test("observe mode records decision without mutating request options", async () => {
    // #given
    const hook = createCachePolicyHook({
      provider_policy: {
        mode: "observe",
      },
    })
    const output: ChatParamsOutput = { options: {} }

    // #when
    await hook["chat.params"](createInput("openai"), output)

    // #then
    expect(output.options).toEqual({})
    const decision = hook.getLastDecision("session-cache-policy")
    expect(decision?.effectiveMode).toBe("observe")
    expect(decision?.applied).toBe(false)
  })

  test("enforce mode applies provider cache option on supported provider when injection is allowed", async () => {
    // #given
    const hook = createCachePolicyHook({
      provider_policy: {
        mode: "enforce",
        inject_when_missing: true,
      },
    })
    const output: ChatParamsOutput = { options: {} }

    // #when
    await hook["chat.params"](createInput("openai"), output)

    // #then
    expect(output.options.prompt_cache).toBe(true)
    const decision = hook.getLastDecision("session-cache-policy")
    expect(decision?.effectiveMode).toBe("enforce")
    expect(decision?.applied).toBe(true)
  })

  test("enforce mode automatically downgrades to observe for unsupported providers", async () => {
    // #given
    const hook = createCachePolicyHook({
      provider_policy: {
        mode: "enforce",
        inject_when_missing: true,
      },
    })
    const output: ChatParamsOutput = { options: {} }

    // #when
    await hook["chat.params"](createInput("moonshot"), output)

    // #then
    expect(output.options.prompt_cache).toBeUndefined()
    const decision = hook.getLastDecision("session-cache-policy")
    expect(decision?.effectiveMode).toBe("observe")
    expect(decision?.applied).toBe(false)
    expect(decision?.reason.toLowerCase()).toContain("unsupported")
  })

  test("enforce mode supports provider capability override as policy data", async () => {
    // #given
    const hook = createCachePolicyHook({
      provider_policy: {
        mode: "enforce",
        inject_when_missing: true,
        capabilities: {
          customx: {
            supports_cache_policy: true,
            preferred_option_key: "cache_mode",
            option_aliases: ["cache_mode"],
          },
        },
      },
    })
    const output: ChatParamsOutput = { options: {} }

    // #when
    await hook["chat.params"](createInput("customx"), output)

    // #then
    expect(output.options.cache_mode).toBe(true)
    const decision = hook.getLastDecision("session-cache-policy")
    expect(decision?.effectiveMode).toBe("enforce")
    expect(decision?.applied).toBe(true)
  })

  test("phase-6 rollout enforces fixed order by stage", async () => {
    // #given
    const hook = createCachePolicyHook({
      provider_policy: {
        mode: "enforce",
        inject_when_missing: true,
        rollout: {
          enabled: true,
          stage: 1,
          require_thresholds: true,
          providers: {
            openai: {
              approved: true,
              threshold: {
                enabled: true,
                min_cache_hit_ratio: 0.1,
                max_error_rate: 0.2,
                max_p95_latency_ms: 5000,
                min_samples: 10,
              },
              observed: {
                cache_hit_ratio: 0.8,
                error_rate: 0.01,
                p95_latency_ms: 600,
                samples: 100,
              },
            },
          },
        },
      },
    })

    const openaiOutput: ChatParamsOutput = { options: {} }
    const anthropicOutput: ChatParamsOutput = { options: {} }

    // #when
    await hook["chat.params"](createInput("openai"), openaiOutput)
    await hook["chat.params"](
      { ...createInput("anthropic"), sessionID: "session-cache-policy-2" },
      anthropicOutput
    )

    // #then
    expect(openaiOutput.options.prompt_cache).toBe(true)
    expect(anthropicOutput.options.cache).toBeUndefined()
    const anthropicDecision = hook.getLastDecision("session-cache-policy-2")
    expect(anthropicDecision?.effectiveMode).toBe("observe")
    expect(anthropicDecision?.reason.toLowerCase()).toContain("rollout")
  })

  test("phase-6 rollout blocks enforce when threshold gate is not satisfied", async () => {
    // #given
    const hook = createCachePolicyHook({
      provider_policy: {
        mode: "enforce",
        inject_when_missing: true,
        rollout: {
          enabled: true,
          stage: 1,
          require_thresholds: true,
          providers: {
            openai: {
              approved: false,
              threshold: {
                enabled: true,
                min_cache_hit_ratio: 0.6,
                max_error_rate: 0.02,
                max_p95_latency_ms: 1200,
                min_samples: 100,
              },
              observed: {
                cache_hit_ratio: 0.3,
                error_rate: 0.03,
                p95_latency_ms: 1800,
                samples: 50,
              },
            },
          },
        },
      },
    })

    const output: ChatParamsOutput = { options: {} }

    // #when
    await hook["chat.params"](createInput("openai"), output)

    // #then
    expect(output.options.prompt_cache).toBeUndefined()
    const decision = hook.getLastDecision("session-cache-policy")
    expect(decision?.effectiveMode).toBe("observe")
    expect(decision?.reason.toLowerCase()).toContain("threshold")
  })

  test("phase-6 rollout blocks enforce when require_thresholds is enabled but provider gate is missing", async () => {
    // #given
    const hook = createCachePolicyHook({
      provider_policy: {
        mode: "enforce",
        inject_when_missing: true,
        rollout: {
          enabled: true,
          stage: 1,
          require_thresholds: true,
        },
      },
    })

    const output: ChatParamsOutput = { options: {} }

    // #when
    await hook["chat.params"](createInput("openai"), output)

    // #then
    expect(output.options.prompt_cache).toBeUndefined()
    const decision = hook.getLastDecision("session-cache-policy")
    expect(decision?.effectiveMode).toBe("observe")
    expect(decision?.reason.toLowerCase()).toContain("missing")
  })

  test("provider override mode=observe is a one-click rollback even when rollout stage allows enforce", async () => {
    // #given
    const hook = createCachePolicyHook({
      provider_policy: {
        mode: "enforce",
        inject_when_missing: true,
        rollout: {
          enabled: true,
          stage: 3,
        },
        providers: {
          openai: { mode: "observe" },
        },
      },
    })
    const output: ChatParamsOutput = { options: {} }

    // #when
    await hook["chat.params"](createInput("openai"), output)

    // #then
    expect(output.options.prompt_cache).toBeUndefined()
    const decision = hook.getLastDecision("session-cache-policy")
    expect(decision?.requestedMode).toBe("observe")
    expect(decision?.effectiveMode).toBe("observe")
  })
})
