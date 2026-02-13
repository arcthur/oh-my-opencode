# Contract: TaskGraph V2

This document is a **normative contract** for the TaskGraph V2 domain model and API surface.

## Normative Language

The keywords **MUST**, **MUST NOT**, **SHOULD**, **SHOULD NOT**, and **MAY** are to be interpreted as described in RFC 2119.

## Scope

This document defines:

- The canonical task concepts and terminology.
- Lifecycle and dependency constraints.
- Concurrency/write consistency rules.
- Storage layout and API surface (`task_*` tools).

This document does **not** define orchestration policy (which agent should pick which task).

## Source of Truth

- Domain types and rules: `src/features/task-system/domain.ts`
- Storage and locking: `src/features/task-system/storage.ts`
- Application services: `src/features/task-system/service.ts`
- Query projections: `src/features/task-system/query.ts`
- Tool surface: `src/tools/task-graph/`

## Canonical Terms

- `TaskGraph`: Workspace task graph, partitioned by `scope + container_id`.
- `TaskNode`: Task entity stored as JSON.
- `TaskLifecycleState`: `open | in_progress | completed | cancelled | failed`.
- `TaskReadiness`: `ready | blocked` (derived from dependencies).
- `TaskScope`: `session | plan | swarm`.
- `ContainerId`: Scope-specific container identifier.
- `TaskRevision`: Monotonic CAS version (`revision`).
- `TaskLease`: Optional execution lease attached to the node (`lease` field).
- `DependencyEdge`: Unidirectional `depends_on` relation.

## Lifecycle Contract

Allowed transitions:

- `open -> in_progress | completed | cancelled | failed`
- `in_progress -> open | completed | cancelled | failed`
- `failed -> open | cancelled`
- `completed ->` terminal
- `cancelled ->` terminal

Rules:

- State transitions MUST go through `task_transition`.
- `task_update` MUST NOT mutate `state`.
- `completed` transition MUST fail when readiness is `blocked`.

## Readiness Contract

Readiness is derived, never persisted as primary state:

- `ready`: all dependencies are `completed`
- `blocked`: at least one dependency is not `completed`

`blocked_by_unresolved` MUST list unresolved dependency ids in summary responses.

## Dependency Contract

- Dependencies are represented only by `depends_on`.
- Self-dependency MUST fail with `TASK_INVALID_DEPENDENCY`.
- Missing dependency targets MUST fail with `TASK_DEPENDENCY_NOT_FOUND`.
- Cycles MUST fail with `TASK_DEPENDENCY_CYCLE`.

## Concurrency and Consistency

- Writes MUST use container-level locking (`withTaskGraphLock`).
- Writes MUST enforce CAS using `expected_revision` (except create).
- Revision mismatch MUST fail with `TASK_REVISION_CONFLICT`.
- Successful write MUST increment `revision`.

## Storage Layout

Default root: `.orchestrator/tasks` (configurable by `orchestrator.tasks.storage_path`).

Per-container layout:

```text
<root>/<scope>/<container_id>/<task_id>.json
```

Where:

- `<scope>` is one of `session`, `plan`, `swarm`
- `<container_id>` is sanitized for filesystem safety
- `<task_id>` is generated as `task_<8-hex>`

## Tool Contract

TaskGraph tools:

- `task_create`
- `task_get`
- `task_list`
- `task_update`
- `task_transition`

Selector behavior:

- `scope` defaults to `session`.
- `container_id` defaults to current `sessionID` only for `scope=session`.
- `container_id` is required for `scope=plan|swarm`.

Write behavior:

- `task_create` creates node with `revision=1`.
- `task_update` performs structural updates only.
- `task_transition` performs state transitions only.

## Error Code Surface

Stable error codes:

- `TASK_NOT_FOUND`
- `TASK_REVISION_CONFLICT`
- `TASK_INVALID_TRANSITION`
- `TASK_TRANSITION_BLOCKED`
- `TASK_DEPENDENCY_CYCLE`
- `TASK_DEPENDENCY_NOT_FOUND`
- `TASK_INVALID_DEPENDENCY`

Tools MAY return `TASK_INTERNAL_ERROR` for unexpected runtime failures.
