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

- Canonical wiring + ordering: `src/index.ts`
- Hook name enum (configuration surface): `src/config/schema.ts` (`HookNameSchema`)
- Hook implementations: `src/hooks/`
- Claude Code compatibility layer: `src/hooks/claude-code-hooks/`

## Hook Names and Enablement

### `disabled_hooks`

- Configuration key: `disabled_hooks` in `oh-my-opencode.json(c)`.
- Merge rule: user config and project config are merged via **set union** (a hook disabled in either scope is disabled in the final config). See `src/plugin-config.ts`.
- Contract: a hook name present in `disabled_hooks` **MUST** be treated as disabled by `isHookEnabled(...)` checks in `src/index.ts`.

### Important: not every interceptor is a `disabled_hooks` hook

This repo contains lifecycle interceptors that are:

- **Hook-gated** (controlled via `disabled_hooks`), and/or
- **Feature-gated** (controlled via a dedicated config block such as `user_memory` / `org_memory`), and/or
- **Runtime-gated** (requires an OpenCode lifecycle surface to exist), and/or
- **Always-on** by design (invoked unconditionally from `src/index.ts`).

If you need a definitive answer for “can I disable this?”, consult the wiring in `src/index.ts` for an `isHookEnabled("<name>")` guard.

### Reserved-but-not-wired names

Some names exist in `HookNameSchema` but are **not currently wired** in `src/index.ts` (disabling them has no effect).
As of this repo state, the following are present but not wired:

- `compaction-context-injector` (module exists; not integrated)
- `repo-overview-injector` (module exists; not integrated)
- `runtime-tracker` (module exists; not integrated)

If you plan to rely on these, treat them as **non-functional placeholders** until `src/index.ts` integrates them.

## Events and Ordering Contract

Hooks run as explicit, ordered calls inside the OpenCode plugin lifecycle handlers.
Later hooks observe the **post-mutation** state from earlier hooks (e.g., modified tool args).

### `chat.message`

Execution order (simplified to plugin-relevant steps):

1. Keyword detector (if enabled)
2. Claude Code compat layer (if enabled)
3. Governance user-prompt processing (if enabled)
4. Session handoff (if enabled)
5. Auto slashcommand (if enabled)
6. Start-work (if enabled)
7. Multi-plan trigger (if enabled)
8. Planning-with-files (if enabled)
9. Pre-completion verification (if enabled)
10. Stop continuation guard (if enabled)
11. Ralph loop template detection (if enabled)

### `user.prompt.submit`

Execution order:

1. User memory
2. Org memory
3. Session handoff

### `tool.execute.before`

Execution order (high-level):

1. Question label truncator
2. Subagent question blocker
3. User memory
4. Org memory
5. Claude Code compat layer (if enabled)
6. Non-interactive env (if enabled)
7. Comment checker (if enabled)
8. Directory AGENTS injector (if enabled)
9. Directory README injector (if enabled)
10. Rules injector (if enabled)
11. Prometheus MD-only (if enabled)
12. Planning-with-files (if enabled)
13. Delegation validator (if enabled)
14. Sisyphus-junior notepad (if enabled)
15. Tmux parallel agents (if enabled)
16. Swarm agent (if enabled)
17. Conditional rules (if enabled; special handling for `delegate_task`)
18. Ralph loop start/cancel (if enabled; special handling for `slashcommand`)
19. Governance pre-tool checks (if enabled)
20. Silent tool output pre-hook (if enabled)

### `tool.execute.after`

Execution order (high-level):

1. Planning-with-files (if enabled)
2. Claude Code compat layer (if enabled)
3. Anti-slop enforcer (if enabled)
4. Silent tool output post-hook (if enabled)
5. Tool output truncator (if enabled)
6. Governance post-tool processing (if enabled)
7. User memory
8. Org memory
9. Context window monitor (if enabled)
10. Preemptive compaction (if enabled)
11. Comment checker (if enabled)
12. Directory AGENTS injector (if enabled)
13. Directory README injector (if enabled)
14. Rules injector (if enabled)
15. Empty-task response detector (if enabled)
16. Agent usage reminder (if enabled)
17. Category skill reminder (if enabled)
18. Interactive bash session (if enabled)
19. Edit error recovery (if enabled)
20. Delegate-task retry (if enabled)
21. Atlas orchestration (if enabled)
22. Task resume info (always wired)
23. Session handoff (if enabled)
24. Swarm agent (if enabled)

### `event`

The generic OpenCode `event` stream is used to drive “Stop-like” behavior and background lifecycle management.
Ordering is defined in `src/index.ts` and includes (not exhaustive): stop continuation guard, auto update checker, Claude Code compat, notifications, session recovery, planning-with-files, context monitors, idle loops, and orchestrator hooks.

### `experimental.chat.messages.transform`

This experimental lifecycle surface is used for message-level transforms, including context injection and thinking-block validation. See `src/index.ts`.

## Claude Code Compatibility Mapping

This repo uses two hook vocabularies:

- **OpenCode lifecycle handlers** (the runtime surface wired in `src/index.ts`).
- **Claude Code hook types** (a compatibility model implemented by `claude-code-hooks`).

Mapping (Claude Code hook type → intended OpenCode surface):

| Claude Code hook type | Intended OpenCode surface | Implementation | Status |
|---|---|---|---|
| `PreToolUse` | `tool.execute.before` | `src/hooks/claude-code-hooks/pre-tool-use.ts` | Wired via explicit calls in `src/index.ts` |
| `PostToolUse` | `tool.execute.after` | `src/hooks/claude-code-hooks/post-tool-use.ts` | Wired via explicit calls in `src/index.ts` |
| `UserPromptSubmit` | `chat.message` | `src/hooks/claude-code-hooks/user-prompt-submit.ts` | Wired via explicit calls in `src/index.ts` |
| `Stop` | `event(type="session.idle")` | `src/hooks/claude-code-hooks/stop.ts` | Wired via explicit calls in `src/index.ts` |
| `PreCompact` | `experimental.session.compacting` | `src/hooks/claude-code-hooks/pre-compact.ts` | Implemented, **not currently wired** (OpenCode surface not integrated) |

### Claude Code extended config (`opencode-cc-plugin.json`)

The Claude Code compat layer additionally supports an **extended config file** for command-pattern based disabling:

- User scope: `<OpenCodeConfigDir>/opencode-cc-plugin.json`
- Project scope: `.opencode/opencode-cc-plugin.json`

See `src/hooks/claude-code-hooks/config-loader.ts`.

## See Also

- Journey: `docs/journeys/operations-and-debugging.md`
- Journey: `docs/journeys/extensibility.md`
- Config contract: `docs/reference/configuration.md`
