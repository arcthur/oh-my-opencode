import type { AgentConfig } from "@opencode-ai/sdk"
import type { AgentMode, AgentPromptMetadata } from "../types"
import { isGptModel } from "../types"
import type { AvailableAgent, AvailableSkill, AvailableCategory } from "../dynamic-agent-prompt-builder"
import { buildCategorySkillsDelegationGuide } from "../dynamic-agent-prompt-builder"
import type { CategoryConfig } from "../../config/schema"
import { DEFAULT_CATEGORIES } from "../../tools/delegate-task/constants"
import { createAgentToolRestrictions } from "../../shared/permission-compat"
import { getDefaultAtlasPrompt } from "./default"
import { getGptAtlasPrompt } from "./gpt"
import {
  getCategoryDescription,
  buildAgentSelectionSection,
  buildCategorySection,
  buildSkillsSection,
  buildDecisionMatrix,
} from "./prompt-section-builder"

const MODE: AgentMode = "primary"

export type AtlasPromptSource = "default" | "gpt"

export interface AtlasContext {
  model?: string
  availableAgents?: AvailableAgent[]
  availableSkills?: AvailableSkill[]
  userCategories?: Record<string, CategoryConfig>
}

export function getAtlasPromptSource(model?: string): AtlasPromptSource {
  if (model && isGptModel(model)) {
    return "gpt"
  }
  return "default"
}

export function getAtlasPrompt(model?: string): string {
  const source = getAtlasPromptSource(model)
  if (source === "gpt") {
    return getGptAtlasPrompt()
  }
  return getDefaultAtlasPrompt()
}

function buildDynamicAtlasPrompt(ctx?: AtlasContext): string {
  const agents = ctx?.availableAgents ?? []
  const skills = ctx?.availableSkills ?? []
  const userCategories = ctx?.userCategories
  const model = ctx?.model

  const allCategories = { ...DEFAULT_CATEGORIES, ...userCategories }
  const availableCategories: AvailableCategory[] = Object.entries(allCategories).map(([name]) => ({
    name,
    description: getCategoryDescription(name, userCategories),
  }))

  const categorySection = buildCategorySection(userCategories)
  const agentSection = buildAgentSelectionSection(agents)
  const decisionMatrix = buildDecisionMatrix(agents, userCategories)
  const skillsSection = buildSkillsSection(skills)
  const categorySkillsGuide = buildCategorySkillsDelegationGuide(availableCategories, skills)
  const basePrompt = getAtlasPrompt(model)

  return basePrompt
    .replace("{CATEGORY_SECTION}", categorySection)
    .replace("{AGENT_SECTION}", agentSection)
    .replace("{DECISION_MATRIX}", decisionMatrix)
    .replace("{SKILLS_SECTION}", skillsSection)
    .replace("{{CATEGORY_SKILLS_DELEGATION_GUIDE}}", categorySkillsGuide)
}

export function createAtlasAgent(ctx: AtlasContext): AgentConfig {
  const restrictions = createAgentToolRestrictions([
    "task",
    "call_omo_agent",
  ])

  const baseConfig = {
    description:
      "Atlas execution orchestrator. Runs plan execution with strict delegation, TaskGraph transitions, and verification loops. (Atlas - OhMyOpenCode)",
    mode: MODE,
    ...(ctx.model ? { model: ctx.model } : {}),
    temperature: 0.1,
    prompt: buildDynamicAtlasPrompt(ctx),
    color: "#10B981",
    permission: {
      ...(restrictions.permission ?? {}),
      question: "allow",
    } as AgentConfig["permission"],
  }

  return baseConfig as AgentConfig
}
createAtlasAgent.mode = MODE

export function createAtlasAgentFactory(model: string): AgentConfig {
  return createAtlasAgent({ model })
}
createAtlasAgentFactory.mode = MODE

export const atlasPromptMetadata: AgentPromptMetadata = {
  category: "advisor",
  cost: "EXPENSIVE",
  promptAlias: "Atlas",
  triggers: [
    {
      domain: "Plan execution orchestration",
      trigger: "Need deterministic delegation and TaskGraph-driven progression",
    },
  ],
  useWhen: [
    "Executing a generated plan via /start-work",
    "Need strict execution and verification loops",
  ],
  avoidWhen: [
    "Ad-hoc exploration without a defined plan",
  ],
  keyTrigger: "Execution session with active work.yaml and remaining TaskGraph tasks",
}
