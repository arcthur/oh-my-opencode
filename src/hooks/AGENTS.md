# HOOKS KNOWLEDGE BASE

## OVERVIEW

Hook collection intercepting/modifying agent behavior across multiple lifecycle events.

**Source of truth**: `src/hooks/runtime/pipeline-order.ts` (order), `src/hooks/runtime/assembly/*.ts` (event node assembly), `src/index.ts` (lifecycle wrapper + dispatch).

## STRUCTURE

```
hooks/
├── execution-orchestrator/     # Execution-mode orchestration protocols (uses work-state)
├── planning-with-files/        # Manus-style planning (uses work-state)
├── start-work/                 # Session initialization (uses work-state)
├── context-window-governor/    # Unified context window governance (warn/preemptive/recovery/inject)
├── task-auto-continuation.ts   # Force task completion
├── ralph-loop/                 # Self-referential dev loop until done
├── claude-code-hooks/          # settings.json hook compat layer (13 files)
├── comment-checker/            # Prevents AI slop/excessive comments
├── auto-slash-command/         # Detects /command patterns
├── rules-injector/             # Conditional rules from .claude/rules/
├── directory-agents-injector/  # Auto-injects AGENTS.md files
├── directory-readme-injector/  # Auto-injects README.md files
├── edit-failure-guidance/       # Recovers from Edit tool failures
├── delegation-failure-guidance/ # Retries failed delegations
├── thinking-block-validator/   # Ensures valid <thinking> format
├── session-state-repair/        # Auto-recovers from crashes
├── think-mode/                 # Dynamic thinking budget
├── keyword-detector/           # ultrawork/search/analyze modes
├── question-label-truncator/   # Truncates question option labels
├── delegation-block-subagent-question/ # Blocks question tool for subagent sessions
├── write-existing-file-guard/  # Blocks write tool for existing files
├── prometheus-md-only/         # Planner read-only mode
├── sisyphus-junior-notepad/    # Injects notepad context for Junior tasks
├── delegation-nudge-agent-usage/ # Nudges to use specialized agents/tools
├── delegation-nudge-category-skill/ # Reminds orchestrators of category+skills
├── continuation-stop-guard/    # Stops auto-continuation per session
├── non-interactive-env/        # Non-TTY environment handling
├── interactive-bash-session/   # Interactive bash session management
├── background-notification/    # OS notification on task completion
└── tool-output-truncator.ts    # Prevents context bloat
```

This list is intentionally **non-exhaustive**. See `src/hooks/` for the full set of hooks in this fork.

## HOOK EVENTS

| Event | Timing | Can Block | Use Case |
|-------|--------|-----------|----------|
| `chat.message` | On user message | Yes | Keyword detection, slash commands, work session bootstrap |
| `tool.execute.before` | Before tool | Yes | Validate/modify tool args, inject context |
| `tool.execute.after` | After tool | No | Append warnings, truncate output, recovery |
| `event` | Session lifecycle | No | Cleanup + background handlers |
| `experimental.session.compacting` | Compaction | No | Compaction context injection |

## EXECUTION ORDER

**chat.message** (high-level): keywordDetector → claudeCodeHooks → sessionHandoffHook → autoSlashCommand → startWork → swarmFromPlan → multiPlanTrigger → planningWithFiles → preCompletionVerification → continuationStopGuard → (ralphLoop start/cancel)

**tool.execute.before** (high-level): questionLabelTruncator → delegationBlockSubagentQuestion → writeExistingFileGuard → user/org memory → claudeCodeHooks → nonInteractiveEnv → commentChecker → directoryAgentsInjector → directoryReadmeInjector → rulesInjector → prometheusMdOnly → planningWithFiles → delegationValidateDecision → sisyphusJuniorNotepad → executionOrchestratorHook → tmuxParallelAgents → swarmAgent → silentToolOutput

**tool.execute.after** (high-level): planningWithFiles → claudeCodeHooks → antiSlopEnforcer → silentToolOutput → toolOutputTruncator → user/org memory → contextWindowGovernor → commentChecker → directoryAgentsInjector → directoryReadmeInjector → rulesInjector → emptyTaskResponseDetector → delegationNudgeAgentUsage → delegationNudgeCategorySkill → interactiveBashSession → editFailureGuidance → delegationFailureGuidance → executionOrchestratorHook → taskResumeInfo → sessionHandoffHook → swarmAgent

Notes:
- Conditional rules and governance add additional per-tool logic in runtime assembly builders and lifecycle wrappers (see `src/hooks/runtime/assembly/` and `src/index.ts`).
- Order is intentionally tuned to avoid context bloat and ensure safety checks run before mutating tool args.
- Delegation chain uses explicit progression: `block -> validate -> nudge`.

## HOW TO ADD

1. Create `src/hooks/name/` with `index.ts` exporting `createMyHook(ctx)`
2. Implement event handlers: `"tool.execute.before"`, `"tool.execute.after"`, etc.
3. Add hook name to `HookNameSchema` in `src/config/schema.ts`
4. Register in runtime wiring:
   ```typescript
   const myHook = isHookEnabled("my-hook") ? createMyHook(ctx) : null
   // Add to RuntimeAssemblyContext in src/index.ts
   // Add node assembly in src/hooks/runtime/assembly/<event>.ts
   ```

## PATTERNS

- **Session-scoped state**: `Map<sessionID, Set<string>>` for tracking per-session
- **Conditional execution**: Check `input.tool` before processing
- **Output modification**: `output.output += "\n${REMINDER}"` to append context
- **Async state**: Use promises for CLI path resolution, cache results

## ANTI-PATTERNS

- **Blocking non-critical**: Use PostToolUse warnings instead of PreToolUse blocks
- **Heavy computation**: Keep PreToolUse light - slows every tool call
- **Redundant injection**: Track injected files to prevent duplicates
- **Verbose output**: Keep hook messages technical, brief
