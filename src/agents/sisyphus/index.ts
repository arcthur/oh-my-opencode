import type { AgentConfig } from "@opencode-ai/sdk"
import { isGptModel, type AgentMode } from "../types"
import type { AvailableAgent, AvailableSkill, AvailableCategory } from "../dynamic-agent-prompt-builder"
import { categorizeTools } from "../dynamic-agent-prompt-builder"
import { buildDynamicSisyphusPrompt, getSisyphusPromptSource } from "./prompt"

export { getSisyphusPromptSource } from "./prompt"
export { SISYPHUS_EXECUTION_PROFILE_GPT, getGptSisyphusExecutionProfile } from "./gpt"
export { SISYPHUS_EXECUTION_PROFILE_NON_GPT, getDefaultSisyphusExecutionProfile } from "./default"

const MODE: AgentMode = "primary"

export function createSisyphusAgent(
  model: string,
  availableAgents?: AvailableAgent[],
  availableToolNames?: string[],
  availableSkills?: AvailableSkill[],
  availableCategories?: AvailableCategory[]
): AgentConfig {
  const tools = availableToolNames ? categorizeTools(availableToolNames) : []
  const skills = availableSkills ?? []
  const categories = availableCategories ?? []
  const prompt = availableAgents
    ? buildDynamicSisyphusPrompt(model, availableAgents, tools, skills, categories)
    : buildDynamicSisyphusPrompt(model, [], tools, skills, categories)

  const permission = { question: "allow" } as AgentConfig["permission"]
  const base = {
    description:
      "Sisyphus - Powerful AI orchestrator from OhMyOpenCode. Plans obsessively with tasks, assesses search complexity before exploration, delegates strategically via category+skills combinations. Uses explore for internal code (parallel-friendly), librarian for external docs.",
    mode: MODE,
    model,
    maxTokens: 64000,
    prompt,
    color: "#00CED1",
    permission,
  }

  if (getSisyphusPromptSource(model) === "gpt" || isGptModel(model)) {
    return { ...base, reasoningEffort: "medium" }
  }

  return { ...base, thinking: { type: "enabled", budgetTokens: 32000 } }
}
createSisyphusAgent.mode = MODE
