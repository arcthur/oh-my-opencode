# Contract: Tools

This document is a **normative contract** for the tool surface provided by this repo.

## Normative Language

The keywords **MUST**, **MUST NOT**, **SHOULD**, **SHOULD NOT**, and **MAY** are to be interpreted as described in RFC 2119.

## Scope

This document defines:

- Tool **names** and where they are wired.
- The **contract surface** for the high-signal tools that other subsystems depend on.
- Tool-specific **machine-parsable markers** that downstream hooks rely on.

This document does **not** fully restate every tool’s Zod schema for every tool. For the complete schema, consult each tool implementation (schema + error strings are part of the UX contract).

## Source of Truth

- Canonical registry: `src/index.ts` (`return { tool: { ... } }`)
- Built-in tool map: `src/tools/index.ts` (`builtinTools`, `createBackgroundTools`)
- Tool implementations: `src/tools/*`

## Tool Registry (Names)

The Oh-My-OpenCode plugin registers the following tools (in addition to any tools provided by the OpenCode runtime):

### Delegation and orchestration

| Tool name | Implementation | Purpose |
|---|---|---|
| `delegate_task` | `src/tools/delegate-task/` | Delegate work to a subagent (sync or background) with optional skill injection |
| `multi_plan` | `src/tools/multi-plan/` | Multi-model planning orchestration (Prometheus) |
| `swarm` | `src/tools/swarm.ts` | Sisyphus Swarm orchestration entrypoint |
| `call_omo_agent` | `src/tools/call-omo-agent/` | Run a lightweight exploration/research agent (legacy runner) |
| `look_at` | `src/tools/look-at/` | Assistive “inspect” tool (used by multimodal workflows) |

### Skills and commands

| Tool name | Implementation | Purpose |
|---|---|---|
| `skill` | `src/tools/skill/` | Load and run a skill template by name |
| `skill_mcp` | `src/tools/skill-mcp/` | Manage MCP servers declared by skills |
| `slashcommand` | `src/tools/slashcommand/` | Discover and run commands (including skills-as-commands) |

### Background task controls

| Tool name | Implementation | Purpose |
|---|---|---|
| `background_output` | `src/tools/background-task/` | Poll background task output by `task_id` |
| `background_cancel` | `src/tools/background-task/` | Cancel a background task by `task_id` |

### Local developer tools (builtinTools)

These tools are registered under `builtinTools` in `src/tools/index.ts`:

- LSP: `lsp_goto_definition`, `lsp_find_references`, `lsp_symbols`, `lsp_diagnostics`, `lsp_prepare_rename`, `lsp_rename`
- AST-Grep: `ast_grep_search`, `ast_grep_replace`
- Search: `grep`, `glob`
- Session manager: `session_list`, `session_read`, `session_search`, `session_info`

### Interactive shell

| Tool name | Implementation | Purpose |
|---|---|---|
| `interactive_bash` | `src/tools/interactive-bash/` | Spawn and maintain a persistent bash session |

## Contract: `delegate_task`

`delegate_task` is the primary integration point for:

- Subagent delegation
- Background execution
- Skill injection into delegated prompts
- Cross-turn continuity via `session_id`

### Arguments

`delegate_task` calls **MUST** include:

- `description` (short label)
- `prompt` (full prompt text; **MUST** be English for best results)
- `load_skills` (**REQUIRED**; pass `[]` if none)
- `run_in_background` (**REQUIRED**; `true` async, `false` sync)

Selection mode:

- New task calls **MUST** provide exactly one of:
  - `category` (category-based delegation), OR
  - `subagent_type` (explicit agent selection)
- Continuation calls **MUST** provide `session_id` and MAY omit `category`/`subagent_type`.

If both `category` and `subagent_type` are provided for a new task, the tool returns a user-facing error string.

### Return format (background mode)

When `run_in_background=true`, the tool returns a plain-text summary that **MUST** include:

- `Task ID: <task_id>` (for `background_output` / `background_cancel`)
- A `<task_metadata>` block containing `session_id: <session_id>`

Downstream automation relies on `<task_metadata>` for continuation.

### Return format (sync mode)

When `run_in_background=false`, the tool blocks until the delegated session finishes and returns a plain-text result that **MUST** include:

- A human-readable completion header (e.g., `Task completed in ...` / `Task continued and completed in ...`)
- A delimiter section (`---`) followed by the last assistant text (or an explicit `(No text output)` marker)
- A `<task_metadata>` block containing `session_id: <session_id>`

### Error semantics

The tool **throws** (hard error) when required arguments are missing:

- Missing `run_in_background`
- Missing `load_skills`

The tool **returns** (soft error) when mutually exclusive routing is violated:

- `category` and `subagent_type` both provided
- Neither `category` nor `subagent_type` provided for a new task

### Stability override (category-based delegation)

If a category is resolved as an “unstable agent” (see `CategoryConfigSchema.is_unstable_agent` and the delegate executor), the implementation MAY force a monitored background execution path even when `run_in_background=false`.
The caller still receives a synchronous, final output, but the underlying execution is launched as a background task for monitoring.

### Background follow-ups

If you launch a background task, you SHOULD:

- Poll with `background_output(task_id="...")` until completion, and/or
- Cancel with `background_cancel(task_id="...")` if the task is stuck.

## Contract: `multi_plan`

`multi_plan` orchestrates multi-model planning and writes files under `.sisyphus/`.

### Machine-parsable marker

On success, the tool output **MUST** include a single JSON blob wrapped by:

- `[MULTI_PLAN_RESULT]{...}[/MULTI_PLAN_RESULT]`

Downstream hooks (e.g., planning-with-files) MAY parse this marker to auto-create plan artifacts.

## Tool I/O Shaping (Hook Interactions)

Tool outputs are not purely a function of the tool implementation. Hooks can:

- Modify tool arguments (`tool.execute.before`)
- Append warnings or truncate output (`tool.execute.after`)
- Hide output for context reduction (`silent-tool-output`)

If you need “raw” behavior for debugging, consult `docs/reference/hooks.md` and the wiring in `src/index.ts`.
