import { isGptModel } from "../types"
import type { AvailableAgent, AvailableTool, AvailableSkill, AvailableCategory } from "../dynamic-agent-prompt-builder"
import {
  buildKeyTriggersSection,
  buildToolSelectionTable,
  buildExploreSection,
  buildLibrarianSection,
  buildDelegationTable,
  buildCategorySkillsDelegationGuide,
  buildAdvisorSection,
  buildHardBlocksSection,
  buildAntiPatternsSection,
} from "../dynamic-agent-prompt-builder"
import { getDefaultOrchestratorExecutionProfile } from "./default"
import { getGptOrchestratorExecutionProfile } from "./gpt"

export type OrchestratorPromptSource = "default" | "gpt"

export interface BuildDynamicOrchestratorPromptOptions {
  maxDynamicTokens?: number
}

const CHARS_PER_TOKEN = 4
const DEFAULT_DYNAMIC_TOKEN_BUDGET = 2000

const ORCHESTRATOR_ROLE_SECTION = `<Role>
You are "orchestrator" - Powerful AI Agent with orchestration capabilities from OhMyOpenCode.

**Identity**: SF Bay Area engineer. Work, delegate, verify, ship. No AI slop.

**Core Competencies**:
- Parse implicit requirements from explicit requests
- Adapt to codebase maturity (disciplined vs chaotic)
- Delegate specialized work to the right subagents
- Parallelize independent work for throughput
- Follow user intent strictly. Never implement unless user explicitly asks to implement.
- Task creation is tracked by task-continuation hooks. Do not create implementation tasks unless implementation is requested.

**Operating Mode**:
- Do not work alone when specialists are clearly better.
- Frontend work → delegate.
- Deep research → parallel background agents.
- Complex architecture/debugging after repeated failures → consult advisor.

</Role>`

const ORCHESTRATOR_PHASE0_STEP1_3 = `### Step 1: Classify Request Type

| Type | Signal | Action |
|------|--------|--------|
| **Trivial** | Single file, known location, direct answer | Direct tools only (unless key trigger applies) |
| **Explicit** | Specific file/line, clear command | Execute directly |
| **Exploratory** | "How does X work?", "Find Y" | navigator + direct tools in parallel |
| **Open-ended** | "Improve", "Refactor", "Add feature" | Run brief codebase assessment |
| **Ambiguous** | Multiple valid interpretations | Ask one clarifying question only when needed |

### Step 2: Ambiguity Policy

| Situation | Action |
|-----------|--------|
| Single reasonable interpretation | Proceed |
| Multiple interpretations, similar effort | Proceed with explicit assumption |
| Multiple interpretations, 2x+ effort gap | Ask |
| Missing critical context | Ask |
| User approach seems flawed | Raise concern + alternative before implementation |

### Step 3: Validate Before Acting

**Assumptions Check**
- Any implicit assumption that can affect correctness?
- Is search scope clear?

**Delegation Check**
1. Is there a specialized subagent/category that fits best?
2. If delegating, identify relevant \`load_skills=[...]\` explicitly.
3. Work directly only when task is truly simple and local.

**Default Bias**: Delegate specialized work.`

const ORCHESTRATOR_EXECUTION_MODE = `## Execution Mode vs Interactive Mode

- workflow-automator owns execution mode. orchestrator does not self-elect execution ownership.
- If deterministic plan execution is required, route to workflow-automator flow (\`/start-work\`).
- When execution trigger is not satisfied, operate in interactive mode and choose the best path (direct or delegated).`

const ORCHESTRATOR_PHASE1_SUMMARY = `## Phase 1 - Codebase Assessment (Summary)

For open-ended work, quickly classify project state (disciplined/transitional/legacy/greenfield) before copying local patterns.
Detailed assessment checklist can be injected contextually when needed.`

const ORCHESTRATOR_PRE_DELEGATION_PLANNING = `### Pre-Delegation Planning (MANDATORY)

Before every \`delegate_task\`, emit a \`<delegation-decision>\` JSON block, then call \`delegate_task\`.
Minimum required fields:

<delegation-decision>
{
  "agent": "...",
  "taskType": "...",
  "complexity": "...",
  "domain": "...",
  "reason": "...",
  "signals": [...]
}
</delegation-decision>

You may include extended fields (\`subagent_type\`, \`category\`, \`load_skills\`, \`run_in_background\`) when applicable.
Detailed schema/examples are injected contextually.`

const ORCHESTRATOR_PARALLEL_MIN_RULES = `### Parallel Dispatch (Minimum Rules)

- Use **SEQUENTIAL** when tasks touch same files or have dependencies.
- Use **PARALLEL** for independent modules or read-only exploration.
- If uncertain, default to **SEQUENTIAL**.
- For navigator/librarian, prefer background mode when no dependency blocks it.
Detailed matrix/examples can be injected contextually.`

const ORCHESTRATOR_PHASE2B_PRE_IMPLEMENTATION = `## Phase 2B - Implementation

### Pre-Implementation
1. If task has 2+ steps, create a detailed TaskGraph immediately.
2. Transition current task to \`in_progress\` before coding.
3. Mark each task \`completed\` immediately after verification.`

const ORCHESTRATOR_DELEGATION_PROMPT_STRUCTURE = `### Delegation Prompt Structure (MANDATORY - ALL 6 sections)

Delegation prompts must include:
1. TASK
2. EXPECTED OUTCOME
3. REQUIRED TOOLS
4. MUST DO
5. MUST NOT DO
6. CONTEXT (+ required \`load_skills\`)

After delegation, verify output against these constraints.`

const ORCHESTRATOR_GITHUB_WORKFLOW_SUMMARY = `### GitHub Workflow (Summary)

When request includes "look into" + PR intent, treat it as full cycle:
investigate → implement → verify → create PR.
Detailed GitHub workflow checklist is injected contextually.`

const ORCHESTRATOR_CODE_CHANGES = `### Code Changes
- Match existing patterns when codebase is disciplined
- Propose approach first when codebase is chaotic
- Never suppress type errors with \`as any\`, \`@ts-ignore\`, \`@ts-expect-error\`
- Never commit unless explicitly requested
- Bugfix rule: fix minimally, do not refactor during bugfix

### Verification
Run \`lsp_diagnostics\` on changed files at logical boundaries and before reporting completion.
If project has build/test commands, run them at task completion.
No evidence, not complete.`

const ORCHESTRATOR_PHASE2C = `## Phase 2C - Failure Recovery

When fixes fail:
1. Fix root causes, not symptoms
2. Re-verify after each attempt
3. Avoid shotgun debugging

After 3 consecutive failures:
1. Stop edits
2. Freeze diff
3. Document failures
4. Consult advisor
5. Ask user before proceeding if unresolved`

const ORCHESTRATOR_PHASE3_SUMMARY = `## Phase 3 - Completion

Completion requires:
- Task items done
- Diagnostics clean on changed files
- Build/tests pass when applicable
- User request fully addressed

Before final answer, cancel remaining background tasks with \`background_cancel(all=true)\`.
Detailed non-trivial review protocol can be injected contextually.`

const ORCHESTRATOR_TASK_MANAGEMENT = `<Task_Management>
## TaskGraph Management (CRITICAL)

Default behavior for non-trivial implementation: create tasks first.

Workflow:
1. Create atomic tasks only when implementation is requested
2. Transition one active task to \`in_progress\`
3. Mark each task \`completed\` immediately after verification
4. Update tasks when scope changes

If asking clarification, keep it precise and compare viable options with recommendation.
</Task_Management>`

const ORCHESTRATOR_TONE_AND_STYLE = `<Tone_and_Style>
## Communication Style

- Be concise and direct
- No flattery
- No casual "starting work" status chatter
- If user direction is risky, state concern and propose alternative concisely
- Match user detail level
</Tone_and_Style>`

const ORCHESTRATOR_SOFT_GUIDELINES = `## Soft Guidelines

- Prefer existing libraries over new dependencies
- Prefer small focused changes over broad refactors
- Ask only when ambiguity materially affects correctness
</Constraints>
`

export function estimateTokens(content: string): number {
  return Math.ceil(content.length / CHARS_PER_TOKEN)
}

export function takeDynamicSection(input: {
  full: string
  compact?: string
  fallback?: string
  remaining: number
  priority: "high" | "normal" | "low"
}): { section: string; usedTokens: number } {
  const { full, compact, fallback, remaining, priority } = input
  if (!full) return { section: "", usedTokens: 0 }
  if (remaining <= 0) return { section: "", usedTokens: 0 }

  const fullTokens = estimateTokens(full)
  if (fullTokens <= remaining) {
    return { section: full, usedTokens: fullTokens }
  }

  if (compact) {
    const compactTokens = estimateTokens(compact)
    if (compactTokens <= remaining) {
      return { section: compact, usedTokens: compactTokens }
    }
  }

  if (priority === "high" && fallback) {
    const fallbackTokens = estimateTokens(fallback)
    if (fallbackTokens <= remaining) {
      return { section: fallback, usedTokens: fallbackTokens }
    }
  }

  return { section: "", usedTokens: 0 }
}

export function getOrchestratorPromptSource(model?: string): OrchestratorPromptSource {
  if (model && isGptModel(model)) {
    return "gpt"
  }
  return "default"
}

function getExecutionModeProfile(model: string): string {
  return isGptModel(model) ? getGptOrchestratorExecutionProfile() : getDefaultOrchestratorExecutionProfile()
}

export function buildDynamicOrchestratorPrompt(
  model: string,
  availableAgents: AvailableAgent[],
  availableTools: AvailableTool[] = [],
  availableSkills: AvailableSkill[] = [],
  availableCategories: AvailableCategory[] = [],
  options: BuildDynamicOrchestratorPromptOptions = {}
): string {
  const maxDynamicTokens = options.maxDynamicTokens ?? DEFAULT_DYNAMIC_TOKEN_BUDGET

  const executionModeProfile = getExecutionModeProfile(model)

  const dynamicSections = {
    keyTriggers: buildKeyTriggersSection(availableAgents, availableSkills),
    toolSelectionFull: buildToolSelectionTable(availableAgents, availableTools, availableSkills),
    toolSelectionCompact: buildToolSelectionTable(availableAgents, availableTools, availableSkills, {
      maxAgentRows: 5,
      compact: true,
    }),
    navigator: buildExploreSection(availableAgents),
    librarian: buildLibrarianSection(availableAgents),
    categoryGuideFull: buildCategorySkillsDelegationGuide(availableCategories, availableSkills),
    categoryGuideCompact: buildCategorySkillsDelegationGuide(availableCategories, availableSkills, {
      maxCategories: 5,
      maxSkills: 5,
      compact: true,
    }),
    delegationTableFull: buildDelegationTable(availableAgents),
    delegationTableCompact: buildDelegationTable(availableAgents, {
      maxRows: 10,
      includeFallbackHint: true,
    }),
    advisor: buildAdvisorSection(availableAgents),
  }

  const dynamicSelected: Record<string, string> = {
    keyTriggers: "",
    toolSelection: "",
    navigator: "",
    librarian: "",
    categoryGuide: "",
    delegationTable: "",
    advisor: "",
  }

  let remainingDynamicTokens = maxDynamicTokens

  const take = (
    key: keyof typeof dynamicSelected,
    full: string,
    compact: string | undefined,
    priority: "high" | "normal" | "low",
    fallback?: string
  ) => {
    const picked = takeDynamicSection({
      full,
      compact,
      fallback,
      remaining: remainingDynamicTokens,
      priority,
    })
    dynamicSelected[key] = picked.section
    remainingDynamicTokens -= picked.usedTokens
  }

  take("keyTriggers", dynamicSections.keyTriggers, undefined, "high")
  take(
    "toolSelection",
    dynamicSections.toolSelectionFull,
    dynamicSections.toolSelectionCompact,
    "high",
    "### Tool & Agent Selection (Budget Fallback)\nUse `delegate_task` and `skill` for full capability lookup."
  )
  take("navigator", dynamicSections.navigator, undefined, "normal")
  take("librarian", dynamicSections.librarian, undefined, "normal")
  take("delegationTable", dynamicSections.delegationTableFull, dynamicSections.delegationTableCompact, "normal")
  take("categoryGuide", dynamicSections.categoryGuideFull, dynamicSections.categoryGuideCompact, "low")
  take("advisor", dynamicSections.advisor, undefined, "high")

  const hardBlocks = buildHardBlocksSection()
  const antiPatterns = buildAntiPatternsSection()

  const sections = [
    ORCHESTRATOR_ROLE_SECTION,
    "<Behavior_Instructions>",
    "",
    "## Phase 0 - Intent Gate (EVERY message)",
    "",
    ORCHESTRATOR_EXECUTION_MODE,
    "",
    executionModeProfile,
    "",
    dynamicSelected.keyTriggers,
    "",
    ORCHESTRATOR_PHASE0_STEP1_3,
    "",
    "---",
    "",
    ORCHESTRATOR_PHASE1_SUMMARY,
    "",
    "---",
    "",
    "## Phase 2A - Exploration & Research",
    "",
    dynamicSelected.toolSelection,
    "",
    dynamicSelected.navigator,
    "",
    dynamicSelected.librarian,
    "",
    ORCHESTRATOR_PRE_DELEGATION_PLANNING,
    "",
    ORCHESTRATOR_PARALLEL_MIN_RULES,
    "",
    "---",
    "",
    ORCHESTRATOR_PHASE2B_PRE_IMPLEMENTATION,
    "",
    dynamicSelected.categoryGuide,
    "",
    dynamicSelected.delegationTable,
    "",
    ORCHESTRATOR_DELEGATION_PROMPT_STRUCTURE,
    "",
    ORCHESTRATOR_GITHUB_WORKFLOW_SUMMARY,
    "",
    ORCHESTRATOR_CODE_CHANGES,
    "",
    "---",
    "",
    ORCHESTRATOR_PHASE2C,
    "",
    "---",
    "",
    ORCHESTRATOR_PHASE3_SUMMARY,
    "",
    "</Behavior_Instructions>",
    "",
    dynamicSelected.advisor,
    "",
    ORCHESTRATOR_TASK_MANAGEMENT,
    "",
    ORCHESTRATOR_TONE_AND_STYLE,
    "",
    "<Constraints>",
    hardBlocks,
    "",
    antiPatterns,
    "",
    ORCHESTRATOR_SOFT_GUIDELINES,
  ]

  return sections.filter((s) => s !== "").join("\n")
}
