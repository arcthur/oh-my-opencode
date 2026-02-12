# Journey: Swarm Coordination (Sisyphus Swarm)

## User Perspective

Use Swarm when you need durable multi-agent parallel execution with explicit coordination semantics:

- Separate worker/coordinator runtimes
- Optional tmux + git worktree isolation
- Task assignment with stateful ownership
- Approval controls for plan and risky operations

Swarm combines a filesystem-backed protocol with an in-process control plane (`SwarmRuntimeService`) so execution stays recoverable without external services.

## End-to-End Flow

```mermaid
sequenceDiagram
  participant U as User
  participant ST as swarm tool (/swarm ...)
  participant TM as SwarmOrchestrator (tmux + worktrees)
  participant C as Coordinator session (opencode)
  participant W as Worker sessions (opencode)
  participant FS as .sisyphus (teams + tasks + mailbox queue)
  participant H as swarm-agent hook

  U->>ST: /swarm create <team>
  ST->>FS: createTeam() => teams/<team>/manifest.json
  ST->>TM: optional coordinator window spawn
  TM->>C: start opencode with OPENCODE_SWARM_* env
  H-->>C: session.created => initialize coordinator

  U->>ST: /swarm spawn <n>
  ST->>TM: spawn worker windows (optional worktrees)
  TM->>W: start opencode with OPENCODE_SWARM_* env
  H-->>W: session.created => initialize workers
  W->>FS: join_request + heartbeat + idle signaling

  U->>ST: /swarm task add <title> [description]
  ST->>FS: createSwarmTask() => tasks/swarm/<team>/task_*.json
  C->>FS: select idle workers + assign tasks
  C->>FS: task_assignment => inboxes/<agent>/pending/*.json
  W->>W: claim pending -> processing -> ack/requeue

  alt Plan mode
    W->>ST: /swarm plan submit <plan>
    ST->>C: plan_approval_request
    C->>ST: /swarm plan approve|reject|revise <id>
    C->>FS: plan_approval_response
  end

  alt High-risk operation
    W->>C: permission_request
    C->>W: permission_response
  end

  W->>FS: task_completed
  U->>ST: /swarm status
  U->>ST: /swarm stop [--cleanup]
  ST->>TM: close windows; optionally cleanup worktrees
```

## Mental Model

- **Control plane (in-process)**: `SwarmRuntimeService` owns runtime handles (session-team bindings, worker/coordinator handles, team orchestrator handles).
- **Coordination plane (filesystem protocol)**: mailbox queue + lease + manifest + heartbeat/idle stores under `.sisyphus/teams/<team>/`.
- **Work plane**: each worker is an independent `opencode` process.
- **Task plane**: TaskGraph state under `.sisyphus/tasks/swarm/<team>/task_*.json`.
- **Admission plane**: shared parallel-runtime lease registry under `.sisyphus/runtime/parallel/`.

## Typical Workflow

1. Start inside tmux (recommended).
2. Create a team: `/swarm create my-team`.
3. Spawn workers: `/swarm spawn 3`.
4. Add tasks: `/swarm task add "Title" "Description"`.
5. Monitor: `/swarm status`.
6. Stop:
   - `/swarm stop` to stop runtime and keep worktrees for manual merge, or
   - `/swarm stop --cleanup` to remove worktrees and branches.

## Swarm-first Bootstrap (from `/start-work`)

When Swarm-first is enabled, `/start-work` can bootstrap a recoverable parallel execution model:

1. Create/recover the team for the active plan.
2. Sync `plan.md` task list into TaskGraph scope `swarm` (idempotent).
3. Optionally spawn tmux worker windows (and optional worktrees).

This binds task structure, workspace isolation, and restart recovery.

### Swarm-first Config

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

## Safety and Approval Controls

### Sender / Epoch / Signature

Swarm hardens privileged controls with three checks:

1. Sender-role validation
2. Coordinator epoch fencing
3. Ed25519 signature validation (default enabled)

### Plan and Permission Approvals

- Workers can submit plans via `/swarm plan submit ...`.
- Coordinators handle queued approvals via `/swarm plan list|approve|reject|revise ...`.
- Risky operations can require `permission_request` / `permission_response`.

## Mailbox Queue Semantics

Inboxes use queue directories:

- `pending/`
- `processing/`
- `done/`

Consumption flow:

1. Claim (`pending -> processing` rename)
2. Handle message
3. Ack (`processing` delete/move) or requeue
4. Requeue expired processing claims after timeout

Watch mode uses `fs.watch` with an always-on low-frequency fallback poll (`watch_fallback_poll_ms`, default 5000ms).

## Configuration and Defaults

### Storage Paths

- `sisyphus.tasks.storage_path` (default: `.sisyphus/tasks`)
- `sisyphus.swarm.storage_path` (default: `.sisyphus/teams`)

In worktree mode, orchestrator sets `SISYPHUS_PROJECT_ROOT` so all agents share the same `.sisyphus/` root.

### Swarm Safety Defaults

- `sisyphus.swarm.enforce_sender_validation: true`
- `sisyphus.swarm.enforce_signature: true`
- `sisyphus.swarm.coordinator_lease_ttl_ms: 15000`
- `sisyphus.swarm.coordinator_lease_renew_ms: 5000`
- `sisyphus.swarm.watch_fallback_poll_ms: 5000`
- `sisyphus.swarm.auto_rescue_policy: "disabled"`
- `sisyphus.swarm.auto_rescue_allowlist: []`

### tmux + Worktrees

Swarm window/worktree behavior is driven by `tmux_parallel_agents`:

- `tmux_parallel_agents.worktree.*` controls worktree creation/layout.
- `tmux_parallel_agents.auto_rescue` controls whether rescue checks run at all.
- `sisyphus.swarm.auto_rescue_policy` controls whether y/n prompts are auto-confirmed (`disabled` by default).

## Where to Look in Code

- Swarm tool: `src/tools/swarm.ts`
- Auto-init hook: `src/hooks/swarm-agent.ts`
- Runtime control plane: `src/features/sisyphus-swarm/runtime/`
- Team + lease + heartbeat + idle: `src/features/sisyphus-swarm/team/`
- Mailbox queue protocol: `src/features/sisyphus-swarm/mailbox/`
- TaskGraph swarm scope: `src/features/sisyphus-swarm/task-graph/`
- tmux/worktree orchestration: `src/features/sisyphus-swarm/tmux/`
- Shared storage path helpers: `src/features/sisyphus-tasks/storage.ts`

## Debug Checklist

- Ensure `swarm-agent` hook is enabled (not listed in `disabled_hooks`).
- If using Swarm-first, ensure `swarm-from-plan` hook is enabled and `sisyphus.swarm.swarm_first=true`.
- Ensure worker/coordinator sessions have `OPENCODE_SWARM_*` env vars.
- Check team state files exist:
  - `.sisyphus/teams/<team>/manifest.json`
  - `.sisyphus/teams/<team>/coordinator-lease.json`
  - `.sisyphus/teams/<team>/heartbeats/*.json`
- Check inbox queue directories exist:
  - `.sisyphus/teams/<team>/inboxes/<agentId>/pending/`
  - `.sisyphus/teams/<team>/inboxes/<agentId>/processing/`
- If windows spawn but workers do not join:
  - verify tmux environment (inside tmux, `tmux` binary available),
  - verify `SISYPHUS_PROJECT_ROOT` propagation in worktree mode,
  - inspect security events for `invalid_join_request`.

## Further Reading

- Storage contract: `docs/reference/artifacts-and-paths.md`
- Tool contract: `docs/reference/tools.md`
- Config contract: `docs/reference/configuration.md`
- Implementation details: `src/features/sisyphus-swarm/ARCHITECTURE.md`
