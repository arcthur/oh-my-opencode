# HOOKS KNOWLEDGE BASE

## OVERVIEW

Hook collection intercepting/modifying agent behavior across multiple lifecycle events.

**Source of truth**: `src/index.ts` (the call order in the plugin event handlers).

## STRUCTURE

```
hooks/
├── execution-orchestrator/     # Execution-mode orchestration protocols (uses work-state)
├── planning-with-files/        # Manus-style planning (uses work-state)
├── start-work/                 # Session initialization (uses work-state)
├── context-window-governor/    # Unified context window governance (warn/preemptive/recovery/inject)
├── todo-continuation-enforcer.ts # Force TODO completion
├── ralph-loop/                 # Self-referential dev loop until done
├── claude-code-hooks/          # settings.json hook compat layer (13 files)
├── comment-checker/            # Prevents AI slop/excessive comments
├── auto-slash-command/         # Detects /command patterns
├── rules-injector/             # Conditional rules from .claude/rules/
├── directory-agents-injector/  # Auto-injects AGENTS.md files
├── directory-readme-injector/  # Auto-injects README.md files
├── edit-error-recovery/        # Recovers from tool failures
├── delegate-task-retry/        # Retries failed delegations
├── thinking-block-validator/   # Ensures valid <thinking> format
├── session-recovery/           # Auto-recovers from crashes
├── think-mode/                 # Dynamic thinking budget
├── keyword-detector/           # ultrawork/search/analyze modes
├── question-label-truncator/   # Truncates question option labels
├── subagent-question-blocker/  # Blocks question tool for subagent sessions
├── write-existing-file-guard/  # Blocks write tool for existing files
├── prometheus-md-only/         # Planner read-only mode
├── sisyphus-junior-notepad/    # Injects notepad context for Junior tasks
├── agent-usage-reminder/       # Nudges to use specialized agents/tools
├── category-skill-reminder/    # Reminds orchestrators of category+skills
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

**chat.message** (high-level): keywordDetector → claudeCodeHooks → sessionHandoffHook → autoSlashCommand → startWork → swarmFromPlan → multiPlanTrigger → planningWithFiles → preCompletionVerification → stopContinuationGuard → (ralphLoop start/cancel)

**tool.execute.before** (high-level): questionLabelTruncator → subagentQuestionBlocker → writeExistingFileGuard → user/org memory → claudeCodeHooks → nonInteractiveEnv → commentChecker → directoryAgentsInjector → directoryReadmeInjector → rulesInjector → prometheusMdOnly → planningWithFiles → delegationValidator → sisyphusJuniorNotepad → executionOrchestratorHook → tmuxParallelAgents → swarmAgent → silentToolOutput

**tool.execute.after** (high-level): planningWithFiles → claudeCodeHooks → antiSlopEnforcer → silentToolOutput → toolOutputTruncator → user/org memory → contextWindowGovernor → commentChecker → directoryAgentsInjector → directoryReadmeInjector → rulesInjector → emptyTaskResponseDetector → agentUsageReminder → categorySkillReminder → interactiveBashSession → editErrorRecovery → delegateTaskRetry → executionOrchestratorHook → taskResumeInfo → sessionHandoffHook → swarmAgent

Notes:
- Conditional rules and governance add additional per-tool logic inside these handlers (see `src/index.ts`).
- Order is intentionally tuned to avoid context bloat and ensure safety checks run before mutating tool args.

## HOW TO ADD

1. Create `src/hooks/name/` with `index.ts` exporting `createMyHook(ctx)`
2. Implement event handlers: `"tool.execute.before"`, `"tool.execute.after"`, etc.
3. Add hook name to `HookNameSchema` in `src/config/schema.ts`
4. Register in `src/index.ts`:
   ```typescript
   const myHook = isHookEnabled("my-hook") ? createMyHook(ctx) : null
   // Add to event handlers
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
