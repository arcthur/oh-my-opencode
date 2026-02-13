import type { AgentConfig } from "@opencode-ai/sdk"
import { isGptModel, type AgentMode } from "../types"
import type { AvailableAgent, AvailableSkill, AvailableCategory } from "../dynamic-agent-prompt-builder"
import { categorizeTools } from "../dynamic-agent-prompt-builder"
import { buildDynamicOrchestratorPrompt, getOrchestratorPromptSource } from "./prompt"

export { getOrchestratorPromptSource } from "./prompt"
export { ORCHESTRATOR_EXECUTION_PROFILE_GPT, getGptOrchestratorExecutionProfile } from "./gpt"
export { ORCHESTRATOR_EXECUTION_PROFILE_NON_GPT, getDefaultOrchestratorExecutionProfile } from "./default"

const MODE: AgentMode = "primary"

export function createOrchestratorAgent(
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
    ? buildDynamicOrchestratorPrompt(model, availableAgents, tools, skills, categories)
    : buildDynamicOrchestratorPrompt(model, [], tools, skills, categories)

  const permission = { question: "allow" } as AgentConfig["permission"]
  const base = {
    description:
      "orchestrator - Powerful AI orchestrator from OhMyOpenCode. Plans obsessively with tasks, assesses search complexity before exploration, delegates strategically via category+skills combinations. Uses navigator for internal code (parallel-friendly), librarian for external docs.",
    mode: MODE,
    model,
    maxTokens: 64000,
    prompt,
    color: "#00CED1",
    permission,
  }

  if (getOrchestratorPromptSource(model) === "gpt" || isGptModel(model)) {
    return { ...base, reasoningEffort: "medium" }
  }

  return { ...base, thinking: { type: "enabled", budgetTokens: 32000 } }
}
createOrchestratorAgent.mode = MODE
