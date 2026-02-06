# Journey: Planning → Execution

## User Perspective

You want a repeatable way to go from an ambiguous request (“refactor X”, “add feature Y”) to a concrete plan and then to disciplined execution, without drifting or skipping validation.
This journey maps the end-to-end chain: plan generation → plan selection → (optional) plan persistence → execution orchestration → tool-level work.

## End-to-End Flow

```mermaid
flowchart TD
  U["User request"] --> PG["Plan generation (Prometheus / multi_plan)"]
  PG --> PS["Plan synthesis (plan-synthesizer)"]

  PS --> PWF{"planning_with_files.enabled?"}
  PWF -->|Yes| FS["Persist plan + work state to .sisyphus/"]
  PWF -->|No| CH["Plan remains in chat context"]

  FS --> SW["Start execution (/start-work or start-work hook)"]
  CH --> SW

  SW --> MODE{"Swarm-first enabled?"}
  MODE -->|No| AT["Single-session execution (execution-orchestrator hook)"]
  MODE -->|Yes| SF["Swarm-first bootstrap (swarm-from-plan)\nSync TODOs -> task pool; (optional) spawn workers"]

  AT --> TOOL["Tools (Read/Glob/Grep/LSP/Edit/Bash/...)"]
  SF --> TOOL
  TOOL --> OUT["Artifacts + final answer"]
```

This journey explains how a plan is produced, validated, and executed through orchestration.

## Swarm-first (Optional)

If Swarm-first is enabled, `/start-work` can act as a bootstrap point for parallel execution:

- Pending plan TODO blocks are synced into `.sisyphus/tasks/<team>/`.
- Workers can be spawned in tmux windows, optionally one git worktree per worker.
- Progress and completion are tracked in the task pool, making recovery (across sessions) deterministic.
- Global concurrency can be governed by `parallel_runtime` so Swarm + Background share one slot budget.

See: `docs/journeys/swarm-coordination.md` and `docs/guide/orchestration.md`.

## Recommended Reading Order

1. Planning concepts: `docs/journeys/prometheus-planning.md`
2. Multi-model planning: `docs/journeys/multi-model-planning.md`
3. Planning with files: `docs/journeys/planning-with-files.md`
4. Orchestration: `docs/guide/orchestration.md`
5. Deterministic delegation context: `docs/journeys/context-packs-and-manifests.md`
6. Feature catalog: `docs/guide/features.md`

## Where to Look in Code

- Orchestrator hook: `src/hooks/execution-orchestrator/`
- Start-work bootstrap: `src/hooks/start-work/`
- Planning-with-files hook: `src/hooks/planning-with-files/`
- Multi-plan trigger: `src/hooks/multi-plan-trigger/`
- Multi-plan tool: `src/tools/multi-plan/`
 - Plan synthesis agent: `src/agents/plan-synthesizer.ts`

## Execution Chain (Code Is Source of Truth)

- Lifecycle order table is implemented in `src/hooks/runtime/pipeline-order.ts` and wired in `src/index.ts`.
- The documentation mirror is `src/hooks/AGENTS.md`.
