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

- Configuration key: `disabled_hooks` in `oh-my-opencode/*.json`.
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
unstable-agent-watchdog
session-state-repair
session-notification
comment-checker
directory-agents-injector
directory-readme-injector
empty-task-response-detector
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
start-work
swarm-from-plan
work-orchestrator
silent-tool-output
context-manifest-injector
repo-overview-injector
codemap-injector
runtime-tracker
anti-slop-enforcer
pre-completion-verification
orchestrator-contextual-injector
delegation-validate-decision
conditional-rules
session-handoff
question-label-truncator
delegation-nudge-category-skill
specialist-notepad
tmux-parallel-agents
swarm-agent
anthropic-effort
cache-policy
```

Notes:
- `anthropic-effort` is executed on `chat.params` outside runtime dispatcher ordering.
- `cache-policy` is executed on `chat.params` outside runtime dispatcher ordering.
- `task-resume-info` is an internal node (`internal:task-resume-info`) and is intentionally not part of `HookNameSchema`.

### Reserved-but-not-wired names

Runtime wiring is validated at startup (`schema ↔ registry ↔ order` consistency check). In normal startup, a schema hook that is declared but not wired will fail fast instead of silently drifting.

## Events and Ordering Contract

Hooks are executed as event-scoped runtime nodes and ordered by `EVENT_TOTAL_ORDER`.
Later hooks observe the **post-mutation** state from earlier hooks (e.g., modified tool args).

Runtime dispatcher uses the ordered runtime-node graph defined in `src/hooks/runtime/pipeline-order.ts`.

Failure policy defaults:

- `tool.execute.before`: `fail-closed`
- All other runtime-dispatched events in `EVENT_TOTAL_ORDER`: `fail-open`
- Per-node override is allowed via runtime node policy

### `chat.message`

Execution order (simplified to plugin-relevant steps):

1. Session agent tracking (internal)
2. First-message variant gate (internal)
3. Keyword detector (if enabled)
4. orchestrator contextual injector (if enabled)
5. Policy observe (internal, fail-open)
6. Claude Code bridge node (if enabled)
7. Governance user-prompt processing (if enabled)
8. Session handoff (if enabled)
9. Auto slashcommand (if enabled)
10. Policy enforce (internal, hard decisions can block)
11. Start-work (if enabled)
12. Swarm-from-plan (if enabled; Swarm-first bootstrap)
13. Work-orchestrator (if enabled)
14. Pre-completion verification (if enabled)
15. Ralph loop template detection (if enabled)

### `chat.params`

Execution order:

1. Policy observe (internal)
2. `anthropic-effort` (if enabled)
3. `cache-policy` (if enabled)
4. Policy enforce (internal)

Notes:

- `chat.params` nodes are executed directly in `src/index.ts` and are intentionally outside `EVENT_TOTAL_ORDER` runtime dispatcher wiring.
- Runtime also applies contract budget/model hints on this surface (`reasoning_budget` + model policy metadata) before policy-enforce.
- `cache-policy` performs observe/enforce decisioning and may mutate `output.options` only in enforce mode when provider capability + rollout gates allow it.
- `cache-policy` remains hook-gated by `disabled_hooks` (`cache-policy`) even though it is not part of runtime dispatcher ordering.

### `user.prompt.submit`

Execution order:

1. User memory
2. Org memory
3. Session handoff

### `command.execute.before`

Execution order:

1. `auto-slash-command` command pre-handler (if runtime surface is available and hook is enabled)

Notes:
- This lifecycle surface is wired only when OpenCode version is at least `OPENCODE_COMMAND_EXECUTE_BEFORE_HOOK_VERSION`.
- Current pipeline has a single runtime node for this event.

### `chat.headers`

Execution order:

1. `internal:copilot-anthropic-beta:chat.headers` (GitHub Copilot provider + Anthropic/Copilot Claude model path)
2. `internal:copilot-subagent-initiator:chat.headers` (GitHub Copilot provider + subagent session)

Notes:
- Both nodes are conditionally assembled in `src/index.ts`.
- Current behavior is additive header mutation (`anthropic-beta` token append, `x-initiator=agent` for subagent requests).

### `shell.env`

Execution order:

1. `internal:non-interactive-env:shell.env` (when non-interactive env support is enabled)

Notes:
- The hook merges predefined non-interactive env keys into `output.env`.
- This lifecycle surface is wired only when OpenCode version is at least `OPENCODE_SHELL_ENV_HOOK_VERSION`.

### `tool.execute.before`

Execution order (high-level):

1. Question label truncator
2. User memory
3. Org memory
4. Runtime tracker (if enabled)
5. Policy observe (internal, fail-open)
6. Claude Code bridge node (if enabled)
7. Non-interactive env (if enabled)
8. Comment checker (if enabled)
9. Directory AGENTS injector (if enabled)
10. Directory README injector (if enabled)
11. Rules injector (if enabled)
12. Work-orchestrator (planning + execution pre-tool logic, if enabled)
13. orchestrator contextual injector (if enabled)
14. `delegation-validate-decision` (if enabled)
15. Orchestrator-junior notepad (if enabled)
16. Tmux parallel agents (if enabled)
17. Swarm agent (if enabled)
18. Conditional rules (if enabled; special handling for `delegate_task`)
19. Context manifest injector (if enabled)
20. Task-tool sanitizer (internal)
21. Ralph loop start/cancel (if enabled; special handling for `slashcommand`)
22. Stop-continuation slash handling (internal)
23. Policy enforce (internal, hard decisions can block)
24. Governance pre-tool checks (if enabled)
25. Silent tool output pre-hook (if enabled)

Note:
- `tmux-parallel-agents` is a workspace/process orchestration hook (worktree/window lifecycle and rescue UX).
- Global concurrency admission is provided by `parallel_runtime`, not by this hook.
- `tmux-parallel-agents` uses tmux metadata (`@omo_*`) in `event(session.created/deleted/idle)` for recovery and cleanup, and manages lifecycle by stable `window_id/pane_id`.
- On background-task paths, the hook prioritizes precise mapping via internal correlation (`__tmux_task_id` -> `BackgroundTask.tmuxTaskId`), then falls back to title/FIFO matching when needed.
- `work-orchestrator` now computes verifier guard payload (`payload.guards.verifier.*`) for `task_transition(next_state=completed)`; policy hard clauses can deny completion before governance pre-tool.

### `tool.execute.after`

Execution order (high-level):

1. Work-orchestrator (planning + execution post-tool logic, if enabled)
2. Policy observe (internal, fail-open)
3. Claude Code bridge node (if enabled)
4. Anti-slop enforcer (if enabled)
5. Silent tool output post-hook (if enabled)
6. Runtime tracker (if enabled)
7. Repo overview injector (if enabled)
8. Policy enforce (internal, hard decisions can block)
9. Governance post-tool processing (if enabled)
10. User memory
11. Org memory
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
22. Task resume info (always wired)
23. Session handoff (if enabled)
24. Swarm agent (if enabled)

### `event`

The generic OpenCode `event` stream is used to drive lifecycle, continuation, and background management.
Ordering is defined in `src/hooks/runtime/pipeline-order.ts` and includes `work-orchestrator:event` (unified planning/continuation/lifecycle phase handling), update checker, Claude Code bridge, notifications, `task-auto-continuation`, `unstable-agent-watchdog`, **orchestrator-contextual-injector**, and internal core session-state/session-state-repair nodes.

`session-state-repair` recoverable classes currently include:

- `tool_result_missing` (with revert fallback when tool_result injection is rejected)
- thinking-block ordering/disabled violations
- `assistant_prefill_unsupported`

Notes:
- `session-state-repair` is wired as an internal runtime node on `event(type="session.error")`, not as a standalone OpenCode hook surface.
- For `assistant_prefill_unsupported`, the runtime sends a best-effort `continue` for the main session to unstick the conversation.
- Auto handoff trigger signals are sourced from `work-orchestrator` runtime state:
  - consecutive verifier denials,
  - consecutive policy context-pressure hits,
  - consecutive continuation prompt failures.
  When thresholds are reached, `work-orchestrator` calls `session-handoff.requestAutoHandoff(...)`. Continuation stop is applied only when a new session is actually launched.

### `experimental.chat.messages.transform`

This experimental lifecycle surface is used for message-level transforms, including context injection and thinking-block validation. See `src/index.ts`.

### ContextView Budget Gating

All model-visible context additions are gated by a shared ContextView budget layer (`src/features/context-view/`).

Injection paths:

- `ContextCollector.register()` (messages-transform path)
- `injectHookMessage()` (synthetic-message path)
- `appendBudgetedOutput()` (tool-output/chat-message/delegate-prompt/session-prompt append path)
- `pushBudgetedContext()` (`experimental.session.compacting` context arrays)
- `injectBudgetedPrompt()` (`delegate-prompt` rewrites on `tool.execute.before`)
- Direct budget decisions for hook-local flows that need custom pre/post handling.

See `docs/reference/configuration.md` for user-facing budget profile settings.

### `experimental.session.compacting`

Compaction-time ordering:

1. Policy observe node (`internal:policy-observe:experimental.session.compacting`, fail-open)
2. Claude Code bridge node (`PreCompact`, if enabled and event payload supports context)
3. Policy enforce node (`internal:policy-enforce:experimental.session.compacting`, fail-closed for hard denies; supports context mutation via policy modify)

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
| `PreCompact` | `experimental.session.compacting` | `src/hooks/claude-code-hooks/pre-compact.ts` | Wired as the middle bridge node in policy-wrapped compaction order (best-effort; depends on runtime support) |

### Claude Code extended config (`opencode-cc-plugin.json`)

The Claude Code compat layer additionally supports an **extended config file** for command-pattern based disabling:

- User scope: `<OpenCodeConfigDir>/opencode-cc-plugin.json`
- Project scope: `.opencode/opencode-cc-plugin.json`

See `src/hooks/claude-code-hooks/config-loader.ts`.

## See Also

- Journey: `docs/journeys/operations-and-debugging.md`
- Journey: `docs/journeys/extensibility.md`
- Config contract: `docs/reference/configuration.md`
