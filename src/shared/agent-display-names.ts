/**
 * Agent config keys to display names mapping.
 * Config keys are lowercase (e.g., "orchestrator", "planner").
 * Display names include suffixes for UI/logs (e.g., "orchestrator (Ultraworker)").
 */
export const AGENT_DISPLAY_NAMES: Record<string, string> = {
  orchestrator: "orchestrator (Ultraworker)",
  "workflow-automator": "workflow-automator (Execution Orchestrator)",
  planner: "planner (Plan Builder)",
  "specialist": "specialist",
  "scope-analyst": "scope-analyst (Pre-Planning Consultant)",
  reviewer: "reviewer (Plan Reviewer)",
  executor: "executor (Autonomous Deep Worker)",
  advisor: "advisor",
  librarian: "librarian",
  navigator: "navigator",
  "interpreter": "interpreter",
}

/**
 * Get display name for an agent config key.
 * Uses case-insensitive lookup for backward compatibility.
 * Returns original key if not found.
 */
export function getAgentDisplayName(configKey: string): string {
  // Try exact match first
  const exactMatch = AGENT_DISPLAY_NAMES[configKey]
  if (exactMatch !== undefined) return exactMatch
  
  // Fall back to case-insensitive search
  const lowerKey = configKey.toLowerCase()
  for (const [k, v] of Object.entries(AGENT_DISPLAY_NAMES)) {
    if (k.toLowerCase() === lowerKey) return v
  }
  
  // Unknown agent: return original key
  return configKey
}
