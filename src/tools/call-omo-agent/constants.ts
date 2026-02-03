export const ALLOWED_AGENTS = ["explore", "librarian"] as const

export const CALL_OMO_AGENT_DESCRIPTION = `Spawn explore/librarian agent. run_in_background REQUIRED (true=async with task_id, false=sync).

Available: {agents}

- session_id: Continue an existing session with full context (ONLY supported with run_in_background=false). For background follow-ups, use delegate_task with session_id.

Prompts MUST be in English. Use \`background_output\` for async results.`
