import { injectHookMessage } from "../../features/hook-message-injector"
import { log } from "../../shared/logger"
import { createSystemDirective, SystemDirectiveTypes } from "../../shared/system-directive"

export interface SummarizeContext {
  sessionID: string
  providerID: string
  modelID: string
  usageRatio: number
  directory: string
}

const SUMMARIZE_CONTEXT_PROMPT = `${createSystemDirective(SystemDirectiveTypes.COMPACTION_CONTEXT)}

When summarizing this session, you MUST include the following sections in your summary.
Structure forces preservation - each section acts as a checklist preventing information loss.

## 1. User Requests (As-Is)
- List all original user requests exactly as they were stated
- Preserve the user's exact wording and intent
- Include any clarifications or refinements made during the conversation

## 2. Final Goal
- What the user ultimately wanted to achieve
- The end result or deliverable expected
- Success criteria if mentioned

## 3. Files Modified (with details)
- List each file path with what was changed
- Include line ranges for significant changes
- Note file creation vs modification vs deletion
- Example: "src/utils/helper.ts: Added validateInput function (lines 45-78)"

## 4. Key Decisions & Rationale
- Technical decisions made and WHY they were made
- Alternatives considered and why they were rejected
- Trade-offs acknowledged
- This prevents re-exploring already-rejected approaches

## 5. Current Working State
- What is currently working/passing
- Test status if tests were run
- Build status if relevant
- Any partial implementations in progress

## 6. Environment & Tool Outputs Still Needed
- Any tool results that may need to be re-fetched
- File contents that might need re-reading
- External state that was relied upon

## 7. Remaining Tasks
- What still needs to be done (be specific)
- Pending items from the original request
- Follow-up tasks identified during the work
- Blockers or dependencies

## 8. MUST NOT Do (Critical Constraints)
- Things that were explicitly forbidden
- Approaches that FAILED and should NOT be retried
- User's explicit restrictions or preferences
- Anti-patterns identified during the session
- Commands/operations that caused errors

## 9. Important Context
- Any domain-specific knowledge acquired
- Relationships between components discovered
- Quirks or gotchas encountered
- User preferences learned

## 10. Agent Verification State (Critical for Reviewers)
- **Current Agent**: What agent is running (plan-synthesizer, oracle, etc.)
- **Verification Progress**: Files already verified/validated
- **Pending Verifications**: Files still needing verification
- **Previous Rejections**: If reviewer agent, what was rejected and why
- **Acceptance Status**: Current state of review process

This section is CRITICAL for reviewer agents (plan-synthesizer, oracle) to maintain continuity.

This structured context is CRITICAL for maintaining continuity after compaction.
Preserving this information prevents the gradual information loss that occurs with freeform summarization.
`

export function getCompactionContextPrompt(): string {
  return SUMMARIZE_CONTEXT_PROMPT
}

export function createCompactionContextInjector() {
  return async (ctx: SummarizeContext): Promise<void> => {
    log("[compaction-context-injector] injecting context", { sessionID: ctx.sessionID })

    const success = injectHookMessage(ctx.sessionID, SUMMARIZE_CONTEXT_PROMPT, {
      agent: "general",
      model: { providerID: ctx.providerID, modelID: ctx.modelID },
      path: { cwd: ctx.directory },
    }, {
      source: "compaction-context-injector",
      channel: "synthetic-message",
      id: "summarize-context-prompt",
      priority: "high",
    })

    if (success) {
      log("[compaction-context-injector] context injected", { sessionID: ctx.sessionID })
    } else {
      log("[compaction-context-injector] injection failed", { sessionID: ctx.sessionID })
    }
  }
}
