export const START_WORK_TEMPLATE = `You are starting an workflow-automator execution work session.

## WHAT TO DO

1. **Find available plans**:
   - Plan artifact: \`.orchestrator/plans/<planId>/plan.md\`

2. **Check for active work state**: Read \`.orchestrator/work.yaml\` if it exists

3. **Decision logic**:
   - If \`.orchestrator/work.yaml\` exists AND plan is NOT complete in TaskGraph:
     - **APPEND** current session to session_ids
     - Continue work on existing plan
   - If no active plan OR plan is complete:
     - List available plan IDs (from \`.orchestrator/plans/*/plan.md\`)
     - If ONE plan: auto-select it
     - If MULTIPLE plans: show list with timestamps, ask user to select

4. **Create/Update work.yaml**:
   \`\`\`yaml
   schema_version: 6
   executor: workflow-automator
   plan_id: plan-name
   execution_plan_path: .orchestrator/plans/plan-name/plan.md
   runtime_ledger_path: .orchestrator/plans/plan-name/ledger.yaml
   started_at: ISO_TIMESTAMP
   session_ids:
     - session_id_1
     - session_id_2
   protocol:
     research_ops: 0
     last_findings_mtime: 0
     stop_verification_last_prompt_at_by_session: {}
   errors: []
   blockers: []
   decisions: []
   \`\`\`

5. **Seed plan tasks into TaskGraph (if missing)**:
   - Parse \`## Tasks\` from \`plan.md\`
   - Create TaskGraph nodes under: scope=\`plan\`, container_id=\`<planId>\`

6. **Execute via TaskGraph**:
   - Use \`task_list({ scope: \"plan\", container_id: \"<planId>\", ready_only: true })\` to pick next ready task
   - Use \`task_transition\` to move tasks through \`open -> in_progress -> completed\`

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

Continuing from next ready TaskGraph task...
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
- TaskGraph is the execution SSOT (plan.md is an artifact)
- Follow execution-mode delegation protocols (6-section format)`
