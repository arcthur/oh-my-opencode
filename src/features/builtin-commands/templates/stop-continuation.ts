export const STOP_CONTINUATION_TEMPLATE = `Stop all continuation mechanisms for the current session.

This command will:
1. Stop the task-auto-continuation from automatically continuing incomplete tasks
2. Cancel any active Ralph Loop
3. Stop planning-with-files stop verification continuation prompts
4. Stop execution-orchestrator work continuation prompts
5. Stop unstable-agent-watchdog reminder prompts
6. Clear the work state for the current project

After running this command:
- The session will not auto-continue when idle
- You can manually continue work when ready
- The stop state is per-session and clears on your next user message (or when the session ends)

Use this when you need to pause automated continuation and take manual control.`
