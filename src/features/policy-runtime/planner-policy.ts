import { createSystemDirective, SystemDirectiveTypes } from "../../shared/system-directive"
import { getAgentDisplayName } from "../../shared/agent-display-names"

export const PLANNER_AGENTS = ["planner"]

export const PLANNER_ALLOWED_EXTENSIONS = [".md"]

export const PLANNER_ALLOWED_PATH_PREFIX = ".orchestrator"

export const PLANNER_MUTATION_TOOLS = ["Write", "Edit", "write", "edit"]

export const PLANNING_CONSULT_WARNING = `

---

${createSystemDirective(SystemDirectiveTypes.PLANNER_READ_ONLY)}

You are being invoked by ${getAgentDisplayName("planner")}, a READ-ONLY planning agent.

**CRITICAL CONSTRAINTS:**
- DO NOT modify any files (no Write, Edit, or any file mutations)
- DO NOT execute commands that change system state
- DO NOT create, delete, or rename files
- ONLY provide analysis, recommendations, and information

**YOUR ROLE**: Provide consultation, research, and analysis to assist with planning.
Return your findings and recommendations. The actual implementation will be handled separately after planning is complete.

---

`

export const PLANNER_WORKFLOW_REMINDER = `

---

${createSystemDirective(SystemDirectiveTypes.PLANNER_READ_ONLY)}

## PLANNER PLAN-WRITING CHECKLIST

Before writing a plan to \`.orchestrator/plans/{planId}/plan.md\`, confirm:

- Interview complete (requirements, scope IN/OUT, ambiguities resolved)
- Recon done (codebase/docs) and approach chosen (2-3 options for non-trivial work)
- If non-trivial: design validated incrementally and design doc written to \`.orchestrator/designs/*.md\`
- Test/verification strategy defined (what to run, what to check)
- If high accuracy requested: run additional reviewer review iterations before handoff

After writing the plan:

- Summarize key decisions and risks
- Instruct the user to run \`/start-work\` to execute (planner does not implement)

---

`
