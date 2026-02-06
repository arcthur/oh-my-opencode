# Contract: Governance

This document is a **normative contract** for the governance module as wired in this repo.

## Normative Language

The keywords **MUST**, **MUST NOT**, **SHOULD**, **SHOULD NOT**, and **MAY** are to be interpreted as described in RFC 2119.

## Scope

This document defines:

- The configuration surface under `governance` (what is supported, what is reserved).
- The hook integration points and their effects (what runs, when).
- On-disk artifacts produced by governance (ledger, trace persistence).

This document does **not** define the full internal algorithms of tracing, budgeting, or checkpoint recovery. Those are implementation details.

## Source of Truth

- Schema: `src/config/schema.ts` (`GovernanceConfigSchema`)
- Runtime wiring: `src/index.ts`
- Session lifecycle bus: `src/features/session-state-coordinator/`
- Integration implementation: `src/features/governance/integration.ts`
- Ledger: `src/features/governance/ledger.ts`
- Trace persistence: `src/features/governance/trace-persistence.ts`
- Budget monitor: `src/features/governance/budget-monitor.ts`
- Checkpoints: `src/features/governance/checkpoint.ts`

## Enablement

- Config key: `governance.enabled` (default: `false`).
- Contract: when `governance.enabled` is `false`, governance integration in `src/index.ts` MUST be treated as a no-op (no ledger writes, no tracing, no budget messages, no checkpoint creation).

## Integration Points (Wired)

When `governance.enabled=true`, the plugin wires governance at the following points:

### Session Lifecycle Dispatch (Coordinator)

- Call site: `src/index.ts` (feature registration via `sessionStateCoordinator.registerFeature("governance", ...)`).
- Contract:
  - Session lifecycle events MUST flow through `SessionStateCoordinator`.
  - Governance lifecycle handlers MUST remain idempotent (`session.deleted` may be retried/replayed by upstream event sources).
  - Governance state remains domain-owned (internal `sessions` map and managers in `src/features/governance/integration.ts`), while lifecycle event dispatch is centralized.

### 1) `chat.message` (user prompt processing)

- Call site: `src/index.ts` (`chat.message` handler).
- Behavior: extracts the prompt text and estimates prompt tokens as `ceil(prompt.length / 4)`.
- Executes: `executeUserPromptGovernance(...)`.
- Contract:
  - Budget reminders MAY be registered into the context collector as `source="custom"` with id `governance-budget-context` and `priority="low"`.
  - The implementation MUST treat governance failures as non-fatal unless explicitly raised as a governance block (see “Error Handling”).

### 2) `tool.execute.before` (pre-tool)

- Call site: `src/index.ts` (`tool.execute.before` handler).
- Executes: `executePreToolGovernance(...)`.
- Current wired behavior:
  - If tracer is enabled, start a trace node for the tool call (inputs are sanitized).
  - If ledger + budget monitor are enabled, log a “pre-tool budget snapshot” entry.
  - Increment an internal tool call counter (used for auto-checkpoint scheduling).

### 3) `tool.execute.after` (post-tool)

- Call site: `src/index.ts` (`tool.execute.after` handler).
- Order: governance runs **after output shaping** so budget estimates match the final shaped output.
- Executes: `executePostToolGovernance(...)`.
- Current wired behavior:
  - End the tool’s trace node (outputs are sanitized).
  - Record estimated token usage for the tool output (`ceil(output.length / 4)`).
  - Append budget warnings and/or a `<budget-exhausted>` marker to tool output when thresholds are reached.
  - Optionally create an auto-checkpoint (see “Checkpoints”).
  - Log a “post-tool budget snapshot” entry.
  - When budget is exhausted, the UI MAY show a “Budget Exhausted” toast.

### 4) Session cleanup

- Dispatch path:
  - Event ingestion: `src/index.ts` receives `session.deleted`.
  - Lifecycle bus: `sessionStateCoordinator.onSessionDeleted(sessionId)`.
  - Governance handler: registered `onSessionDeleted` invokes `cleanupGovernanceSession(sessionId)`.
- Contract:
  - If tracing is enabled, the trace MUST be finalized and persisted to disk (best-effort).
  - Ledger cleanup MUST be best-effort and MUST NOT crash the session teardown.
  - Duplicate cleanup triggers MUST be safe no-op for already-cleaned governance sessions.

## Configuration Surface (Implemented vs Reserved)

The schema contains additional knobs; not all are currently enforced in runtime wiring.

| Config Key | Status | Notes |
|---|---:|---|
| `governance.enabled` | Implemented | Master toggle. |
| `governance.tracer.*` | Implemented | Controls tracing and sanitization behavior. |
| `governance.budget_monitor.*` | Implemented | Controls thresholds and allocation size. Back-compat: `gc_threshold` → `refactor_threshold`. |
| `governance.ledger.*` | Implemented | Controls base dir and retention. |
| `governance.checkpoint.enabled` | Implemented | Enables checkpoint manager and auto-checkpoint creation. |
| `governance.checkpoint.auto_checkpoint_interval` | Implemented | Interval (in tool calls) for auto-checkpoint creation. |
| `governance.checkpoint.max_checkpoints` | Reserved | Not enforced by the current integration layer. |
| `governance.checkpoint.recovery_preference` | Reserved | Not enforced by the current integration layer. |
| `governance.approval_gate.*` | Reserved | Approval gate exists in code but is not integrated into the main runtime wiring. |

## Artifacts & Storage

### Ledger

- Default location: `~/.sisyphus/ledger/<sessionId>.jsonl`
- Contract:
  - Ledger files MUST be append-only.
  - Ledger failures MUST be treated as non-fatal (best-effort logging).

### Trace persistence

- Default location: `~/.sisyphus/traces/<sessionId>.json`
- Contract:
  - When tracing is enabled, traces SHOULD be persisted on session cleanup.
  - Persisted traces are compressed (critical nodes + recent timeline), not a full in-memory dump.

### Checkpoints

- Default storage directory (checkpoint manager): `.opencode/checkpoints/` (project-local).
- Contract (current wiring):
  - Auto-checkpoint creation creates an in-memory checkpoint object.
  - The current integration layer does NOT auto-save checkpoints to disk.
  - Consumers MUST NOT assume checkpoint files exist unless saved explicitly by a caller that invokes the persistence API.

## Error Handling Contract

The plugin wraps governance calls with best-effort error handling:

- Errors are logged as non-fatal unless they are explicitly surfaced as a governance block error.
- The runtime uses the error prefix `Governance blocked:` as the sentinel for “rethrow and block”.

Note: current integration functions do not emit blocks by default, so governance behaves as advisory/observability tooling rather than a hard gate.
