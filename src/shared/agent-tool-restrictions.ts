/**
 * Agent tool restrictions for session.prompt calls.
 * OpenCode SDK's session.prompt `tools` parameter expects boolean values.
 * true = tool allowed, false = tool denied.
 */
const EXPLORATION_AGENT_DENYLIST: Record<string, boolean> = {
  write: false,
  edit: false,
  task: false,
  delegate_task: false,
}

const AGENT_RESTRICTIONS: Record<string, Record<string, boolean>> = {
  explore: EXPLORATION_AGENT_DENYLIST,

  librarian: EXPLORATION_AGENT_DENYLIST,

  oracle: {
    write: false,
    edit: false,
    task: false,
    delegate_task: false,
  },

  "multimodal-looker": {
    read: true,
  },

  "sisyphus-junior": {
    task: false,
    // delegate_task is allowed but scoped to research-only (see RESEARCH_SCOPED_AGENTS)
  },
}

/**
 * Agents whose delegate_task access is scoped to research-only mode.
 * Research mode restricts to: subagent_type ∈ {explore, librarian}, no category, no skill injection.
 */
export const RESEARCH_SCOPED_AGENTS = new Set(["sisyphus-junior"])

/**
 * Agents allowed in research-scoped delegate_task calls.
 */
export const RESEARCH_ALLOWED_AGENTS = new Set(["explore", "librarian"])

export function getAgentToolRestrictions(agentName: string): Record<string, boolean> {
  return AGENT_RESTRICTIONS[agentName]
    ?? Object.entries(AGENT_RESTRICTIONS).find(([key]) => key.toLowerCase() === agentName.toLowerCase())?.[1]
    ?? {}
}

export function hasAgentToolRestrictions(agentName: string): boolean {
  const restrictions = AGENT_RESTRICTIONS[agentName]
    ?? Object.entries(AGENT_RESTRICTIONS).find(([key]) => key.toLowerCase() === agentName.toLowerCase())?.[1]
  return restrictions !== undefined && Object.keys(restrictions).length > 0
}
