export const START_WORK_TEMPLATE = `You are starting a Sisyphus work session.

## WHAT TO DO

1. **Find available plans**:
   - Preferred (execution SSOT): \`.sisyphus/plans/<planId>/plan.md\`
   - Legacy (plan draft): \`.sisyphus/plans/<planId>.md\` (migrate into \`plan.md\` before execution)

2. **Check for active work state**: Read \`.sisyphus/work.yaml\` if it exists

3. **Decision logic**:
   - If \`.sisyphus/work.yaml\` exists AND plan is NOT complete (has unchecked boxes):
     - **APPEND** current session to session_ids
     - Continue work on existing plan
   - If no active plan OR plan is complete:
     - List available plan IDs (from \`.sisyphus/plans/*/plan.md\`)
     - If ONE plan: auto-select it
     - If MULTIPLE plans: show list with timestamps, ask user to select

4. **Create/Update work.yaml**:
   \`\`\`yaml
   schema_version: 2
   plan_id: plan-name
   execution_plan_path: .sisyphus/plans/plan-name/plan.md
   runtime_ledger_path: .sisyphus/plans/plan-name/ledger.yaml
   started_at: ISO_TIMESTAMP
   session_ids:
     - session_id_1
     - session_id_2
   research_ops: 0
   last_findings_mtime: 0
   errors: []
   blockers: []
   phase_completions: []
   decisions: []
   \`\`\`

5. **Read the plan file** (\`.sisyphus/plans/<planId>/plan.md\`) and start executing tasks in sisyphus execution mode

## OUTPUT FORMAT

When listing plans for selection:
\`\`\`
Available Work Plans

Current Time: {ISO timestamp}
Session ID: {current session id}

1. [plan-name-1] - Modified: {date} - Progress: 3/10 tasks
2. [plan-name-2] - Modified: {date} - Progress: 0/5 tasks

Which plan would you like to work on? (Enter number or plan name)
\`\`\`

When resuming existing work:
\`\`\`
Resuming Work Session

Active Plan: {plan-name}
Progress: {completed}/{total} tasks
Sessions: {count} (appending current session)

Reading plan and continuing from last incomplete task...
\`\`\`

When auto-selecting single plan:
\`\`\`
Starting Work Session

Plan: {plan-name}
Session ID: {session_id}
Started: {timestamp}

Reading plan and beginning execution...
\`\`\`

## CRITICAL

- The session_id is injected by the hook - use it directly
- Always update work.yaml BEFORE starting work
- Read the FULL plan file before delegating any tasks
- Follow execution-mode delegation protocols (7-section format)`
