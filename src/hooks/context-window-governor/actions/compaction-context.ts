import { createSystemDirective, SystemDirectiveTypes } from "../../../shared/system-directive"

const COMPACTION_CONTEXT_PROMPT = `${createSystemDirective(SystemDirectiveTypes.COMPACTION_CONTEXT)}

When summarizing this session, you MUST include:

1. User Requests (As-Is)
2. Final Goal
3. Files Modified (with details)
4. Key Decisions & Rationale
5. Current Working State
6. Environment & Tool Outputs Still Needed
7. Remaining Tasks
8. MUST NOT Do (Critical Constraints)
9. Important Context
10. Agent Verification State

This structured context is CRITICAL for continuity after compaction.`

export function getCompactionContextPrompt(): string {
  return COMPACTION_CONTEXT_PROMPT
}

export function injectCompactionContext(output?: { context: string[] }): void {
  if (!output || !Array.isArray(output.context)) {
    return
  }

  output.context.push(COMPACTION_CONTEXT_PROMPT)
}
