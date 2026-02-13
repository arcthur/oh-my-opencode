/**
 * planner Planner System Prompt
 *
 * Named after the Titan who gave fire (knowledge/foresight) to humanity.
 * planner operates in INTERVIEW/CONSULTANT mode by default:
 * - Interviews user to understand what they want to build
 * - Uses librarian/navigator agents to gather context and make informed suggestions
 * - Provides recommendations and asks clarifying questions
 * - ONLY generates work plan when user explicitly requests it
 *
 * Transition to PLAN GENERATION mode when:
 * - User says "Make it into a work plan!" or "Save it as a file"
 * - Generates plan + context manifest in .orchestrator/
 * - High accuracy = stricter reviewer iterative review
 *
 * Can write .md files only (enforced by policy-runtime clauses).
 */

import { PLANNER_IDENTITY_CONSTRAINTS } from "./identity-constraints"
import { PLANNER_BRAINSTORMING_MODE } from "./brainstorming-mode"
import { PLANNER_INTERVIEW_MODE } from "./interview-mode"
import { PLANNER_PLAN_GENERATION } from "./plan-generation"
import { PLANNER_HIGH_ACCURACY_MODE } from "./high-accuracy-mode"
import { PLANNER_PLAN_TEMPLATE } from "./plan-template"
import { PLANNER_BEHAVIORAL_SUMMARY } from "./behavioral-summary"

export type PlannerPromptPhase = "interview" | "plan-generation" | "full"

export interface BuildDynamicPlannerPromptOptions {
  phase?: PlannerPromptPhase
}

const PLANNER_PHASE_HANDOFF_CONTRACT = `# Phase Handoff Contract

Runtime prompt is interview-first to reduce context cost.
When clearance is achieved or user asks to convert to a work plan, execute this sequence:

1. Validate intent with scope-analyst (MATCH or evidence-based OVERRIDE).
2. Generate plan + manifest:
   - \`.orchestrator/plans/{plan-id}/plan.md\`
   - \`.orchestrator/context-manifests/{plan-id}.md\`
3. Run reviewer review and resolve blocking findings (including zero-human verification gate constraints).
4. Archive active draft to \`.orchestrator/drafts/_archive/{plan-id}-{draft-name}.md\`.
5. Offer handoff choices:
   - Start execution now (\`/start-work\`)
   - Run high-accuracy review first

Do not enter full plan authoring flow before transition criteria are satisfied.`

export function buildDynamicPlannerPrompt(
  options: BuildDynamicPlannerPromptOptions = {}
): string {
  const phase = options.phase ?? "full"

  if (phase === "interview") {
    return `${PLANNER_IDENTITY_CONSTRAINTS}
${PLANNER_BRAINSTORMING_MODE}
${PLANNER_INTERVIEW_MODE}
${PLANNER_PHASE_HANDOFF_CONTRACT}`
  }

  if (phase === "plan-generation") {
    return `${PLANNER_IDENTITY_CONSTRAINTS}
${PLANNER_BRAINSTORMING_MODE}
${PLANNER_INTERVIEW_MODE}
${PLANNER_PLAN_GENERATION}
${PLANNER_PLAN_TEMPLATE}
${PLANNER_HIGH_ACCURACY_MODE}
${PLANNER_BEHAVIORAL_SUMMARY}`
  }

  return `${PLANNER_IDENTITY_CONSTRAINTS}
${PLANNER_BRAINSTORMING_MODE}
${PLANNER_INTERVIEW_MODE}
${PLANNER_PLAN_GENERATION}
${PLANNER_HIGH_ACCURACY_MODE}
${PLANNER_PLAN_TEMPLATE}
${PLANNER_BEHAVIORAL_SUMMARY}`
}

/**
 * Combined planner system prompt.
 * Assembled from modular sections for maintainability.
 */
export const PLANNER_SYSTEM_PROMPT = buildDynamicPlannerPrompt({ phase: "full" })
export const PLANNER_RUNTIME_PROMPT = buildDynamicPlannerPrompt({ phase: "interview" })

/**
 * planner planner permission configuration.
 * Allows write/edit for plan files (.md only, enforced by policy-runtime clauses).
 * Question permission allows agent to ask user questions via OpenCode's QuestionTool.
 */
export const PLANNER_PERMISSION = {
  edit: "allow" as const,
  bash: "allow" as const,
  webfetch: "allow" as const,
  question: "allow" as const,
}

// Re-export individual sections for granular access
export { PLANNER_IDENTITY_CONSTRAINTS } from "./identity-constraints"
export { PLANNER_BRAINSTORMING_MODE } from "./brainstorming-mode"
export { PLANNER_INTERVIEW_MODE } from "./interview-mode"
export { PLANNER_PLAN_GENERATION } from "./plan-generation"
export { PLANNER_HIGH_ACCURACY_MODE } from "./high-accuracy-mode"
export { PLANNER_PLAN_TEMPLATE } from "./plan-template"
export { PLANNER_BEHAVIORAL_SUMMARY } from "./behavioral-summary"
