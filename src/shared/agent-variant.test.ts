import { describe, expect, test } from "bun:test"
import type { OhMyOpenCodeConfig } from "../config"
import { applyAgentVariant, resolveAgentVariant, resolveVariantForModel } from "./agent-variant"

describe("resolveAgentVariant", () => {
  test("returns undefined when agent name missing", () => {
    // #given
    const config = {} as OhMyOpenCodeConfig

    // #when
    const variant = resolveAgentVariant(config)

    // #then
    expect(variant).toBeUndefined()
  })

  test("returns agent override variant", () => {
    // #given
    const config = {
      agents: {
        sisyphus: { variant: "low" },
      },
    } as OhMyOpenCodeConfig

    // #when
    const variant = resolveAgentVariant(config, "sisyphus")

    // #then
    expect(variant).toBe("low")
  })

  test("returns category variant when agent uses category", () => {
    // #given
    const config = {
      agents: {
        sisyphus: { category: "ultrabrain" },
      },
      categories: {
        ultrabrain: { model: "openai/gpt-5.2", variant: "xhigh" },
      },
    } as OhMyOpenCodeConfig

    // #when
    const variant = resolveAgentVariant(config, "sisyphus")

    // #then
    expect(variant).toBe("xhigh")
  })
})

describe("resolveVariantForModel", () => {
  test("returns undefined when no override and no fallback chain match", () => {
    // #given
    const config = {} as OhMyOpenCodeConfig
    const model = { providerID: "unknown", modelID: "unknown-model" }

    // #when
    const variant = resolveVariantForModel(config, "sisyphus", model)

    // #then
    expect(variant).toBeUndefined()
  })

  test("returns variant from fallback chain when model matches", () => {
    // #given - sisyphus has claude-opus-4-5 with variant "max" in fallback chain
    const config = {} as OhMyOpenCodeConfig
    const model = { providerID: "anthropic", modelID: "claude-opus-4-5" }

    // #when
    const variant = resolveVariantForModel(config, "sisyphus", model)

    // #then
    expect(variant).toBe("max")
  })

  test("user override variant takes precedence over fallback chain default", () => {
    // #given - sisyphus has claude-opus-4-5 with "max" variant by default
    // but user overrides with "high"
    const config = {
      agents: {
        sisyphus: { variant: "high" },
      },
    } as OhMyOpenCodeConfig
    const model = { providerID: "anthropic", modelID: "claude-opus-4-5" }

    // #when
    const variant = resolveVariantForModel(config, "sisyphus", model)

    // #then - user's "high" override takes precedence over fallback chain's "max"
    expect(variant).toBe("high")
  })

  test("case-insensitive agent name lookup", () => {
    // #given
    const config = {
      agents: {
        Sisyphus: { variant: "low" },
      },
    } as OhMyOpenCodeConfig
    const model = { providerID: "anthropic", modelID: "claude-opus-4-5" }

    // #when - using lowercase agent name
    const variant = resolveVariantForModel(config, "sisyphus", model)

    // #then
    expect(variant).toBe("low")
  })
})

describe("applyAgentVariant", () => {
  test("sets variant when message is undefined", () => {
    // #given
    const config = {
      agents: {
        sisyphus: { variant: "low" },
      },
    } as OhMyOpenCodeConfig
    const message: { variant?: string } = {}

    // #when
    applyAgentVariant(config, "sisyphus", message)

    // #then
    expect(message.variant).toBe("low")
  })

  test("does not override existing variant", () => {
    // #given
    const config = {
      agents: {
        sisyphus: { variant: "low" },
      },
    } as OhMyOpenCodeConfig
    const message = { variant: "max" }

    // #when
    applyAgentVariant(config, "sisyphus", message)

    // #then
    expect(message.variant).toBe("max")
  })
})
