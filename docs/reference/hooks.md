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
- Canonical event node registration: `src/index.ts`
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

### Reserved-but-not-wired names

Runtime wiring is validated at startup (`schema ↔ registry ↔ order` consistency check). In normal startup, a schema hook that is declared but not wired will fail fast instead of silently drifting.

## Events and Ordering Contract

Hooks are executed as event-scoped runtime nodes and ordered by `EVENT_TOTAL_ORDER`.
Later hooks observe the **post-mutation** state from earlier hooks (e.g., modified tool args).

Runtime modes:

- `experimental.hook_runtime_v2.enabled=false`: legacy execution path (still built from the same node list)
- `experimental.hook_runtime_v2.mode="shadow"`: executes legacy path, compares against runtime order, logs mismatches
- `experimental.hook_runtime_v2.mode="enforce"`: runtime dispatcher order is authoritative

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
11. Multi-plan trigger (if enabled)
12. Planning-with-files (if enabled)
13. Pre-completion verification (if enabled)
14. Stop continuation guard (if enabled)
15. Ralph loop template detection (if enabled)

### `user.prompt.submit`

Execution order:

1. User memory
2. Org memory
3. Session handoff

### `tool.execute.before`

Execution order (high-level):

1. Question label truncator
2. Subagent question blocker
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
15. Delegation validator (if enabled)
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
11. Preemptive compaction (if enabled)
12. Context window monitor (if enabled)
13. Comment checker (if enabled)
14. Directory AGENTS injector (if enabled)
15. Directory README injector (if enabled)
16. Rules injector (if enabled)
17. Empty-task response detector (if enabled)
18. Agent usage reminder (if enabled)
19. Category skill reminder (if enabled)
20. Interactive bash session (if enabled)
21. Edit error recovery (if enabled)
22. Delegate-task retry (if enabled)
23. execution-orchestrator hook (if enabled)
24. Task resume info (always wired)
25. Session handoff (if enabled)
26. Swarm agent (if enabled)

### `event`

The generic OpenCode `event` stream is used to drive “Stop-like” behavior and background lifecycle management.
Ordering is defined in `src/hooks/runtime/pipeline-order.ts` and includes: stop continuation guard, update checker, Claude Code bridge, notifications, planning/lifecycle hooks, orchestrators, plus internal core session-state and session-recovery nodes.

### `experimental.chat.messages.transform`

This experimental lifecycle surface is used for message-level transforms, including context injection and thinking-block validation. See `src/index.ts`.

### `experimental.session.compacting`

Compaction-time ordering:

1. Claude Code bridge node (`PreCompact`, if enabled and event payload supports context)
2. Compaction context injector (internal)

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
