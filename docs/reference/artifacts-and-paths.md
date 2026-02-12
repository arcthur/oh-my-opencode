# Contract: Artifacts & Paths

This document is a **normative contract** for on-disk artifacts used by this repo.

## Normative Language

The keywords **MUST**, **MUST NOT**, **SHOULD**, **SHOULD NOT**, and **MAY** are to be interpreted as described in RFC 2119.

## Scope

This document defines:

- Where configuration is loaded from (paths + precedence).
- Where the plugin reads/writes operational artifacts (plans, tasks, swarm teams, etc.).
- Which artifacts are “safe to delete” versus “persistent state”.

This document does **not** define the full OpenCode storage schema; it focuses on paths and ownership.

## Source of Truth

- Plugin config paths + merge: `src/plugin-config.ts`
- OpenCode config dir resolution: `src/shared/opencode-config-dir.ts`
- Claude config dir resolution: `src/shared/claude-config-dir.ts`
- OpenCode storage and cache dirs: `src/shared/data-path.ts`
- Skills/commands directories: `src/shared/paths.ts`
- Sisyphus tasks/swarm config: `src/config/schema.ts` (`SisyphusConfigSchema`)

## Configuration Files

### Oh-My-OpenCode config (`oh-my-opencode.json` / `.jsonc`)

The plugin loads and merges two configs:

1. **User config** (base):
   - `<OpenCodeConfigDir>/oh-my-opencode.jsonc` (preferred if present), else `.json`
2. **Project config** (override):
   - `./.opencode/oh-my-opencode.jsonc` (preferred if present), else `.json`

Contract:

- If both exist, project config **MUST** override user config.
- Arrays like `disabled_hooks` / `disabled_agents` / `disabled_mcps` are merged via **set union**.
- Unknown keys are accepted but may be stripped by schema parsing.

See `src/plugin-config.ts`.

### Claude Code compat extended config (`opencode-cc-plugin.json`)

The Claude Code hook compat layer optionally reads:

- User scope: `<OpenCodeConfigDir>/opencode-cc-plugin.json`
- Project scope: `./.opencode/opencode-cc-plugin.json`

See `src/hooks/claude-code-hooks/config-loader.ts`.

### Claude Code MCP config (`.mcp.json`)

If Claude Code MCP loading is enabled, `.mcp.json` is searched in:

- `$CLAUDE_CONFIG_DIR/.mcp.json` (default `~/.claude/.mcp.json`)
- `./.mcp.json`
- `./.claude/.mcp.json`

See `src/features/claude-code-mcp-loader/loader.ts`.

## Skill and Command Directories

The plugin discovers skills and commands from multiple directories:

- Skills: `~/.claude/skills/`, `.claude/skills/`, `<OpenCodeConfigDir>/skills/`, `./.opencode/skills/`
- Commands: `~/.claude/commands/`, `.claude/commands/`, `<OpenCodeConfigDir>/command/`, `./.opencode/command/`

See `src/shared/paths.ts`.

## Sisyphus Artifacts (`.sisyphus/`)

The `.sisyphus/` directory is used for fork-owned artifacts such as:

- Plans:
  - Canonical plan specs: `.sisyphus/plans/<planId>/plan.md`
  - Plan directories: `.sisyphus/plans/<planId>/` (task state SSOT: TaskGraph under `.sisyphus/tasks/plan/<planId>/`)
- Plan reviews: `.sisyphus/plan-reviews/`
- Notepads: `.sisyphus/notepads/`
- Ralph loop state: `.sisyphus/ralph-loop.local.md` (when enabled and active)
- Drafts / designs / evidence (used by planning workflows): `.sisyphus/drafts/`, `.sisyphus/designs/`, `.sisyphus/evidence/`

### Tasks and Swarm storage paths (configurable)

TaskGraph and Swarm store state in configurable directories:

- Tasks: default `.sisyphus/tasks` (`sisyphus.tasks.storage_path`)
- Teams: default `.sisyphus/teams` (`sisyphus.swarm.storage_path`)

TaskGraph per-container layout:

```text
.sisyphus/tasks/<scope>/<container_id>/task_*.json
```

Scopes:

- `session`: `container_id` is a session id
- `plan`: `container_id` is a plan id
- `swarm`: `container_id` is a team name

See `src/config/schema.ts` (`SisyphusTasksConfigSchema`, `SisyphusSwarmConfigSchema`) and `docs/reference/task-graph.md`.

Swarm team runtime layout (default root: `.sisyphus/teams`):

```text
.sisyphus/teams/<team>/
├── manifest.json
├── coordinator-lease.json
├── heartbeats/<agentId>.json
├── idle/<agentId>.idle
├── diagnostics/late-responses/*.json
├── security/control-message-signing-key.json
└── inboxes/<agentId>/
    ├── _meta.json
    ├── pending/*.json
    ├── processing/*.json
    └── done/*.json
```

Mailbox semantics are queue-based (`pending -> processing -> done/delete`), not read-flag toggling over a single inbox file.

## Parallel Agents (tmux + git worktrees)

If `tmux_parallel_agents.worktree.enabled=true`, the plugin may create git worktrees under a pattern directory:

- Default: `../{project}__worktrees` (`tmux_parallel_agents.worktree.dir_pattern`)

This is typically sibling to the main repo and is **not** safe to delete blindly unless you have merged or otherwise preserved important branches.

## Cartography / Codemaps (`.opencode/`)

Cartography stores persistent state under:

- `.opencode/cartography.json`

It may generate:

- `codemap.md` files across the repo
- A root `project-map.md` (if enabled by the cartography workflow)

See `docs/research/cartography.md` and `src/features/cartography/`.

## User Memory (`~/.opencode/memory/`)

User memory persists user-scoped state under:

- `~/.opencode/memory/user.json`
- `~/.opencode/memory/pattern-stats.json`
- `~/.opencode/memory/embeddings.json` (optional)
- `~/.opencode/memory/operations.jsonl` (optional, best-effort)

See `docs/reference/user-memory.md` and `src/features/user-memory/`.

## Org Memory (`.opencode/memory/`)

Org memory persists project-scoped state under:

- `.opencode/memory/org.json`

See `docs/reference/org-memory.md` and `src/features/org-memory/`.

## Governance (`~/.sisyphus/`)

When governance is enabled, it may persist governance artifacts under:

- Ledger (append-only audit log): `~/.sisyphus/ledger/<sessionId>.jsonl`
- Traces (compressed execution trace): `~/.sisyphus/traces/<sessionId>.json`

See `docs/reference/governance.md` and `src/features/governance/`.

## OpenCode Runtime Storage and Caches

The plugin relies on OpenCode’s storage and cache directories:

- Storage: `~/.local/share/opencode/storage` (respects `$XDG_DATA_HOME`)
- Cache: `~/.cache/opencode` and `~/.cache/oh-my-opencode` (respect `$XDG_CACHE_HOME`)

See `src/shared/data-path.ts`.
