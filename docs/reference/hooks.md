# Contract: Hooks

This document is a **normative contract** for hook wiring in this repo.

## Normative Language

The keywords **MUST**, **MUST NOT**, **SHOULD**, **SHOULD NOT**, and **MAY** are to be interpreted as described in RFC 2119.

## Scope

This document defines:

- The **hook naming surface** (what you can reference in configuration).
- The **event wiring and ordering contract** (what runs, when, and in what order).
- The **Claude Code compatibility mapping** and its limitations.

This document does **not** define each hook’s internal prompt text or heuristics (those live in code).

## Source of Truth

- Canonical runtime order tables: `src/hooks/runtime/pipeline-order.ts` (`EVENT_TOTAL_ORDER`)
- Canonical dispatch behavior + failure policy: `src/hooks/runtime/dispatcher.ts`
- Canonical event node assembly: `src/hooks/runtime/assembly/*.ts`
- Canonical lifecycle dispatch entrypoints: `src/index.ts`
- Hook name enum (configuration surface): `src/config/schema.ts` (`HookNameSchema`)
- Hook implementations: `src/hooks/`
- Claude Code compatibility layer: `src/hooks/claude-code-hooks/`

## Hook Names and Enablement

### `disabled_hooks`

- Configuration key: `disabled_hooks` in `oh-my-opencode.json(c)`.
- Merge rule: user config and project config are merged via **set union** (a hook disabled in either scope is disabled in the final config). See `src/plugin-config.ts`.
- Contract: a hook name present in `disabled_hooks` **MUST** be treated as disabled by `isHookEnabled(...)` checks in `src/index.ts`.
- Compatibility alias: `claude_code.hooks=false` disables the Claude Code bridge (`claude-code-hooks`) across events.
- Conflict rule: when `disabled_hooks` and `claude_code.hooks` conflict, **disabled wins**.

### Important: not every interceptor is a `disabled_hooks` hook

This repo contains lifecycle interceptors that are:

- **Hook-gated** (controlled via `disabled_hooks`), and/or
- **Feature-gated** (controlled via a dedicated config block such as `user_memory` / `org_memory`), and/or
- **Runtime-gated** (requires an OpenCode lifecycle surface to exist), and/or
- **Always-on** by design (invoked unconditionally from `src/index.ts`).

If you need a definitive answer for “can I disable this?”, consult the wiring in `src/index.ts` for an `isHookEnabled("<name>")` guard.

### Hook name surface (`HookNameSchema`)

`disabled_hooks` accepts only names defined in `src/config/schema.ts`:

```text
task-auto-continuation
context-window-governor
session-state-repair
session-notification
comment-checker
tool-output-truncator
directory-agents-injector
directory-readme-injector
empty-task-response-detector
think-mode
rules-injector
background-notification
auto-update-checker
startup-toast
keyword-detector
delegation-nudge-agent-usage
non-interactive-env
interactive-bash-session
thinking-block-validator
ralph-loop
claude-code-hooks
auto-slash-command
edit-failure-guidance
delegation-failure-guidance
prometheus-md-only
start-work
swarm-from-plan
execution-orchestrator
planning-with-files
silent-tool-output
context-manifest-injector
repo-overview-injector
runtime-tracker
anti-slop-enforcer
pre-completion-verification
delegation-validate-decision
conditional-rules
session-handoff
question-label-truncator
delegation-block-subagent-question
write-existing-file-guard
continuation-stop-guard
delegation-nudge-category-skill
sisyphus-junior-notepad
tmux-parallel-agents
swarm-agent
anthropic-effort
```

Notes:
- `anthropic-effort` is executed on `chat.params` outside runtime dispatcher ordering.
- `task-resume-info` is an internal node (`internal:task-resume-info`) and is intentionally not part of `HookNameSchema`.

### Reserved-but-not-wired names

Runtime wiring is validated at startup (`schema ↔ registry ↔ order` consistency check). In normal startup, a schema hook that is declared but not wired will fail fast instead of silently drifting.

## Events and Ordering Contract

Hooks are executed as event-scoped runtime nodes and ordered by `EVENT_TOTAL_ORDER`.
Later hooks observe the **post-mutation** state from earlier hooks (e.g., modified tool args).

Runtime dispatcher uses the ordered runtime-node graph defined in `src/hooks/runtime/pipeline-order.ts`.

Failure policy defaults:

- `tool.execute.before`: `fail-closed`
- `event`, `tool.execute.after`, `chat.message`, `experimental.session.compacting`: `fail-open`
- Per-node override is allowed via runtime node policy

### `chat.message`

Execution order (simplified to plugin-relevant steps):

1. Session agent tracking (internal)
2. First-message variant gate (internal)
3. Think-mode chat params (if enabled)
4. Keyword detector (if enabled)
5. Claude Code bridge node (if enabled)
6. Governance user-prompt processing (if enabled)
7. Session handoff (if enabled)
8. Auto slashcommand (if enabled)
9. Start-work (if enabled)
10. Swarm-from-plan (if enabled; Swarm-first bootstrap)
11. Planning-with-files (if enabled)
12. Pre-completion verification (if enabled)
13. `continuation-stop-guard` (if enabled)
14. Ralph loop template detection (if enabled)

### `user.prompt.submit`

Execution order:

1. User memory
2. Org memory
3. Session handoff

### `tool.execute.before`

Execution order (high-level):

1. Question label truncator
2. `delegation-block-subagent-question`
3. Write existing file guard (if enabled)
4. User memory
5. Org memory
6. Runtime tracker (if enabled)
7. Claude Code bridge node (if enabled)
8. Non-interactive env (if enabled)
9. Comment checker (if enabled)
10. Directory AGENTS injector (if enabled)
11. Directory README injector (if enabled)
12. Rules injector (if enabled)
13. Prometheus MD-only (if enabled)
14. Planning-with-files (if enabled)
15. `delegation-validate-decision` (if enabled)
16. Sisyphus-junior notepad (if enabled)
17. execution-orchestrator hook (if enabled)
18. Tmux parallel agents (if enabled)
19. Swarm agent (if enabled)
20. Conditional rules (if enabled; special handling for `delegate_task`)
21. Context manifest injector (if enabled)
22. Task-tool sanitizer (internal)
23. Ralph loop start/cancel (if enabled; special handling for `slashcommand`)
24. Stop-continuation slash handling (internal)
25. Governance pre-tool checks (if enabled)
26. Silent tool output pre-hook (if enabled)

Note:
- `tmux-parallel-agents` is a workspace/process orchestration hook (worktree/window lifecycle and rescue UX).
- Global concurrency admission is provided by `parallel_runtime`, not by this hook.
- `tmux-parallel-agents` uses tmux metadata (`@omo_*`) in `event(session.created/deleted/idle)` for recovery and cleanup, and manages lifecycle by stable `window_id/pane_id`.
- On background-task paths, the hook prioritizes precise mapping via internal correlation (`__tmux_task_id` -> `BackgroundTask.tmuxTaskId`), then falls back to title/FIFO matching when needed.

### `tool.execute.after`

Execution order (high-level):

1. Planning-with-files (if enabled)
2. Claude Code bridge node (if enabled)
3. Anti-slop enforcer (if enabled)
4. Silent tool output post-hook (if enabled)
5. Tool output truncator (if enabled)
6. Runtime tracker (if enabled)
7. Repo overview injector (if enabled)
8. Governance post-tool processing (if enabled)
9. User memory
10. Org memory
11. Context-window-governor (if enabled; warning / preemptive / recovery arbitration)
12. Comment checker (if enabled)
13. Directory AGENTS injector (if enabled)
14. Directory README injector (if enabled)
15. Rules injector (if enabled)
16. Empty-task response detector (if enabled)
17. `delegation-nudge-agent-usage` (if enabled)
18. `delegation-nudge-category-skill` (if enabled)
19. Interactive bash session (if enabled)
20. `edit-failure-guidance` (if enabled)
21. `delegation-failure-guidance` (if enabled)
22. execution-orchestrator hook (if enabled)
23. Task resume info (always wired)
24. Session handoff (if enabled)
25. Swarm agent (if enabled)

### `event`

The generic OpenCode `event` stream is used to drive “Stop-like” behavior and background lifecycle management.
Ordering is defined in `src/hooks/runtime/pipeline-order.ts` and includes: continuation stop guard, update checker, Claude Code bridge, notifications, planning/lifecycle hooks, orchestrators, plus internal core session-state and session-state-repair nodes.

`session-state-repair` recoverable classes currently include:

- `tool_result_missing` (with revert fallback when tool_result injection is rejected)
- thinking-block ordering/disabled violations
- `assistant_prefill_unsupported`

Notes:
- `session-state-repair` is wired as an internal runtime node on `event(type="session.error")`, not as a standalone OpenCode hook surface.
- For `assistant_prefill_unsupported`, the runtime sends a best-effort `continue` for the main session to unstick the conversation.

### `experimental.chat.messages.transform`

This experimental lifecycle surface is used for message-level transforms, including context injection and thinking-block validation. See `src/index.ts`.

### Context Budget Gating

All model-visible context additions are gated by a shared `ContextBudgetArbiter` singleton (`src/features/context-budget/`).

Injection paths:

- `ContextCollector.register()` (messages-transform path)
- `injectHookMessage()` (synthetic-message path)
- `appendBudgetedOutput()` (tool-output/chat-message/delegate-prompt/session-prompt append path)
- `pushBudgetedContext()` (`experimental.session.compacting` context arrays)
- `injectBudgetedPrompt()` (`delegate-prompt` rewrites on `tool.execute.before`)
- Direct `arbiter.decide()` for hook-local flows that need custom pre/post handling

Runtime guardrail: `src/features/context-budget/raw-output-append-guard.test.ts` prevents raw `output.output += ...` style appends in guarded hook surfaces so budgeted append helpers remain the default.

See `docs/reference/configuration.md` § Context Budget for user-facing config.

### `experimental.session.compacting`

Compaction-time ordering:

1. Claude Code bridge node (`PreCompact`, if enabled and event payload supports context)
2. `context-window-governor` compaction hook (if enabled)

## Claude Code Compatibility Mapping

This repo uses two hook vocabularies:

- **OpenCode lifecycle handlers** (the runtime surface wired in `src/index.ts`).
- **Claude Code hook types** (a compatibility model implemented by `claude-code-hooks`).

Mapping (Claude Code hook type → intended OpenCode surface):

| Claude Code hook type | Intended OpenCode surface | Implementation | Status |
|---|---|---|---|
| `PreToolUse` | `tool.execute.before` | `src/hooks/claude-code-hooks/pre-tool-use.ts` | Wired as a bridge node in runtime order |
| `PostToolUse` | `tool.execute.after` | `src/hooks/claude-code-hooks/post-tool-use.ts` | Wired as a bridge node in runtime order |
| `UserPromptSubmit` | `chat.message` | `src/hooks/claude-code-hooks/user-prompt-submit.ts` | Wired as a bridge node in runtime order |
| `Stop` | `event(type="session.idle")` | `src/hooks/claude-code-hooks/stop.ts` | Wired as a bridge node in runtime order |
| `PreCompact` | `experimental.session.compacting` | `src/hooks/claude-code-hooks/pre-compact.ts` | Wired as a bridge node in compaction order (best-effort; depends on runtime support) |

### Claude Code extended config (`opencode-cc-plugin.json`)

The Claude Code compat layer additionally supports an **extended config file** for command-pattern based disabling:

- User scope: `<OpenCodeConfigDir>/opencode-cc-plugin.json`
- Project scope: `.opencode/opencode-cc-plugin.json`

See `src/hooks/claude-code-hooks/config-loader.ts`.

## See Also

- Journey: `docs/journeys/operations-and-debugging.md`
- Journey: `docs/journeys/extensibility.md`
- Config contract: `docs/reference/configuration.md`
