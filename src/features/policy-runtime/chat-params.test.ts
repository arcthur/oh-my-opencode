import { describe, expect, test } from "bun:test"
import type { ExecutionContract } from "../../contracts"
import { applyExecutionContractToChatParams } from "./chat-params"

function contract(): ExecutionContract {
  return {
    taskId: "chat-params-test",
    clauses: [],
    defaultConflictResolution: "most-restrictive",
    budgets: {
      contextProfile: "profile_400",
      contextTokensTarget: 240000,
      contextTokensHardLimit: 320000,
      reasoningBudget: "high",
      maxToolCalls: 30,
      wallClockMs: 120000,
    },
    modelPolicy: {
      primary: "openai/gpt-5.3-codex",
      providerPriority: ["openai", "google", "anthropic"],
      allowFallback: true,
      minContextWindow: 400000,
    },
  }
}

describe("applyExecutionContractToChatParams", () => {
  test("injects reasoning budget and model policy metadata", () => {
    const output = {
      options: {} as Record<string, unknown>,
    }

    applyExecutionContractToChatParams(output, contract())

    expect(output.options.reasoningEffort).toBe("high")
    expect(output.options.reasoning_effort).toBe("high")
    expect(output.options.reasoning).toEqual({ effort: "high" })
    expect(output.options.policy_provider_priority).toEqual([
      "openai",
      "google",
      "anthropic",
    ])
    expect(output.options.policy_allow_fallback).toBe(true)
  })

  test("does not override existing provider and reasoning options", () => {
    const output = {
      options: {
        reasoningEffort: "low",
        reasoning_effort: "low",
        reasoning: {
          effort: "low",
          budget_tokens: 42,
        },
        policy_provider_priority: ["openai"],
        policy_allow_fallback: true,
      } as Record<string, unknown>,
    }

    applyExecutionContractToChatParams(output, contract())

    expect(output.options.reasoningEffort).toBe("low")
    expect(output.options.reasoning_effort).toBe("low")
    expect(output.options.reasoning).toEqual({
      effort: "low",
      budget_tokens: 42,
    })
    expect(output.options.policy_provider_priority).toEqual(["openai"])
  })

  test("fills missing reasoning.effort on existing reasoning object", () => {
    const output = {
      options: {
        reasoning: {
          budget_tokens: 128,
        },
      } as Record<string, unknown>,
    }

    applyExecutionContractToChatParams(output, contract())

    expect(output.options.reasoning).toEqual({
      budget_tokens: 128,
      effort: "high",
    })
  })
})
