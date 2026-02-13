import type { AgentConfig } from "@opencode-ai/sdk"
import type { AgentMode, AgentPromptMetadata } from "../types"
import { isGptModel } from "../types"
import type { AvailableAgent, AvailableSkill, AvailableCategory } from "../dynamic-agent-prompt-builder"
import { buildCategorySkillsDelegationGuide } from "../dynamic-agent-prompt-builder"
import type { CategoryConfig } from "../../config/schema"
import { mergeCategories } from "../../shared/merge-categories"
import { createAgentToolRestrictions } from "../../shared/permission-compat"
import { getDefaultWorkflowAutomatorPrompt } from "./default"
import { getGptWorkflowAutomatorPrompt } from "./gpt"
import {
  getCategoryDescription,
  buildAgentSelectionSection,
  buildCategorySection,
  buildSkillsSection,
  buildDecisionMatrix,
} from "./prompt-section-builder"

const MODE: AgentMode = "primary"

export type WorkflowAutomatorPromptSource = "default" | "gpt"

export interface WorkflowAutomatorContext {
  model?: string
  availableAgents?: AvailableAgent[]
  availableSkills?: AvailableSkill[]
  userCategories?: Record<string, CategoryConfig>
}

export function getWorkflowAutomatorPromptSource(model?: string): WorkflowAutomatorPromptSource {
  if (model && isGptModel(model)) {
    return "gpt"
  }
  return "default"
}

export function getWorkflowAutomatorPrompt(model?: string): string {
  const source = getWorkflowAutomatorPromptSource(model)
  if (source === "gpt") {
    return getGptWorkflowAutomatorPrompt()
  }
  return getDefaultWorkflowAutomatorPrompt()
}

function buildDynamicWorkflowAutomatorPrompt(ctx?: WorkflowAutomatorContext): string {
  const agents = ctx?.availableAgents ?? []
  const skills = ctx?.availableSkills ?? []
  const userCategories = ctx?.userCategories
  const model = ctx?.model

  const allCategories = mergeCategories(userCategories)
  const availableCategories: AvailableCategory[] = Object.entries(allCategories).map(([name]) => ({
    name,
    description: getCategoryDescription(name, userCategories),
  }))

  const categorySection = buildCategorySection(userCategories)
  const agentSection = buildAgentSelectionSection(agents)
  const decisionMatrix = buildDecisionMatrix(agents, userCategories)
  const skillsSection = buildSkillsSection(skills)
  const categorySkillsGuide = buildCategorySkillsDelegationGuide(availableCategories, skills)
  const basePrompt = getWorkflowAutomatorPrompt(model)

  return basePrompt
    .replace("{CATEGORY_SECTION}", categorySection)
    .replace("{AGENT_SECTION}", agentSection)
    .replace("{DECISION_MATRIX}", decisionMatrix)
    .replace("{SKILLS_SECTION}", skillsSection)
    .replace("{{CATEGORY_SKILLS_DELEGATION_GUIDE}}", categorySkillsGuide)
}

export function createWorkflowAutomatorAgent(ctx: WorkflowAutomatorContext): AgentConfig {
  const restrictions = createAgentToolRestrictions([
    "task",
  ])

  const baseConfig = {
    description:
      "workflow-automator execution orchestrator. Runs plan execution with strict delegation, TaskGraph transitions, and verification loops. (workflow-automator - OhMyOpenCode)",
    mode: MODE,
    ...(ctx.model ? { model: ctx.model } : {}),
    temperature: 0.1,
    prompt: buildDynamicWorkflowAutomatorPrompt(ctx),
    color: "#10B981",
    permission: {
      ...(restrictions.permission ?? {}),
      question: "allow",
    } as AgentConfig["permission"],
  }

  return baseConfig as AgentConfig
}
createWorkflowAutomatorAgent.mode = MODE

export function createWorkflowAutomatorAgentFactory(model: string): AgentConfig {
  return createWorkflowAutomatorAgent({ model })
}
createWorkflowAutomatorAgentFactory.mode = MODE

export const workflowAutomatorPromptMetadata: AgentPromptMetadata = {
  category: "advisor",
  cost: "EXPENSIVE",
  promptAlias: "workflow-automator",
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
