# Contract: Commands

This document is a **normative contract** for slash-command naming, discovery, and execution surfaces in this repo.

## Normative Language

The keywords **MUST**, **MUST NOT**, **SHOULD**, **SHOULD NOT**, and **MAY** are to be interpreted as described in RFC 2119.

## Scope

This document defines:

- Built-in slash command names and template sources.
- Command discovery sources and precedence.
- Disable/merge behavior for built-in commands.
- Runtime invocation surfaces (`slashcommand` tool and auto-slash lifecycle).

This document does **not** restate every command template body (those live in `src/features/builtin-commands/templates/`).

## Source of Truth

- Built-in command definitions: `src/features/builtin-commands/commands.ts`
- Built-in command type surface: `src/features/builtin-commands/types.ts`
- Config schema surface: `src/config/schema.ts` (`BuiltinCommandNameSchema`)
- Command discovery catalog: `src/shared/slash-command-catalog.ts`
- Slashcommand tool behavior: `src/tools/slashcommand/tools.ts`
- Runtime wiring for command lifecycle events: `src/index.ts`, `src/hooks/runtime/pipeline-order.ts`

## Built-in Command Names

Built-in command names surfaced by `BuiltinCommandNameSchema`:

- `/brainstorm`
- `/init-deep`
- `/ralph-loop`
- `/ulw-loop`
- `/cancel-ralph`
- `/cartography`
- `/refactor`
- `/start-work`
- `/stop-continuation`

## Built-in Command Wiring

| Command | Default agent binding | Template source |
|---|---|---|
| `/brainstorm` | `planner` | `src/features/builtin-commands/templates/brainstorm.ts` |
| `/init-deep` | runtime default | `src/features/builtin-commands/templates/init-deep.ts` |
| `/ralph-loop` | runtime default | `src/features/builtin-commands/templates/ralph-loop.ts` |
| `/ulw-loop` | runtime default | `src/features/builtin-commands/templates/ralph-loop.ts` |
| `/cancel-ralph` | runtime default | `src/features/builtin-commands/templates/ralph-loop.ts` |
| `/cartography` | runtime default | `src/features/builtin-commands/templates/cartography.ts` |
| `/refactor` | runtime default | `src/features/builtin-commands/templates/refactor.ts` |
| `/start-work` | `workflow-automator` | `src/features/builtin-commands/templates/start-work.ts` |
| `/stop-continuation` | runtime default | `src/features/builtin-commands/templates/stop-continuation.ts` |

Contract:

- `loadBuiltinCommands(...)` MUST filter out names listed in `disabled_commands`.
- Returned command objects MUST be OpenCode-compatible (`name`, `description`, `template`, optional `agent`/`model`/`subtask`), and internal-only fields like `argumentHint` are stripped at return time.

## Disable and Merge Behavior

### `disabled_commands`

- Config key: `disabled_commands`.
- Validation surface: `BuiltinCommandNameSchema` in `src/config/schema.ts`.
- Merge rule: user + project config are merged via set-union in `src/plugin-config.ts`.

Implication:

- A built-in command disabled in either scope MUST NOT be present in the final built-in command set.

## Discovery Surface (`slashcommand`)

`discoverSlashCommandsSync(...)` composes command entries from:

1. Built-ins (`scope: "builtin"`)
2. OpenCode project commands (`.opencode/command`, `scope: "opencode-project"`)
3. Claude project commands (`.claude/commands`, `scope: "project"`)
4. OpenCode user commands (`~/.config/opencode/command`, `scope: "opencode"`)
5. Claude user commands (`$CLAUDE_CONFIG_DIR/commands`, `scope: "user"`)

Lookup semantics in `slashcommand` tool:

- Exact-name lookup uses first-match in discovery order above.
- Partial match returns suggestions.
- Missing names return command inventory plus guidance.
- Marketplace-style namespaced commands (for example `/plugin:cmd`) return an explicit unsupported message.

Important scope boundary:

- `slashcommand` tool discovery is file-catalog based (`discoverSlashCommandsSync`) and built-ins only.
- Runtime `config.command` entries added from plugin components are not automatically part of this discovery list unless they also exist as discoverable command files.

## Runtime Invocation Surfaces

Commands can be invoked through:

- `slashcommand` tool (`src/tools/slashcommand/tools.ts`): explicit tool call.
- `auto-slash-command` hook:
  - `chat.message` surface (prompt-embedded slash command handling).
  - `command.execute.before` surface (wired in `src/index.ts` when OpenCode version supports it).

OpenCode lifecycle support notes:

- `command.execute.before` wiring is version-gated by `OPENCODE_COMMAND_EXECUTE_BEFORE_HOOK_VERSION` in `src/shared/opencode-version.ts`.

## See Also

- Tools contract: `docs/reference/tools.md`
- Hooks contract: `docs/reference/hooks.md`
- Feature catalog (command guide): `docs/guide/features.md`
