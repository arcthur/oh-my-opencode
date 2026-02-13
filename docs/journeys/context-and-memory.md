# Journey: Context & Memory

## User Perspective

You want to understand why the agent “knows what it knows”, how much context is being injected, and why behavior can change when the session grows (truncation, compaction, recovery).
This journey maps the end-to-end lifecycle across prompt submission, tool execution, and compaction.

## End-to-End Flow

```mermaid
flowchart TD
  U["User message"] --> UPS["user.prompt.submit hooks"]
  UPS --> MEM["Memory features update state (user/org)"]
  UPS --> ROUTE["Routing / orchestration hints (keyword detector, etc.)"]

  ROUTE --> PRE["tool.execute.before hooks inject context"]
  PRE --> TOOL["Tool execution (Read/Glob/Grep/LSP/Bash/...)"]
  TOOL --> POST["tool.execute.after hooks shape output (budget/optimize/recover)"]

  POST --> LIM{"Context pressure?"}
  LIM -->|Near limit| PC["context-view + policy-runtime (preemptive/recovery)"]
  PC --> WARN["context-pressure hint + compaction metadata"]
  WARN --> SC["session.compacted event / experimental compaction surface"]
  SC --> MEM
```

This journey explains how context is managed (budgeting, compaction, recovery), how memory features inject state, and how to reason about “what the agent knows”.

## Key Docs

- Context window management: `docs/journeys/context-window-management.md`
- Deterministic delegation context: `docs/journeys/context-packs-and-manifests.md`
- User memory contract: `docs/reference/user-memory.md`
- Org memory contract: `docs/reference/org-memory.md`
- User memory deep dive (non-normative): `docs/research/user-memory-deep-dive.md`
- Cross-session continuity: `docs/journeys/cross-session-continuity.md`
- Session handoff & session reference: `docs/journeys/session-handoff-and-reference.md`
- Hook contract: `docs/reference/hooks.md`

## Where to Look in Code

- Context collection/injection: `src/features/context-injector/`
- Context budget arbiter: `src/features/context-view/` (unified token budget across all injection channels)
- Preemptive compaction policy: `src/features/policy-runtime/`
- Compaction-time injection helpers (wired via `experimental.session.compacting`): policy/context-view runtime nodes and Claude Code compat `src/hooks/claude-code-hooks/pre-compact.ts`
- Session recovery on token-limit errors: `src/features/context-view/` + `src/hooks/session-state-repair/`
- User memory: `src/features/user-memory/`
- Org memory: `src/features/org-memory/`

## Practical Debug Checklist

- Verify runtime order in `src/hooks/runtime/pipeline-order.ts`, event node assembly in `src/hooks/runtime/assembly/*.ts`, and lifecycle dispatch entrypoints in `src/index.ts`.
- Confirm `disabled_hooks` and feature config in `oh-my-opencode/*.json`.
- If compaction seems to “forget” critical constraints, inspect policy decisions (`policy-runtime`) and context packing decisions (`context-view`) plus compaction-time injection wiring (see `docs/reference/hooks.md`).
