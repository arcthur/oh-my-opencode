# Contract: Capability Matrix

This matrix is a **navigation contract**: given a capability, it tells you the canonical entrypoints (code + docs) to inspect.

## Normative Language

The keywords **MUST**, **MUST NOT**, **SHOULD**, **SHOULD NOT**, and **MAY** are to be interpreted as described in RFC 2119.

## Capabilities

| Capability | Start Here (Journey/Research) | Contract Reference | Primary Code Entry |
|---|---|---|---|
| Planning → execution | `docs/journeys/planning-to-execution.md` | `docs/reference/tools.md`, `docs/reference/agents.md`, `docs/reference/hooks.md` | `src/hooks/execution-orchestrator/`, `src/tools/delegate-task/` |
| Multi-model planning | `docs/journeys/multi-model-planning.md` | `docs/reference/tools.md`, `docs/reference/artifacts-and-paths.md` | `src/tools/multi-plan/`, `src/features/multi-plan/` |
| Planning with files | `docs/journeys/planning-with-files.md` | `docs/reference/artifacts-and-paths.md`, `docs/reference/hooks.md` | `src/hooks/planning-with-files/` |
| Background tasks | `docs/journeys/background-and-parallelism.md` | `docs/reference/tools.md` | `src/features/background-agent/`, `src/tools/background-task/` |
| Parallel agents (tmux + worktrees) | `docs/journeys/parallel-agents.md` | `docs/reference/artifacts-and-paths.md`, `docs/reference/skills.md` | `src/hooks/tmux-parallel-agents/`, `src/features/builtin-skills/skills/parallel-agents.ts` |
| Swarm coordination | `docs/journeys/swarm-coordination.md` | `docs/reference/tools.md`, `docs/reference/artifacts-and-paths.md` | `src/tools/swarm.ts`, `src/features/sisyphus-swarm/`, `src/hooks/swarm-agent.ts` |
| Session handoff / session reference | `docs/journeys/session-handoff-and-reference.md` | `docs/reference/artifacts-and-paths.md`, `docs/reference/hooks.md` | `src/features/session-handoff/` |
| Conditional rules | `docs/journeys/conditional-rules.md` | `docs/reference/hooks.md` | `src/features/conditional-rules/`, `src/features/hook-message-injector/` |
| Context and memory | `docs/journeys/context-and-memory.md` | `docs/reference/user-memory.md`, `docs/reference/artifacts-and-paths.md`, `docs/reference/hooks.md` | `src/features/context-injector/`, `src/features/user-memory/`, `src/features/org-memory/` |
| Delegation safety | `docs/journeys/delegation-safety.md` | `docs/reference/hooks.md`, `docs/reference/agents.md`, `docs/reference/configuration.md` | `src/hooks/delegation-validate-decision/`, `src/delegation/` |
| Engineering discipline | `docs/journeys/engineering-discipline.md` | `docs/reference/hooks.md`, `docs/reference/skills.md` | `src/hooks/anti-slop-enforcer.ts`, `src/hooks/pre-completion-verification.ts`, `src/features/builtin-skills/` |
| Output shaping (truncate/silent) | `docs/journeys/operations-and-debugging.md` | `docs/reference/hooks.md` | `src/hooks/tool-output-truncator.ts`, `src/hooks/silent-tool-output/` |
| Token limit recovery | `docs/journeys/operations-and-debugging.md` | `docs/reference/hooks.md` | `src/hooks/context-window-governor/`, `src/hooks/session-state-repair/` |
| Governance | `docs/journeys/governance.md` | `docs/reference/governance.md`, `docs/reference/configuration.md`, `docs/reference/artifacts-and-paths.md` | `src/features/governance/` |
| Browser automation | `docs/journeys/browser-automation.md` | `docs/reference/skills.md`, `docs/reference/mcps.md` | `src/features/builtin-skills/skills/playwright.ts`, `src/tools/skill-mcp/` |
| Extending the plugin | `docs/journeys/extensibility.md` | `docs/reference/hooks.md`, `docs/reference/tools.md`, `docs/reference/skills.md`, `docs/reference/mcps.md` | `src/index.ts`, `src/hooks/`, `src/tools/`, `src/features/` |
| Cartography / codemaps | `docs/research/cartography.md` (not wired by default) | `docs/reference/artifacts-and-paths.md` | `src/features/cartography/`, `src/hooks/codemap-injector/` (not wired) |

## Known Limitations (Wiring)

- Compaction-time injection is wired via `experimental.session.compacting` (Claude Code `PreCompact` + `context-window-governor`), but it depends on the OpenCode runtime emitting that experimental surface.
