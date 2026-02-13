# Contract: Agents

This document is a **normative contract** for agent naming, configuration, and wiring in this repo.

## Normative Language

The keywords **MUST**, **MUST NOT**, **SHOULD**, **SHOULD NOT**, and **MAY** are to be interpreted as described in RFC 2119.

## Scope

This document defines:

- The **built-in agent set** and their canonical names.
- How agent configuration is loaded and merged.
- The `agents`, `categories`, and `disabled_agents` configuration surfaces.
- Guardrails the plugin enforces on key agents (permissions and delegation boundaries).

This document does **not** restate every agent’s full prompt (those live in `src/agents/`).

## Source of Truth

- Built-in agent factories: `src/agents/`
- Built-in agent creation + model resolution: `src/agents/utils.ts` (`createBuiltinAgents`)
- Agent-related schema: `src/config/schema.ts`
- Runtime wiring:
  - Plugin lifecycle: `src/index.ts`
  - Config handler (agent merging and permissions): `src/plugin-handlers/config-handler.ts`

## Built-in Agent Names

The built-in agent names surfaced by configuration (`BuiltinAgentNameSchema`) are:

- `orchestrator` (primary user-facing agent)
- `workflow-automator` (plan execution orchestrator for `/start-work`)
- `executor` (high-autonomy executor)
- `advisor` (high-accuracy consultation)
- `librarian` (docs and research)
- `navigator` (codebase exploration)
- `interpreter` (image/PDF inspection)
- `scope-analyst` (pre-planning analysis)
- `reviewer` (plan review)

Contract:

- `disabled_agents` is schema-validated against `BuiltinAgentNameSchema`, so config input is effectively case-sensitive at parse time.
- Runtime lookup for agent comparisons may normalize case internally, but this does not relax config schema validation.
- Disabling a built-in agent **MUST** remove it from the built-in agent set produced by `createBuiltinAgents`.

## Derived and Compatibility Agent Names

In addition to the built-in set above, the runtime agent table can include “derived” or “compatibility” agents that are produced by the config handler:

- `specialist`: a focused executor used by `delegate_task({ category: ... })`.
- `planner`: the strategic plan agent used in the scope-analyst → planner → reviewer pipeline.
- `OpenCode-Builder`: an optional builder agent (enabled via `orchestrator_agent.default_builder_enabled`).
- `build` / `plan`: OpenCode default agent slots that may be demoted or replaced depending on configuration.

Contract:

- `disabled_agents` **MUST NOT** be assumed to disable these derived agents.
- Tooling (e.g., `delegate_task({ subagent_type: "..." })`) MAY reference these names when they exist in the runtime agent table.

## Agent Configuration Surfaces

### `disabled_agents`

- Configuration key: `disabled_agents: string[]`
- Schema: `src/config/schema.ts` (`BuiltinAgentNameSchema`)
- Merge rule: user + project config merge via **set union** (see `src/plugin-config.ts`).

### `agents` (Oh-My-OpenCode overrides)

Oh-My-OpenCode provides an `agents` block for agent overrides (model, variant, tools, permission, etc.).

- Schema: `AgentOverridesSchema` / `AgentOverrideConfigSchema` in `src/config/schema.ts`.
- Supported keys are limited to the schema enum. Unknown keys are **silently stripped** by config parsing.

Implications:

- If you attempt to override an agent not present in `AgentOverridesSchema`, the override **MUST NOT** take effect.
- Some built-in agents (e.g., `executor`) are created by the plugin but are not currently overrideable via `oh-my-opencode/*.json` due to schema limitations.

### `categories` (category-based execution)

Categories define model and prompt append settings used by:

- `delegate_task({ category: "..." })`
- Agent overrides that specify `category` (inherit category config)

Schema: `CategoriesConfigSchema` / `CategoryConfigSchema` in `src/config/schema.ts`.

## Merge and Precedence (High Level)

Agent configuration is assembled inside `src/plugin-handlers/config-handler.ts` by merging:

1. Built-in plugin agents (from `createBuiltinAgents`)
2. Claude Code agents (user and project) if enabled by `claude_code.agents`
3. Plugin-provided agents (OpenCode plugin components)
4. OpenCode base config `agent` block (runtime config)

Later layers override earlier layers for the same agent name.

## Permission and Delegation Guardrails

The plugin enforces additional permission constraints after agent assembly (defense-in-depth).
Notable enforced behaviors include:

- `orchestrator`, `workflow-automator`, `executor`, and `planner` are allowed `delegate_task`.
- `specialist` has `delegate_task` in research-scoped mode (navigator/librarian only, no categories, no skill injection). `task` is forcibly denied regardless of config-layer overrides.

See `src/plugin-handlers/config-handler.ts`.

## Planning Pipeline Note

The planning pipeline uses scope-analyst (pre-planning consultant) for intent classification and scope analysis, planner for plan generation, and reviewer (plan reviewer) for blocking-issue verification.

## See Also

- Contract: tools and delegation: `docs/reference/tools.md`
- Journey: planning to execution: `docs/journeys/planning-to-execution.md`
- Journey: swarm coordination: `docs/journeys/swarm-coordination.md`
- Config contract: `docs/reference/configuration.md`
