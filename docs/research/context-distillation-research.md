# Research: Context Distillation in Hook-First Policy Architecture

## Scope

This note summarizes the current (architecture v2) context distillation strategy after the migration to:
- `Hook Runtime` (host-controlled orchestration)
- `Policy Runtime` (observe/enforce decisions)
- `ContextView Assembler` (view-level budgeting)
- append-only ledgers (context / policy / governance)

It intentionally excludes legacy governor/truncator paths.

## Current Design

| Layer | Implementation | Responsibility |
|---|---|---|
| Event source | `src/hooks/runtime/assembly/*.ts` + `src/index.ts` | Deterministic hook-node ordering and lifecycle dispatch |
| Decision engine | `src/features/policy-runtime/` | Contract clause evaluation (`hard/soft/audit`), decision/outcome logging |
| Context distillation | `src/features/context-view/` | Budget-aware packing for prompt injections and output append |
| Replayability | `test/integration/features/policy-runtime.parity-replay.test.ts` | Session event replay + parity gates |
| Audit | `src/features/policy-runtime/policy-ledger.ts`, `src/features/governance/ledger.ts` | Decision provenance and governance trail |

## Why View-Level Distillation

Distillation runs at *view generation* time instead of mutating source records. This keeps:
- Reproducibility: same event stream can be replayed.
- Auditability: decisions carry clause ids and hook-node traces.
- Safety: compaction policy cannot silently rewrite source-of-truth logs.

## Policy Contract Implications

- Hard decisions are only valid on enforceable hook points.
- Non-enforceable points are downgraded to `soft`/`audit`.
- Conflict resolution is deterministic (`first-match`, `most-restrictive`, `merge`) with contract default fallback.

## Metrics and Evaluation

Evaluator remains async by default (`src/features/policy-runtime/evaluator.ts`) and records:
- task_success
- groundedness
- cost
- latency

Evaluator failures are fail-open and do not block hot path execution.

## Validation Checklist

1. Ordering invariants: `src/hooks/runtime/pipeline-policy-order.test.ts`
2. Chat params order: `src/hooks/chat-params-policy-order.test.ts`
3. Conflict determinism: `src/features/policy-runtime/kernel.test.ts`
4. Replay parity: `test/integration/features/policy-runtime.parity-replay.test.ts`
5. Ledger writing: `src/features/policy-runtime/event-writer.test.ts`

## Open Risks

- Policy clause quality still depends on clear selector/condition modeling.
- Very large contexts can still degrade relevance if contracts are overly permissive.
- Provider fallback policy requires continuous threshold calibration under traffic drift.
