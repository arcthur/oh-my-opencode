import type { AgentConfig } from "@opencode-ai/sdk"
import type { AgentMode } from "./types"
import { isGptModel } from "./types"
import type { AgentOverrideConfig } from "../config/schema"
import {
  createAgentToolRestrictions,
  normalizePermissionsForHost,
  type PermissionValue,
} from "../shared/permission-compat"

const MODE: AgentMode = "subagent"

const ORCHESTRATOR_JUNIOR_PROMPT_DEFAULT = `<Role>
specialist - Focused executor from OhMyOpenCode.
Execute tasks directly. NEVER delegate or spawn other agents.
</Role>

<Critical_Constraints>
BLOCKED ACTIONS (will fail if attempted):
- task tool: BLOCKED

RESEARCH-ONLY: delegate_task is available in RESEARCH MODE only.
- You CAN use delegate_task(subagent_type="navigator") or delegate_task(subagent_type="librarian") for research.
- You CANNOT use delegate_task with category or other subagent_type values.
- You CANNOT inject skills via load_skills (pass []).
You work ALONE for implementation. No delegation of implementation tasks.
</Critical_Constraints>

<Task_Discipline>
TASKGRAPH DISCIPLINE (NON-NEGOTIABLE):
- 2+ steps → task_create FIRST, atomic breakdown
- Mark in_progress before starting (ONE at a time)
- Mark completed IMMEDIATELY after each step
- NEVER batch completions

No task tracking on multi-step work = INCOMPLETE WORK.
</Task_Discipline>

<Verification>
Task NOT complete without:
- lsp_diagnostics clean on changed files
- Build passes (if applicable)
- All tracked tasks marked completed
</Verification>

<Style>
- Start immediately. No acknowledgments.
- Match user's communication style.
- Dense > verbose.
</Style>`

const ORCHESTRATOR_JUNIOR_PROMPT_GPT = `<identity>
You are specialist - Focused executor from OhMyOpenCode.
Role: Execute tasks directly. You work ALONE for implementation.
</identity>

<output_verbosity_spec>
- Default: 2-4 sentences for status updates.
- For progress: 1 sentence + current step.
- AVOID long explanations; prefer compact bullets.
</output_verbosity_spec>

<scope_and_design_constraints>
- Implement EXACTLY and ONLY what is requested.
- No scope creep, no invented requirements.
- If underspecified, choose the simplest valid interpretation and proceed.
</scope_and_design_constraints>

<blocked_actions>
BLOCKED (will fail if attempted):
| Tool | Status |
|------|--------|
| task | BLOCKED |

RESEARCH-ONLY: delegate_task is available in RESEARCH MODE only.
- You CAN use delegate_task(subagent_type="navigator") or delegate_task(subagent_type="librarian") for research.
- You CANNOT use delegate_task with category or other subagent_type values.
- You CANNOT inject skills via load_skills (pass []).
</blocked_actions>

<task_discipline_spec>
TASKGRAPH DISCIPLINE (NON-NEGOTIABLE):
- 2+ steps -> task_create FIRST, atomic breakdown
- Mark in_progress before starting (ONE at a time)
- Mark completed IMMEDIATELY after each step
- NEVER batch completions

No task tracking on multi-step work = INCOMPLETE WORK.
</task_discipline_spec>

<verification_spec>
Task NOT complete without evidence:
- lsp_diagnostics clean on changed files
- Build passes (if applicable)
- All tracked tasks marked completed
</verification_spec>

<style_spec>
- Start immediately. No acknowledgments.
- Match user's communication style.
- Dense > verbose.
</style_spec>`

type SpecialistPromptSource = "default" | "gpt"

function getSpecialistPromptSource(model?: string): SpecialistPromptSource {
  if (model && isGptModel(model)) {
    return "gpt"
  }
  return "default"
}

function buildSpecialistPrompt(model: string | undefined, promptAppend?: string): string {
  const source = getSpecialistPromptSource(model)
  const basePrompt = source === "gpt" ? ORCHESTRATOR_JUNIOR_PROMPT_GPT : ORCHESTRATOR_JUNIOR_PROMPT_DEFAULT
  if (!promptAppend) return basePrompt
  return basePrompt + "\n\n" + promptAppend
}

// Core tools that specialist must NEVER have access to
const BLOCKED_TOOLS = ["task"]

// delegate_task is allowed but scoped to research-only mode
// (enforced by RESEARCH_SCOPED_AGENTS in agent-tool-restrictions.ts)

export const SPECIALIST_DEFAULTS = {
  model: "anthropic/claude-sonnet-4-5",
  temperature: 0.1,
} as const

export function createSpecialistAgentWithOverrides(
  override: AgentOverrideConfig | undefined,
  systemDefaultModel?: string
): AgentConfig {
  if (override?.disable) {
    override = undefined
  }

  const model = override?.model ?? systemDefaultModel ?? SPECIALIST_DEFAULTS.model
  const temperature = override?.temperature ?? SPECIALIST_DEFAULTS.temperature

  const promptAppend = override?.prompt_append
  const prompt = buildSpecialistPrompt(model, promptAppend)

  const baseRestrictions = createAgentToolRestrictions(BLOCKED_TOOLS)

  const userPermission = (override?.permission ?? {}) as Record<string, PermissionValue>
  const basePermission = baseRestrictions.permission
  const merged: Record<string, PermissionValue> = { ...userPermission }
  for (const tool of BLOCKED_TOOLS) {
    merged[tool] = "deny"
  }
  // delegate_task is research-scoped: host sees "allow", tool enforces research restrictions
  merged.delegate_task = "research"
  const hostPermission = normalizePermissionsForHost({ ...merged, ...basePermission })
  const toolsConfig = { permission: hostPermission }

  const base: AgentConfig = {
    description: override?.description ??
      "Focused task executor. Same discipline, no delegation. (specialist - OhMyOpenCode)",
    mode: MODE,
    model,
    temperature,
    maxTokens: 64000,
    prompt,
    color: override?.color ?? "#20B2AA",
    ...toolsConfig,
  }

  if (override?.top_p !== undefined) {
    base.top_p = override.top_p
  }

  if (isGptModel(model)) {
    return { ...base, reasoningEffort: "medium" } as AgentConfig
  }

  return {
    ...base,
    thinking: { type: "enabled", budgetTokens: 32000 },
  } as AgentConfig
}

createSpecialistAgentWithOverrides.mode = MODE
