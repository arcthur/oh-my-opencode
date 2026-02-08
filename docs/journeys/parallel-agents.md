# Journey: Parallel Agents (Worktrees, tmux, Swarm)

## User Perspective

You want to split a large engineering goal into multiple independent subtasks and run them concurrently without losing control.
The core challenge is avoiding interference (filesystem conflicts, shared state) while keeping progress observable (status, approvals, failures) and integration safe (merge strategy, cleanup).

## End-to-End Flow

```mermaid
flowchart TD
  U["User / developer"] --> D["Decompose work into independent tasks"]

  D --> A["Option A: Manual worktrees + tmux (highest isolation)"]
  D --> B["Option B: OpenCode background tasks (fast parallel exploration)"]
  D --> C["Option C: Swarm (team-style coordination)"]

  A --> A1["Create 1 git worktree per task"]
  A1 --> A2["Open 1 tmux window per worktree (wm-*)"]
  A2 --> A3["Start 1 agent process per window (claude / codex / opencode)"]
  A3 --> A4["Monitor pane output; detect status (waiting / working / done / error)"]
  A4 --> A5["Rescue approvals (send 'y' + Enter) when verified"]
  A5 --> A6["Merge branches into main; keep worktrees until integration is verified"]
  A6 --> A7["Cleanup: kill tmux windows, remove worktrees, delete branches"]

  B --> B1["Call delegate_task({ run_in_background: true, ... })"]
  B1 --> B2["BackgroundManager launches sub-sessions"]
  B2 --> B3["Check results via background_output({ task_id: ... })"]
  B2 --> BT["(Optional) tmux-parallel-agents hook creates monitoring windows / worktrees"]
  B3 --> I["Integrate results in main session"]
  BT --> I

  C --> C1["Call swarm tool (team plan + task graph)"]
  C1 --> C2["swarm-agent hook orchestrates execution"]
  C2 --> I
```

## Choosing the Right Path

- Prefer **Option A** when you need strong isolation (multiple agents will modify the same files, or tasks will run destructive commands, or you want clean merge boundaries).
- Prefer **Option B** when you want fast parallel exploration (inventory, grep, doc lookup, alternative hypotheses) and integration remains in the main session.
- Prefer **Option C** when you want a structured “team execution” model (explicit roles/tasks, coordination, progress tracking). Swarm can be started manually (`/swarm ...`) or bootstrapped from `/start-work` when Swarm-first is enabled.
### Parallel Runtime Admission Coverage

| Path | Admission Control | Notes |
|------|-------------------|-------|
| **Option A** (manual worktrees + tmux) | **Not controlled** | Intentional — power users manage concurrency themselves |
| **Option B** (background tasks) | **Controlled** via `parallel_runtime` | BackgroundManager acquires/releases slots per task |
| **Option C** (Swarm) | **Controlled** via `parallel_runtime` | Coordinator acquires slots during task assignment |

The `tmux-parallel-agents` hook is a pure infrastructure layer (windows, worktrees, rescue). It does not acquire slots because the underlying subsystem (Background or Swarm) already does.
## Key Docs

- Swarm coordination journey: `docs/journeys/swarm-coordination.md`
- Orchestration guide: `docs/guide/orchestration.md`
- Engineering discipline (skill-based QA loop): `docs/journeys/engineering-discipline.md`
- Contract: `docs/reference/artifacts-and-paths.md`
- Contract: `docs/reference/tools.md`

## Where to Look in Code

- Manual workflow cheat sheet (built-in skill): `src/features/builtin-skills/skills/parallel-agents.ts`
- Background tasks: `src/features/background-agent/` and `src/tools/delegate-task/`
- Tmux integration: `src/hooks/tmux-parallel-agents/`
- Swarm core: `src/features/sisyphus-swarm/`
- Swarm agent hook: `src/hooks/swarm-agent.ts`

## Operational Notes (Safety / UX)

- Treat \`worktree.auto_cleanup=true\` as potentially destructive (forced removal). Keep it off unless you are confident background sessions never leave uncommitted changes.
- Always verify pane content before sending rescue keys; approvals are easy to misfire when an agent is mid-command.
- If you already have a custom \`parallel-agents\` skill installed in `.opencode/skills/` or `~/.claude/skills/`, it will override the built-in \`parallel-agents\` skill with the same name.
