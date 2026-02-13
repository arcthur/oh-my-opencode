import type { AgentConfig } from "@opencode-ai/sdk"
import type { BuiltinAgentName, AgentOverrides, AgentPromptMetadata } from "./types"
import type { CategoriesConfig, CategoryConfig, GitMasterConfig, BrowserAutomationProvider } from "../config/schema"
import { createOrchestratorAgent } from "./orchestrator"
import { createWorkflowAutomatorAgentFactory, workflowAutomatorPromptMetadata } from "./workflow-automator"
import { createAdvisorAgent, ADVISOR_PROMPT_METADATA } from "./advisor"
import { createLibrarianAgent, LIBRARIAN_PROMPT_METADATA } from "./librarian"
import { createNavigatorAgent, NAVIGATOR_PROMPT_METADATA } from "./navigator"
import { createInterpreterAgent, INTERPRETER_PROMPT_METADATA } from "./interpreter"
import { createExecutorAgent, EXECUTOR_PROMPT_METADATA } from "./executor"
import { createScopeAnalystAgent, scopeAnalystPromptMetadata } from "./scope-analyst"
import { createReviewerAgent, reviewerPromptMetadata } from "./reviewer"
import type { AvailableCategory } from "./dynamic-agent-prompt-builder"
import { fetchAvailableModels, readConnectedProvidersCache } from "../shared"
import { CATEGORY_DESCRIPTIONS } from "../tools/delegate-task/constants"
import { mergeCategories } from "../shared/merge-categories"
import type { LoadedSkill } from "../features/opencode-skill-loader/types"
import type { AgentSource } from "./agent-builder"

import { buildAvailableSkills } from "./builtin-agents/available-skills"
import { collectPendingBuiltinAgents } from "./builtin-agents/general-agents"
import { maybeCreateOrchestratorConfig } from "./builtin-agents/orchestrator-agent"
import { maybeCreateWorkflowAutomatorConfig } from "./builtin-agents/workflow-automator-agent"
import { maybeCreateExecutorConfig } from "./builtin-agents/executor-agent"
import { parseRegisteredAgentSummaries, buildCustomAgentMetadata } from "./custom-agent-summaries"

// Re-export for backward compatibility
export { buildAgent } from "./agent-builder"
export { createEnvContext } from "./env-context"

const agentSources: Record<BuiltinAgentName, AgentSource> = {
  orchestrator: createOrchestratorAgent,
  "workflow-automator": createWorkflowAutomatorAgentFactory,
  executor: createExecutorAgent,
  advisor: createAdvisorAgent,
  librarian: createLibrarianAgent,
  navigator: createNavigatorAgent,
  "interpreter": createInterpreterAgent,
  "scope-analyst": createScopeAnalystAgent,
  reviewer: createReviewerAgent,
}

const agentMetadata: Partial<Record<BuiltinAgentName, AgentPromptMetadata>> = {
  "workflow-automator": workflowAutomatorPromptMetadata,
  advisor: ADVISOR_PROMPT_METADATA,
  librarian: LIBRARIAN_PROMPT_METADATA,
  navigator: NAVIGATOR_PROMPT_METADATA,
  "interpreter": INTERPRETER_PROMPT_METADATA,
  executor: EXECUTOR_PROMPT_METADATA,
  "scope-analyst": scopeAnalystPromptMetadata,
  reviewer: reviewerPromptMetadata,
}

export async function createBuiltinAgents(
  disabledAgents: string[] = [],
  agentOverrides: AgentOverrides = {},
  directory?: string,
  systemDefaultModel?: string,
  categories?: CategoriesConfig,
  gitMasterConfig?: GitMasterConfig,
  discoveredSkills: LoadedSkill[] = [],
  customAgentSummaries?: unknown,
  browserProvider?: BrowserAutomationProvider,
  uiSelectedModel?: string,
  disabledSkills?: Set<string>
): Promise<Record<string, AgentConfig>> {
  const connectedProviders = readConnectedProvidersCache()
  // IMPORTANT: Do NOT call OpenCode client APIs during plugin initialization.
  // This function is called from config handler, and calling client API causes deadlock.
  // See: https://github.com/code-yeongyu/oh-my-opencode/issues/1301
  const availableModels = await fetchAvailableModels(undefined, {
    connectedProviders: connectedProviders ?? undefined,
  })
  const isFirstRunNoCache =
    availableModels.size === 0 && (!connectedProviders || connectedProviders.length === 0)

  const result: Record<string, AgentConfig> = {}

  const mergedCategories = mergeCategories(categories)

  const availableCategories: AvailableCategory[] = Object.entries(mergedCategories).map(([name]) => ({
    name,
    description: categories?.[name]?.description ?? CATEGORY_DESCRIPTIONS[name] ?? "General tasks",
  }))

  const availableSkills = buildAvailableSkills(discoveredSkills, browserProvider, disabledSkills)

  const { pendingAgentConfigs, availableAgents } = collectPendingBuiltinAgents({
    agentSources,
    agentMetadata,
    disabledAgents,
    agentOverrides,
    directory,
    systemDefaultModel,
    mergedCategories,
    gitMasterConfig,
    browserProvider,
    uiSelectedModel,
    availableModels,
    disabledSkills,
  })

  const registeredAgents = parseRegisteredAgentSummaries(customAgentSummaries)
  const builtinAgentNames = new Set(Object.keys(agentSources).map((name) => name.toLowerCase()))
  const disabledAgentNames = new Set(disabledAgents.map((name) => name.toLowerCase()))

  for (const agent of registeredAgents) {
    const lowerName = agent.name.toLowerCase()
    if (builtinAgentNames.has(lowerName)) continue
    if (disabledAgentNames.has(lowerName)) continue
    if (availableAgents.some((availableAgent) => availableAgent.name.toLowerCase() === lowerName)) continue

    availableAgents.push({
      name: agent.name,
      description: agent.description,
      metadata: buildCustomAgentMetadata(agent.name, agent.description),
    })
  }

  const orchestratorConfig = maybeCreateOrchestratorConfig({
    disabledAgents,
    agentOverrides,
    uiSelectedModel,
    availableModels,
    systemDefaultModel,
    isFirstRunNoCache,
    availableAgents,
    availableSkills,
    availableCategories,
    mergedCategories,
    directory,
    userCategories: categories,
  })
  if (orchestratorConfig) {
    result["orchestrator"] = orchestratorConfig
  }

  const workflowAutomatorConfig = maybeCreateWorkflowAutomatorConfig({
    disabledAgents,
    agentOverrides,
    uiSelectedModel,
    availableModels,
    systemDefaultModel,
    availableAgents,
    availableSkills,
    mergedCategories,
    userCategories: categories,
  })
  if (workflowAutomatorConfig) {
    result["workflow-automator"] = workflowAutomatorConfig
  }

  const executorConfig = maybeCreateExecutorConfig({
    disabledAgents,
    agentOverrides,
    availableModels,
    systemDefaultModel,
    isFirstRunNoCache,
    availableAgents,
    availableSkills,
    availableCategories,
    mergedCategories,
    directory,
  })
  if (executorConfig) {
    result["executor"] = executorConfig
  }

  for (const [name, config] of pendingAgentConfigs) {
    result[name] = config
  }

  return result
}
