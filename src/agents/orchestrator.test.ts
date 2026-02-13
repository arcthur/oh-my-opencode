import { describe, expect, test } from "bun:test"
import { createOrchestratorAgent, getOrchestratorPromptSource } from "./orchestrator"
import { getExecutionPolicy } from "../features/orchestration/policy"

describe("orchestrator execution-mode prompt overlays", () => {
  test("selects GPT prompt source for GPT-family models", () => {
    // #given
    const model = "openai/gpt-5.2"

    // #when
    const source = getOrchestratorPromptSource(model)

    // #then
    expect(source).toBe("gpt")
  })

  test("selects default prompt source for non-GPT models", () => {
    // #given
    const model = "anthropic/claude-opus-4-5"

    // #when
    const source = getOrchestratorPromptSource(model)

    // #then
    expect(source).toBe("default")
  })

  test("uses GPT execution profile for GPT models", () => {
    // #given
    const model = "openai/gpt-5.2"
    const policy = getExecutionPolicy()

    // #when
    const agent = createOrchestratorAgent(model)

    // #then
    expect(agent.prompt).toContain("## Execution Profile (GPT-family)")
    expect(agent.prompt).toContain("<output_verbosity_spec>")
    expect(agent.prompt).toContain("Default: 2-4 sentences for status updates")
    expect(agent.prompt).toContain(`Minimum ${policy.delegatePrompt.minNonEmptyLines} lines per delegation prompt`)
  })

  test("uses non-GPT execution profile for Claude-family models", () => {
    // #given
    const model = "anthropic/claude-opus-4-5"

    // #when
    const agent = createOrchestratorAgent(model)

    // #then
    expect(agent.prompt).toContain("## Execution Profile (Non-GPT)")
    expect(agent.prompt).toContain("Prefer complete but concise instructions")
    expect(agent.prompt).toContain("Do not rely on memory for file state")
    expect(agent.prompt).not.toContain("## Execution Profile (GPT-family)")
  })

  test("enforces a single six-section delegation contract for execution clarity", () => {
    // #given
    const model = "anthropic/claude-opus-4-5"

    // #when
    const agent = createOrchestratorAgent(model)

    // #then
    expect(agent.prompt).toContain("Delegation Prompt Structure (MANDATORY - ALL 6 sections)")
    expect(agent.prompt).not.toContain("ALL 7 sections")
  })
})
