# Contract: Glossary

This glossary defines terms used across the documentation set.

## Normative Language

The keywords **MUST**, **MUST NOT**, **SHOULD**, **SHOULD NOT**, and **MAY** are to be interpreted as described in RFC 2119.

## Agent

A named OpenCode persona/configuration. In this repo:

- Built-in agent factories live under `src/agents/`.
- The final runtime agent table is assembled in `src/plugin-handlers/config-handler.ts`.

## Category

A named execution profile used by `delegate_task(category=...)`. A category can specify model, variant, temperature, tool policy, and a prompt append.
See `CategoryConfigSchema` in `src/config/schema.ts`.

## Hook

A lifecycle interceptor wired by the plugin for events such as:

- `chat.message`
- `tool.execute.before`
- `tool.execute.after`
- `event`

Canonical runtime order: `src/hooks/runtime/pipeline-order.ts`; canonical node wiring: `src/index.ts`.

## Skill

A discoverable instruction bundle that can be:

- Executed via the `skill` tool,
- Injected into delegated prompts via `delegate_task(load_skills=[...])`,
- Exposed as a slash command via `slashcommand`.

Skills can optionally declare embedded MCP servers and tool allowlists.

## MCP (Model Context Protocol)

A server that exposes tools to the model via a standard interface. In this repo, MCP servers can be:

- Built-in (`src/mcp/`)
- Loaded from Claude Code `.mcp.json`
- Embedded in skills and managed via `skill_mcp`

## Background Task

Work executed asynchronously while the main session continues. Background tasks are typically launched via `delegate_task(run_in_background=true, ...)` and monitored via `background_output`.

## Session Handoff

A fork-owned mechanism for cross-session knowledge transfer. It extracts a structured summary at session end and injects relevant handoffs at session start (when enabled).
Implementation: `src/features/session-handoff/`.

## Session Reference

A prompt syntax feature (e.g., `@session:<id>`) used to reference prior sessions and optionally materialize a handoff from them.
Configuration lives under `session_handoff.reference` and/or top-level `session_reference` in `src/config/schema.ts`.

## Swarm (Sisyphus Swarm)

A fork-owned multi-agent coordination system with persistent team/task artifacts.
Primary entry: `swarm` tool (`src/tools/swarm.ts`) and the swarm feature/hook wiring.

## Worktree

A git feature that allows multiple working directories attached to a single repository. This repo uses worktrees for parallel agent isolation (see `tmux-parallel-agents` hook and the `parallel-agents` skill).

## Compaction

A session summarization step that reduces context window usage.

Contract (current wiring):

- `compaction-context-injector` is wired via `experimental.session.compacting` in `src/index.ts` (runs only if the OpenCode runtime emits this surface during compaction).
- Claude Code `PreCompact` support exists under `src/hooks/claude-code-hooks/pre-compact.ts` and is invoked on the same `experimental.session.compacting` surface (best-effort; depends on runtime support).

## Preemptive Compaction

A proactive summarize trigger before hitting a hard context limit. Implementation: `src/hooks/preemptive-compaction.ts`.

## Cartography / Codemap

A fork-owned subsystem that:

- Generates `codemap.md` files and optional `project-map.md`
- Persists state under `.opencode/cartography.json`
- Injects relevant summaries into model context

Implementation: `src/features/cartography/`.

## Governance

The observability and control layer for long-running agent sessions. When enabled, provides execution tracing, budget monitoring, checkpointing, and audit logging.

Configuration: `governance.enabled` in `oh-my-opencode.json`. Implementation: `src/features/governance/`.

### Semantic Checkpoint

A point-in-time capture of task state with environment awareness. Tracks affected files, dependencies, and git context to enable intelligent recovery decisions.

Implementation: `src/features/governance/checkpoint.ts`.

### Execution Trace

A causal graph of tool invocations and agent decisions within a session. Used for debugging and understanding agent behavior.

Implementation: `src/features/governance/tracer.ts`.

### Governance Ledger

An append-only audit log (JSONL format) recording budget snapshots, tool executions, and governance events. Supports integrity chains.

Location: `~/.sisyphus/ledger/<sessionId>.jsonl`. Implementation: `src/features/governance/ledger.ts`.

### Budget Monitor

Tracks estimated token consumption against context window limits. Uses "hidden budget strategy" - never exposes raw token counts, only qualitative phases (normal → GC → fork).

Implementation: `src/features/governance/budget-monitor.ts`.

### Approval Gate

A suspend/resume mechanism for critical tool operations. Currently implemented but NOT integrated with user-facing approval UI.

Status: Reserved. Implementation: `src/features/governance/approval-gate.ts`.

### Terminal Hallucination

A phenomenon where LLMs exhibit anxiety behavior when informed of hard resource limits. The hidden budget strategy addresses this by using qualitative phases instead of numeric budgets.
