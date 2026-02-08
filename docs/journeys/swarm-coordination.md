# Journey: Swarm Coordination (Sisyphus Swarm)

## User Perspective

You want true multi-agent parallelism with stronger isolation than “background subtasks”: separate processes, optional git worktrees, explicit task assignment, and an approval/permission channel that keeps risky actions under control.
Swarm provides a file-based coordination protocol plus a `tmux` orchestration layer so you can run a small “engineering team” in parallel and integrate results safely.

## End-to-End Flow

```mermaid
sequenceDiagram
  participant U as User
  participant ST as swarm tool (/swarm ...)
  participant TM as SwarmOrchestrator (tmux + worktrees)
  participant C as Coordinator session (opencode)
  participant W as Worker sessions (opencode)
  participant FS as .sisyphus (tasks + teams + inboxes)
  participant H as swarm-agent hook

  U->>ST: /swarm create <team>
  ST->>FS: createTeam() => teams/<team>/manifest.json
  ST->>TM: (optional) create coordinator tmux window
  TM->>C: start opencode with OPENCODE_SWARM_* env
  H-->>C: session.created => initialize coordinator

  U->>ST: /swarm spawn <n>
  ST->>TM: spawnWorkers(worktree optional)
  TM->>W: start opencode with OPENCODE_SWARM_* env
  H-->>W: session.created => initialize workers
  W->>FS: join_request / heartbeat / idle_notification (mailbox)

  U->>ST: /swarm task add <title> [description]
  ST->>FS: createSwarmTask() => tasks/swarm/<team>/task_*.json
  C->>FS: poll tasks + inboxes
  C->>FS: task_assignment => worker inbox msg_*.json
  W->>H: onTaskAssigned => prompt session with task

  alt Plan mode
    W->>ST: /swarm plan submit <plan>
    ST->>C: plan_approval_request (mailbox)
    C->>ST: /swarm plan approve|reject|revise <id>
    C->>FS: plan_approval_response (mailbox)
  end

  alt High-risk tool
    W->>C: permission_request (mailbox)
    C->>W: permission_response (mailbox)
  end

  W->>FS: task_completed (mailbox)
  U->>ST: /swarm status
  U->>ST: /swarm stop [--cleanup]
  ST->>TM: close windows; optionally remove worktrees
```

## Mental Model

- **Coordination plane**: a file-based mailbox protocol stored under `.sisyphus/teams/<team>/inboxes/<agentId>/`.
- **Control plane (in-process)**: `SwarmRuntimeService` in `src/features/sisyphus-swarm/runtime/` owns runtime handles (session↔team binding, coordinator/worker handles, team-scoped orchestrators).
- **Work plane**: each agent is an independent `opencode` process (often a tmux window).
- **Task plane**: shared TaskGraph storage under `.sisyphus/tasks/swarm/<team>/task_*.json`.
- **Admission plane**: a shared parallel-runtime lease registry under `.sisyphus/runtime/parallel/` that applies global slots across Swarm and Background execution.

Swarm works without a daemon: persistent truth is still filesystem-based, while runtime handles are centralized in one in-memory control-plane service.

## Typical Workflow

1. Start in a `tmux` session (recommended).
2. Create a team: `/swarm create my-team`.
3. Spawn workers: `/swarm spawn 3`.
4. Add tasks: `/swarm task add "Title" "Description"`.
5. Monitor: `/swarm status`.
6. Stop:
   - `/swarm stop` to stop workers for the current team but keep worktrees for manual merge, or
   - `/swarm stop --cleanup` to remove worktrees and branches.

## Swarm-first Bootstrap (from `/start-work`)

Swarm can also be bootstrapped automatically from the “plan → execution” workflow:

1. Generate a plan (`@plan`) and persist it via Planning-with-files.
2. Run `/start-work`.
3. If Swarm-first is enabled, the plugin will:
   - create/recover a Swarm team for the active plan,
   - sync plan tasks (from `plan.md` `## Tasks`) into `.sisyphus/tasks/swarm/<team>/` (idempotent),
   - optionally spawn worker windows in tmux (and optional git worktrees).

This binds **task structure**, **workspace isolation**, and **recovery**: tasks are durable (filesystem), workers are isolated (worktrees), and re-running `/start-work` can safely recover state.

### Config (Swarm-first)

Swarm-first requires both TaskGraph and Swarm to be enabled:

```jsonc
{
  "sisyphus": {
    "tasks": { "enabled": true },
    "swarm": {
      "enabled": true,
      "swarm_first": true,
      "worker_count": 3
    }
  },
  "tmux_parallel_agents": {
    "enabled": true,
    "worktree": { "enabled": true }
  }
}
```

### Global Concurrency Admission (Swarm + Background)

Swarm assignment admission can be unified with background execution limits through `parallel_runtime`:

```jsonc
{
  "parallel_runtime": {
    "enabled": true,
    "mode": "shadow",
    "global_slots": 6
  }
}
```

Semantics:
- `shadow`: coordinator still assigns, but records `would_block` events when capacity is exceeded.
- `enforce`: coordinator stops assigning new tasks when no global slot is available (non-blocking); workers remain idle until capacity returns.

## Approvals and Safety Controls

### Permission flow (high-risk tools)

Workers may request coordinator permission for high-risk tools (e.g., `Bash`, `Edit`, `Write`). The goal is to prevent accidental destructive commands when running unattended.

### Plan approval (plan mode)

Plan mode is stricter than permissions:

- High-impact tools are blocked until a plan is submitted and approved.
- Workers submit plans via `/swarm plan submit ...`.
- Coordinators manage approvals via `/swarm plan list|approve|reject|revise ...`.

## Configuration & Defaults

### Storage paths (single source of truth)

- `sisyphus.tasks.storage_path` (default: `.sisyphus/tasks`)
- `sisyphus.swarm.storage_path` (default: `.sisyphus/teams`)

In worktree mode, agents may run with different `cwd`. The orchestrator sets `SISYPHUS_PROJECT_ROOT` so all agents share the same `.sisyphus/` directory.

### tmux + worktrees

Swarm reuses the `tmux_parallel_agents` configuration section for worktree and rescue behavior:

- `tmux_parallel_agents.worktree.enabled`: create a git worktree per agent window (optional).
- `tmux_parallel_agents.worktree.dir_pattern`, `copy_files`, `symlink`: worktree ergonomics.
- `tmux_parallel_agents.auto_rescue`: periodically detect `(y/n)` prompts and send `y` + Enter (optional).

tmux integration is responsible for process/workspace ergonomics and visibility; concurrency admission is handled by `parallel_runtime`.

Note: Swarm window spawning requires **running inside tmux** and having the `tmux` binary available. Worktrees additionally require a git repository.

## Where to Look in Code

- Swarm CLI surface: `src/tools/swarm.ts`
- Auto-initialization hook (env-detected): `src/hooks/swarm-agent.ts`
- Runtime control-plane service: `src/features/sisyphus-swarm/runtime/`
- Team + manifest: `src/features/sisyphus-swarm/team/`
- Mailbox protocol (per-message files): `src/features/sisyphus-swarm/mailbox/`
- TaskGraph (swarm scope): `src/features/sisyphus-swarm/task-graph/`
- tmux orchestration + worktrees: `src/features/sisyphus-swarm/tmux/`
- Storage path helpers: `src/features/sisyphus-tasks/storage.ts`

## Debug Checklist

- Ensure `swarm-agent` hook is enabled (not in `disabled_hooks`).
- If using Swarm-first: ensure `swarm-from-plan` hook is enabled (not in `disabled_hooks`) and `sisyphus.swarm.swarm_first=true`.
- Ensure worker/coordinator processes have `OPENCODE_SWARM_*` env vars (created by tmux orchestrator).
- Check `.sisyphus/teams/<team>/manifest.json` exists and members are updating `lastHeartbeat`.
- Check inbox directories exist: `.sisyphus/teams/<team>/inboxes/<agentId>/`.
- If windows spawn but agents do not join:
  - validate tmux environment (inside tmux, `tmux` binary present),
  - confirm `SISYPHUS_PROJECT_ROOT` is set in worktree mode.

## Further Reading

- Contract: `docs/reference/artifacts-and-paths.md` (storage paths and ownership)
- Contract: `docs/reference/tools.md` (tool surface used by Swarm)
- Contract: `docs/reference/configuration.md` (config schema and defaults)
- Implementation notes: `src/features/sisyphus-swarm/ARCHITECTURE.md`
