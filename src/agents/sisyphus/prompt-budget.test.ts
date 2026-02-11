import { describe, expect, test } from "bun:test"
import { buildDynamicSisyphusPrompt } from "./prompt"
import { categorizeTools, type AvailableAgent, type AvailableCategory, type AvailableSkill } from "../dynamic-agent-prompt-builder"
import { ORACLE_PROMPT_METADATA } from "../oracle"
import { LIBRARIAN_PROMPT_METADATA } from "../librarian"
import { EXPLORE_PROMPT_METADATA } from "../explore"
import { MULTIMODAL_LOOKER_PROMPT_METADATA } from "../multimodal-looker"
import { atlasPromptMetadata } from "../atlas"
import { HEPHAESTUS_PROMPT_METADATA } from "../hephaestus"
import { metisPromptMetadata } from "../metis"
import { momusPromptMetadata } from "../momus"
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
    { name: "oracle", description: "Read-only consultation agent", metadata: ORACLE_PROMPT_METADATA },
    {
      name: "librarian",
      description: "Reference grep for external docs and examples.",
      metadata: LIBRARIAN_PROMPT_METADATA,
    },
    { name: "explore", description: "Contextual grep for internal code.", metadata: EXPLORE_PROMPT_METADATA },
    { name: "multimodal-looker", description: "Analyze images and PDFs.", metadata: MULTIMODAL_LOOKER_PROMPT_METADATA },
    { name: "atlas", description: "Execution orchestrator for deterministic plan runs.", metadata: atlasPromptMetadata },
    { name: "hephaestus", description: "Autonomous deep worker.", metadata: HEPHAESTUS_PROMPT_METADATA },
    { name: "metis", description: "Pre-planning consultant.", metadata: metisPromptMetadata },
    { name: "momus", description: "Plan reviewer.", metadata: momusPromptMetadata },
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

describe("sisyphus prompt budget guardrails", () => {
  test("keeps decision-critical rules while meeting base token budget", () => {
    // #given
    const model = "anthropic/claude-opus-4-5"

    // #when
    const prompt = buildDynamicSisyphusPrompt(model, [], [], [], [])
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
    const prompt = buildDynamicSisyphusPrompt(model, agents, tools, skills, categories)
    const tokens = estimateTokens(prompt)

    // #then
    expect(tokens).toBeLessThanOrEqual(6000)
  })
})

