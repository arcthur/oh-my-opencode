# Contract: Skills

This document is a **normative contract** for how skills are discovered, merged, and executed in this repo.

## Normative Language

The keywords **MUST**, **MUST NOT**, **SHOULD**, **SHOULD NOT**, and **MAY** are to be interpreted as described in RFC 2119.

## Scope

This document defines:

- What a “skill” is in this repo and how skills are represented at runtime.
- Discovery locations, merge precedence, and override semantics.
- Configuration keys that affect skill enablement and resolution.
- How skills can embed MCP servers.

This document does **not** define the full content of every built-in skill template (those live under `src/features/builtin-skills/`).

## Source of Truth

- Built-in skills factory: `src/features/builtin-skills/skills.ts`
- Skill discovery + merge: `src/features/opencode-skill-loader/`
- Skill directories: `src/shared/paths.ts` (`getSkillDirectories`)
- Runtime wiring (skills used by tools): `src/index.ts`
- Skill tools: `src/tools/skill/`, `src/tools/skill-mcp/`

## Definition

A **skill** is an instruction bundle that can be:

- Executed directly via the `skill` tool (by name), and/or
- Injected into delegated prompts via `delegate_task({ load_skills: [...] })`.

Skills can optionally declare:

- `allowedTools` (tool allowlist)
- Model/agent hints (frontmatter or config)
- Embedded MCP servers (frontmatter `mcp` or built-in `mcpConfig`)

## Built-in Skills

### Default built-in set

The built-in skill set is created by `createBuiltinSkills()` and currently includes:

- Browser automation provider: `playwright` (default) OR `agent-browser` (included only when explicitly selected by an integration point)
- `frontend-ui-ux`
- `git-master`
- `parallel-agents`
- `dev-browser`
- `cartography`
- `spec-compliance-review`
- `code-quality-review`
- `writing-plans`
- `systematic-debugging`
- `code-simplifier`

### Automatic exclusion: system MCP name collisions

Some built-in skills embed MCP configuration (e.g., Playwright).
If a Claude Code `.mcp.json` config enables an MCP server with the same name, the plugin **MUST** exclude the built-in skill to avoid conflicts. See `src/index.ts` and `src/features/claude-code-mcp-loader/loader.ts` (`getSystemMcpServerNames`).

## Discovery Locations

Skills are discovered from multiple scopes. The canonical directories are:

- Claude Code (user): `~/.claude/skills/` (or `$CLAUDE_CONFIG_DIR/skills/`)
- Claude Code (project): `.claude/skills/`
- OpenCode (global): `<OpenCodeConfigDir>/skills/` (respects `$OPENCODE_CONFIG_DIR`)
- OpenCode (project): `.opencode/skills/`

See `src/shared/paths.ts`.

## Merge Precedence and Overrides

### Scope priority (winner-takes-name)

If multiple skills share the same `name`, the merge logic selects a single “winning” definition by scope priority:

1. `builtin` (lowest)
2. `config`
3. `user`
4. `opencode`
5. `project`
6. `opencode-project` (highest)

See `src/features/opencode-skill-loader/merger.ts` (`SCOPE_PRIORITY`).

### Config overlay happens twice

The `skills` config block can both:

- Define/override skills with full templates, and
- Patch an existing skill definition (merge fields) without replacing the template.

This means a high-priority filesystem skill can still receive a final config “patch” if the config entry omits `template`/`from`.

### Disabling semantics

You can remove a skill from the final merged set via any of:

- `skills: { "<name>": false }`
- `skills: { "<name>": { disable: true } }`
- `skills: { disable: ["<name>", ...] }`
- `skills: ["allowlisted-skill-1", ...]` (array form: allowlist; everything else is removed)

The `disabled_skills` key only applies to schema-recognized built-in names. To disable arbitrary names, use the `skills` config overlay.

## Skill Configuration (`skills`)

### Supported shapes

`skills` accepts either:

1. **Array form**: `skills: ["a", "b"]`
   - Contract: this is an **allowlist**. Only those names remain in the merged output.

2. **Object form**:

   - `sources` (additional discovery roots)
   - `enable` (allowlist)
   - `disable` (denylist)
   - per-skill entries: `"<name>": true | false | { ...definition... }`

See `SkillsConfigSchema` in `src/config/schema.ts`.

### `from` file resolution (config-defined skills)

When a skill is defined via `from`, the loader resolves paths as:

- `{file:/abs/or/rel}` is unwrapped to the inner path
- `~/` expands to the user home directory
- Absolute paths are used as-is
- Relative paths are resolved against the **config directory** (or `process.cwd()` as fallback)

See `resolveFilePath()` in `src/features/opencode-skill-loader/merger.ts`.

### Wrapper template for config-defined skills

Config-defined skills are wrapped with a standardized envelope that:

- Declares a “base directory” for file references, and
- Appends a `<user-request>` section containing `$ARGUMENTS`.

This wrapper is part of the execution contract for config-defined skills. See `configEntryToLoaded()` in `src/features/opencode-skill-loader/merger.ts`.

## Frontmatter Contract (filesystem skills)

Filesystem skills are Markdown files with optional frontmatter.
Supported frontmatter fields include (non-exhaustive):

- `name`, `description`
- `model`, `agent`, `subtask`
- `allowed-tools`
- `mcp` (embedded MCP server config)

See `SkillMetadata` in `src/features/opencode-skill-loader/types.ts`.

## See Also

- Contract: tools using skills: `docs/reference/tools.md`
- Contract: MCPs and skill MCP embedding: `docs/reference/mcps.md`
- Journey: extensibility: `docs/journeys/extensibility.md`
