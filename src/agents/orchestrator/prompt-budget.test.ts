import { describe, expect, test } from "bun:test"
import { buildDynamicOrchestratorPrompt } from "./prompt"
import { categorizeTools, type AvailableAgent, type AvailableCategory, type AvailableSkill } from "../dynamic-agent-prompt-builder"
import { ADVISOR_PROMPT_METADATA } from "../advisor"
import { LIBRARIAN_PROMPT_METADATA } from "../librarian"
import { NAVIGATOR_PROMPT_METADATA } from "../navigator"
import { INTERPRETER_PROMPT_METADATA } from "../interpreter"
import { workflowAutomatorPromptMetadata } from "../workflow-automator"
import { EXECUTOR_PROMPT_METADATA } from "../executor"
import { scopeAnalystPromptMetadata } from "../scope-analyst"
import { reviewerPromptMetadata } from "../reviewer"
import { DEFAULT_CATEGORIES, CATEGORY_DESCRIPTIONS } from "../../tools/delegate-task/constants"
import { createBuiltinSkills } from "../../features/builtin-skills"

function estimateTokens(value: string): number {
  return Math.ceil(value.length / 4)
}

function createDynamicFixtures(): {
  agents: AvailableAgent[]
  skills: AvailableSkill[]
  categories: AvailableCategory[]
} {
  const agents: AvailableAgent[] = [
    { name: "advisor", description: "Read-only consultation agent", metadata: ADVISOR_PROMPT_METADATA },
    {
      name: "librarian",
      description: "Reference grep for external docs and examples.",
      metadata: LIBRARIAN_PROMPT_METADATA,
    },
    { name: "navigator", description: "Contextual grep for internal code.", metadata: NAVIGATOR_PROMPT_METADATA },
    { name: "interpreter", description: "Analyze images and PDFs.", metadata: INTERPRETER_PROMPT_METADATA },
    { name: "workflow-automator", description: "Execution orchestrator for deterministic plan runs.", metadata: workflowAutomatorPromptMetadata },
    { name: "executor", description: "Autonomous deep worker.", metadata: EXECUTOR_PROMPT_METADATA },
    { name: "scope-analyst", description: "Pre-planning consultant.", metadata: scopeAnalystPromptMetadata },
    { name: "reviewer", description: "Plan reviewer.", metadata: reviewerPromptMetadata },
  ]

  const skills: AvailableSkill[] = createBuiltinSkills().map((skill) => ({
    name: skill.name,
    description: skill.description ?? "",
    location: "plugin",
  }))

  const categories: AvailableCategory[] = Object.keys(DEFAULT_CATEGORIES).map((name) => ({
    name,
    description: (CATEGORY_DESCRIPTIONS as Record<string, string>)[name] ?? "General tasks",
  }))

  return { agents, skills, categories }
}

describe("orchestrator prompt budget guardrails", () => {
  test("keeps decision-critical rules while meeting base token budget", () => {
    // #given
    const model = "anthropic/claude-opus-4-5"

    // #when
    const prompt = buildDynamicOrchestratorPrompt(model, [], [], [], [])
    const tokens = estimateTokens(prompt)

    // #then
    expect(prompt).toContain("<delegation-decision>")
    expect(prompt).toContain("Parallel Dispatch (Minimum Rules)")
    expect(tokens).toBeLessThanOrEqual(4300)
  })

  test("keeps full dynamic prompt under ceiling with default budget", () => {
    // #given
    const model = "anthropic/claude-opus-4-5"
    const { agents, skills, categories } = createDynamicFixtures()
    const tools = categorizeTools([
      "grep",
      "glob",
      "lsp_definition",
      "lsp_references",
      "lsp_rename",
      "ast_grep_search",
      "ast_grep_replace",
      "slashcommand",
    ])

    // #when
    const prompt = buildDynamicOrchestratorPrompt(model, agents, tools, skills, categories)
    const tokens = estimateTokens(prompt)

    // #then
    expect(tokens).toBeLessThanOrEqual(6000)
  })
})

