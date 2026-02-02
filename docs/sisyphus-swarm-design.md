# Sisyphus Swarm: Multi-Agent Coordination System

> Design Document v0.4
> Status: Implementation Complete
> Last Updated: 2026-02-02

## 1. Vision & Goals

### 1.1 The Problem

Current orchestration (Sisyphus → delegate_task → Sisyphus-Junior) is **synchronous and single-process**:

```
┌─────────────┐
│  Sisyphus   │ ──delegate_task()──► sisyphus-junior (sync, blocks orchestrator)
└─────────────┘
```

Limitations:
- **Single instance**: Only one Claude Code process handles everything
- **Blocking**: Orchestrator waits for subagent completion
- **No fault isolation**: Subagent crash affects the entire session
- **Limited parallelism**: `run_in_background` helps but still same process
- **No human observability**: Hard to see what each agent is doing

### 1.2 The Solution: Swarm

**Multiple independent agents** coordinating via **file-based mailbox protocol**:

```
┌─────────┐     ┌─────────┐     ┌─────────┐
│ Agent A │     │ Agent B │     │ Agent C │   ← separate terminals/processes
└────┬────┘     └────┬────┘     └────┬────┘
     │               │               │
     └───────────────┴───────────────┘
                     ▼
       .sisyphus/teams/{team}/inboxes/{agentId}/msg_*.json   ← async mailbox (per-message files)
                     ▼
        .sisyphus/tasks/{listId}/{taskId}.json  ← shared task pool
```

### 1.3 Design Principles

1. **File-based IPC**: No daemon, no server. JSON files as message queues.
2. **Decentralized coordination**: Any agent can be coordinator (elected or designated).
3. **Graceful degradation**: Works with 1 agent (no swarm overhead) or N agents.
4. **Observable**: tmux panes show real-time agent activity.
5. **Composable**: Integrates with existing `work-state`, `delegate_task`, `tmux-parallel-agents`.

---

## 2. Architecture Overview

### 2.1 Component Layers

```
┌─────────────────────────────────────────────────────────────────┐
│ Layer 4: UI / Observability                                      │
│   tmux-orchestrator, status-renderer, toast notifications       │
├─────────────────────────────────────────────────────────────────┤
│ Layer 3: Coordination Protocol                                   │
│   coordinator, task-pool, agent-state-machine                   │
├─────────────────────────────────────────────────────────────────┤
│ Layer 2: Mailbox I/O                                             │
│   reader, writer, watcher (file-based message queue)            │
├─────────────────────────────────────────────────────────────────┤
│ Layer 1: Storage & Types                                         │
│   sisyphus-tasks (task storage), mailbox/types (protocol schema)│
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 Directory Structure

```
.sisyphus/
├── work.yaml                    # Per-agent execution state (existing)
├── plans/                       # Markdown plans (existing)
├── notepads/                    # Wisdom accumulation (existing)
├── tasks/                       # NEW: Shared task pool
│   └── {listId}/
│       └── {taskId}.json
└── teams/                       # NEW: Swarm coordination
    └── {teamName}/
        ├── manifest.json        # Team metadata + member list (+ idleWorkers)
        └── inboxes/
            ├── {agentId}/
            │   ├── _meta.json   # Inbox metadata (lastRead, createdAt)
            │   ├── msg_*.json   # Individual message files (append-only, atomic)
            │   └── ...
            └── ...
```

### 2.3 Agent Identity

Each agent has a unique identity within a team:

```typescript
interface AgentIdentity {
  id: string           // Unique ID: `agent_${randomUUID().slice(0, 8)}`
  name: string         // Human-readable: "sisyphus-1", "junior-alpha"
  sessionId: string    // Claude Code session ID
  role: "coordinator" | "worker" | "observer"
  capabilities: string[] // ["code", "research", "review"]
  tmuxPane?: string    // e.g., "swarm:1.2" (session:window.pane)
}
```

---

## 3. Mailbox Protocol

### 3.1 Message Categories

| Category | Messages | Direction |
|----------|----------|-----------|
| **Membership** | `join_request`, `join_approved`, `join_rejected` | Worker → Coordinator |
| **Task Lifecycle** | `task_assignment`, `task_completed`, `task_rejected`, `idle_notification` | Coordinator ↔ Worker |
| **Permissions** | `permission_request`, `permission_response` | Worker ↔ Coordinator |
| **Plan Approval** | `plan_approval_request`, `plan_approval_response` | Worker ↔ Coordinator |
| **Shutdown** | `shutdown_request`, `shutdown_approved`, `shutdown_rejected` | Any → Any |
| **Mode Control** | `mode_set_request`, `mode_set_response` | Coordinator ↔ Worker |

### 3.2 Message Flow Examples

#### Team Formation
```
Agent A (wants to coordinate):
  1. Creates team directory: .sisyphus/teams/frontend-refactor/
  2. Writes manifest.json with self as coordinator
  3. Waits for join requests

Agent B (wants to join):
  1. Reads manifest.json, finds coordinator = Agent A
  2. Sends join_request to Agent A's inbox
  3. Waits for join_approved/rejected

Agent A:
  1. Polls inbox, sees join_request from B
  2. Validates B's capabilities
  3. Sends join_approved to B's inbox
  4. Updates manifest.json member list
```

#### Task Assignment
```
Coordinator:
  1. Reads .sisyphus/tasks/{listId}/ for pending tasks
  2. Finds idle workers (via idle_notification or manifest)
  3. Matches task requirements to worker capabilities
  4. Sends task_assignment to chosen worker's inbox
  5. Updates task status to "in_progress", owner = worker

Worker:
  1. Polls inbox, receives task_assignment
  2. Creates/updates local work-state for the task
  3. Executes task (code, research, etc.)
  4. Sends task_completed to coordinator's inbox
  5. Sends idle_notification (ready for next task)

Coordinator:
  1. Receives task_completed
  2. Updates task status to "completed"
  3. Optionally triggers verification
  4. Assigns next task or acknowledges idle
```

#### Permission Escalation (v0.3+)
```
Worker (needs to run risky command):
  1. Calls requestPermission("Bash", { command: "rm -rf dist/" })
  2. Sends permission_request to coordinator
  3. Transitions to PAUSED state (non-blocking)
  4. Returns Promise (does not block main loop)

Coordinator:
  1. Receives permission_request
  2. Classifies risk level: low/medium/high
  3. Low-risk tools (Read, Glob, etc.): auto-approve
  4. High-risk tools: invoke callback or queue for human approval
  5. Sends permission_response: approved/rejected

Worker:
  1. Promise resolves with { approved: true/false, ... }
  2. Transitions back to WORKING state (via RESUME)
  3. If approved: executes tool
  4. If rejected/timeout: handles gracefully
```

**Auto-approved tools**: Read, Glob, Grep, LSP, WebFetch, WebSearch, Task, TaskOutput

#### Plan Approval (v0.4+)
```
Worker (creates implementation plan):
  1. Calls requestPlanApproval(plan, { planFile, timeoutMs })
  2. Sends plan_approval_request to coordinator
  3. Transitions to PAUSED state (non-blocking)
  4. Returns Promise

Coordinator:
  1. Receives plan_approval_request
  2. If onPlanApprovalRequest callback: invoke for immediate decision
  3. Else: queue for manual approval (approvePlan/rejectPlan/requestPlanRevision)
  4. Sends plan_approval_response: approved/rejected/revision_requested

Worker:
  1. Promise resolves with { decision, feedback? }
  2. Transitions back to WORKING state
  3. If approved: execute plan
  4. If rejected/revision_requested: handle feedback
```

**Key difference from Permission**: Plan Approval has NO auto-approve logic.
All plans require explicit decision (callback or manual).

#### Mode Control (v0.4+)
```
Coordinator:
  1. Calls setWorkerMode(workerId, "acceptEdits", { durationMs })
  2. Sends mode_set_request to worker

Worker:
  1. Receives mode_set_request
  2. Updates internal currentMode state
  3. If duration specified: sets auto-reset timer
  4. Sends mode_set_response (ack)

Subsequent requestPermission() calls:
  - bypassPermissions: auto-approve without contacting coordinator
  - acceptEdits: auto-approve Edit/Write/NotebookEdit tools
  - plan: normal flow (hook should enforce plan-first)
  - default: normal flow
```

**Mode behavior split**:
- `bypassPermissions` and `acceptEdits` are enforced in `requestPermission()` (automatic)
- `plan` mode is NOT auto-enforced - hook must check `getCurrentMode()` and call `requestPlanApproval()` as needed

See ARCHITECTURE.md "Mode Behavior" for details.

### 3.3 Inbox File Format

To avoid cross-process write races, Swarm uses **per-message files** in a **per-agent inbox directory**.

Each inbox directory contains:

- `_meta.json`: lightweight metadata for the inbox (e.g. `lastRead`)
- `msg_*.json`: a single message envelope per file (atomic write, safe for concurrent senders)

Example `_meta.json`:

```json
{
  "agentId": "agent_a1b2c3d4",
  "createdAt": 1706745590000,
  "lastRead": 1706745600000
}
```

Example message file `msg_xyz123.json`:

```json
{
  "id": "msg_xyz123",
  "from": "agent_e5f6g7h8",
  "timestamp": 1706745590000,
  "read": false,
  "payload": {
    "type": "task_assignment",
    "taskId": "task_001",
    "subject": "Refactor auth module",
    "description": "...",
    "assignedBy": "agent_e5f6g7h8",
    "timestamp": 1706745590000
  }
}
```

### 3.4 Polling & File Watching

Two modes for inbox monitoring:

1. **Polling** (simple, portable):
   ```typescript
   setInterval(async () => {
     const messages = await readUnread(teamName, agentId)
     for (const msg of messages) {
       await handleMessage(msg)
       await markAsRead(teamName, agentId, [msg.id])
     }
   }, 1000) // 1 second interval
   ```

2. **File watching** (efficient, platform-dependent):
   ```typescript
   const watcher = fs.watch(inboxDir, async () => {
     // Debounce and process new messages
   })
   ```

**Current default**: polling is used by default for reliability; `fs.watch()` is available as an optimization but must gracefully fall back to polling on errors.

---

## 4. Task Pool Integration

### 4.1 Relationship with sisyphus-tasks

`sisyphus-tasks` provides:
- Task CRUD with Zod validation
- Atomic file writes
- Dependency tracking (`blocks`, `blockedBy`)
- Claude Code compatibility mode

Swarm adds:
- Task assignment (`owner` field)
- Task distribution logic
- Dependency resolution for assignment order

### 4.2 Task Assignment Algorithm

```typescript
function findNextTask(tasks: Task[], worker: AgentIdentity): Task | null {
  return tasks
    .filter(t => t.status === "pending")
    .filter(t => t.blockedBy.every(id => isCompleted(id)))
    .filter(t => matchesCapabilities(t, worker))
    .sort((a, b) => {
      // Priority: explicit priority > dependency depth > creation order
      if (a.metadata?.priority !== b.metadata?.priority) {
        return (b.metadata?.priority ?? 0) - (a.metadata?.priority ?? 0)
      }
      return dependencyDepth(a) - dependencyDepth(b)
    })[0] ?? null
}
```

### 4.3 Task Stealing (Optional)

For load balancing when some workers finish faster:

```
Worker A: Completes task, sends idle_notification
Coordinator: Checks if Worker B has multiple queued tasks
Coordinator: "Steals" one task from B's queue, assigns to A
```

---

## 5. Agent State Machine

### 5.1 States

```
                    ┌──────────────┐
                    │   JOINING    │ ← Initial state
                    └──────┬───────┘
                           │ join_approved
                           ▼
┌──────────┐       ┌──────────────┐
│  LEAVING │ ◄──── │     IDLE     │ ◄─────────────────┐
└────┬─────┘       └──────┬───────┘                   │
     │                    │ task_assignment           │
     ▼                    ▼                           │
┌──────────┐       ┌──────────────┐                   │
│   DEAD   │       │   WORKING    │ ──────────────────┤
└──────────┘       └──────┬───────┘  task_completed   │
                          │                           │
                          │ PAUSE (permission_request)│
                          ▼                           │
                   ┌──────────────┐                   │
                   │   PAUSED     │ ─── RESUME ───────┘
                   └──────────────┘  or timeout
```

**State Descriptions:**
- `JOINING`: Waiting for coordinator approval
- `IDLE`: Ready for work
- `WORKING`: Executing a task
- `PAUSED`: Non-blocking wait for external event (permission, plan approval)
- `LEAVING`: Graceful shutdown in progress
- `DEAD`: No heartbeat / terminated

### 5.2 State Persistence

Each agent persists its state in work-state:

```yaml
# .sisyphus/work.yaml (per-agent)
swarm:
  team: "frontend-refactor"
  agent_id: "agent_a1b2c3d4"
  role: "worker"
  state: "working"
  current_task: "task_001"
  last_heartbeat: 1706745600000
```

---

## 6. Coordinator Election

### 6.1 Initial Coordinator

The first agent to create a team becomes coordinator:

```typescript
async function createTeam(teamName: string, agent: AgentIdentity): Promise<void> {
  const teamDir = getTeamDir(teamName, config)
  await ensureDir(teamDir)

  const manifest: TeamManifest = {
    name: teamName,
    createdAt: Date.now(),
    coordinatorId: agent.id,
    members: [agent],
  }

  await writeJsonAtomic(join(teamDir, "manifest.json"), manifest)
}
```

### 6.2 Coordinator Failover (Future)

If coordinator becomes unresponsive:

1. Workers detect via heartbeat timeout
2. A new coordinator may take over (manual or automated), guarded by heartbeat-based split-brain prevention
3. New coordinator updates the team manifest and resumes assignment

Current implementation provides **heartbeat-guarded coordinator takeover** (no full Raft/consensus).

---

## 7. Integration with Existing Systems

### 7.1 work-state Integration

Each Swarm agent maintains its own work-state:

```
Agent A: .sisyphus/work.yaml (in its worktree)
Agent B: .sisyphus/work.yaml (in its worktree)
```

Swarm-specific fields added:
```yaml
swarm:
  enabled: true
  team: "frontend-refactor"
  agent_id: "agent_a1b2c3d4"
  role: "worker"
  state: "working"
```

### 7.2 delegate_task Integration

New delegation mode: `swarm`:

```typescript
delegate_task({
  prompt: "Refactor auth module",
  mode: "swarm",  // NEW: async via Swarm
  team: "frontend-refactor",
  // ... other args
})
```

Behavior:
1. Creates task in .sisyphus/tasks/
2. Returns immediately (async)
3. Swarm coordinator assigns to available worker
4. Result collected via `swarm_task_result(taskId)`

### 7.3 tmux-parallel-agents Integration

Reuse existing infrastructure:

```typescript
// When Swarm agent spawns
const pane = await createTmuxPane({
  sessionName: "swarm",
  windowName: teamName,
  command: `opencode --swarm-agent ${agentId} --team ${teamName}`,
})

// Status updates via existing status_icons config
await setTmuxPaneName(pane, `${agentName} ${statusIcon}`)
```

### 7.4 Git Worktree Integration

Each Swarm agent gets isolated filesystem:

```
project/                          # Main repo
../project__worktrees/
  ├── swarm-agent-a1b2c3d4/      # Agent A's worktree
  │   ├── .sisyphus/work.yaml    # Agent A's state
  │   └── src/                   # Isolated changes
  └── swarm-agent-e5f6g7h8/      # Agent B's worktree
      ├── .sisyphus/work.yaml    # Agent B's state
      └── src/                   # Isolated changes

.sisyphus/teams/                  # Shared (in main repo)
.sisyphus/tasks/                  # Shared (in main repo)
```

**Worktree mode and shared `.sisyphus`**:
When running agents in separate git worktrees, the orchestrator sets `SISYPHUS_PROJECT_ROOT`
so that `getProjectRoot()` resolves to the main project directory and all agents share the same
`.sisyphus/` storage (teams + tasks), even if their `cwd` differs.

---

## 8. Configuration

### 8.1 Config Schema

```typescript
// Already added to src/config/schema.ts

export const SisyphusSwarmConfigSchema = z.object({
  /** Enable Sisyphus Swarm system (default: false) */
  enabled: z.boolean().default(false),
  /** Storage path for teams (default: .sisyphus/teams) */
  storage_path: z.string().default(".sisyphus/teams"),
  /** UI mode: toast notifications, tmux panes, or both */
  ui_mode: z.enum(["toast", "tmux", "both"]).default("toast"),
})
```

### 8.2 Extended Config (Future)

```typescript
export const SisyphusSwarmConfigSchema = z.object({
  enabled: z.boolean().default(false),
  storage_path: z.string().default(".sisyphus/teams"),
  ui_mode: z.enum(["toast", "tmux", "both"]).default("toast"),

  // Polling configuration
  polling: z.object({
    interval_ms: z.number().min(100).max(10000).default(1000),
    use_file_watcher: z.boolean().default(false),
  }).optional(),

  // Coordination configuration
  coordination: z.object({
    heartbeat_interval_ms: z.number().default(5000),
    heartbeat_timeout_ms: z.number().default(15000),
    task_stealing: z.boolean().default(false),
  }).optional(),

  // Agent defaults
  agent_defaults: z.object({
    capabilities: z.array(z.string()).default(["code"]),
    max_concurrent_tasks: z.number().min(1).max(5).default(1),
  }).optional(),
})
```

---

## 9. Implementation Phases

### Phase 1: Mailbox I/O (Foundation) ✅ Complete

**Goal**: Basic message passing between agents.

**Deliverables**:
```
src/features/sisyphus-swarm/
├── mailbox/
│   ├── types.ts       ✅
│   ├── types.test.ts  ✅
│   ├── reader.ts      ✅
│   ├── reader.test.ts ✅
│   ├── writer.ts      ✅
│   ├── writer.test.ts ✅
│   ├── watcher.ts     ✅ (with auto-prune)
│   ├── watcher.test.ts ✅
│   └── index.ts       ✅
└── index.ts           ✅
```

**API**:
```typescript
// Read all messages from an agent's inbox
function readInbox(teamName: string, agentId: string): Promise<InboxMessage[]>

// Read unread messages only
function readUnread(teamName: string, agentId: string): Promise<InboxMessage[]>

// Send message to specific agent
function sendMessage(teamName: string, toAgentId: string, message: ProtocolMessage): Promise<void>

// Broadcast to all team members
function broadcast(teamName: string, message: ProtocolMessage): Promise<void>

// Mark messages as read
function markAsRead(teamName: string, agentId: string, messageIds: string[]): Promise<void>

// Start polling for new messages
function startPolling(teamName: string, agentId: string, handler: MessageHandler): Disposable
```

**Success Criteria**:
- [x] Two separate processes can exchange messages via files
- [x] Messages are validated with Zod schemas
- [x] Atomic writes prevent corruption
- [x] Basic tests pass (141 tests)

---

### Phase 2: Team Coordination (Protocol) ✅ Complete

**Goal**: Agents can form teams and coordinate tasks.

**Deliverables**:
```
src/features/sisyphus-swarm/
├── mailbox/           ✅
├── team/
│   ├── types.ts       ✅
│   ├── manifest.ts    ✅ (with file locking)
│   ├── membership.ts  ✅
│   └── index.ts       ✅
├── task-pool/
│   ├── types.ts       ✅
│   ├── pool.ts        ✅ (with cycle detection)
│   ├── assignment.ts  ✅
│   └── index.ts       ✅
├── agent/
│   ├── state.ts       ✅ (with PAUSED state)
│   ├── worker.ts      ✅ (non-blocking permissions)
│   ├── coordinator.ts ✅ (auto-approve + callbacks)
│   └── index.ts       ✅
└── sync/
    ├── semaphore.ts   ✅ (mkdir-based locking)
    └── index.ts       ✅
```

**Success Criteria**:
- [x] Agent can create team and become coordinator
- [x] Agent can join existing team
- [x] Coordinator can assign tasks from pool
- [x] Worker completes task and reports back
- [x] Non-blocking permission requests (PAUSED state)
- [x] Concurrent write protection (file locking)
- [x] Task cycle dependency detection

---

### Phase 3: tmux Integration (Observability) ✅ Complete

**Goal**: Visual management of Swarm agents.

**Deliverables**:
```
src/features/sisyphus-swarm/
├── tmux/
│   ├── utils.ts         ✅
│   ├── orchestrator.ts  ✅ (with paused status icon)
│   └── index.ts         ✅
└── hooks/
    └── swarm-agent.ts   ✅
```

**Success Criteria**:
- [x] `/swarm start` creates tmux session with coordinator
- [x] `/swarm spawn N` adds N worker agents in panes
- [x] Status line shows agent states (including paused ⏳)
- [x] `/swarm status` shows team overview

---

### Phase 4: Production Hardening ✅ Complete (v0.3)

**Goal**: Reliable operation in real projects.

**Deliverables**:
- [x] File locking (mkdir-based semaphore) prevents race conditions
- [x] Heartbeat-based coordinator health detection
- [x] Auto-prune mailbox to prevent bloat
- [x] Task dependency cycle detection
- [x] Non-blocking permission flow (PAUSED state)
- [x] Extended TaskAssignment with context fields
- [ ] Task stealing for load balancing (future)
- [ ] Automatic coordinator failover (future)

---

### Phase 5: Plan Approval & Mode Control ✅ Complete (v0.4)

**Goal**: Enable human-in-the-loop plan review and dynamic worker mode control.

**Deliverables**:
- [x] `plan_approval_request` / `plan_approval_response` message types
- [x] `requestPlanApproval()` Worker API with PAUSED state
- [x] `approvePlan()` / `rejectPlan()` / `requestPlanRevision()` Coordinator API
- [x] `onPlanApprovalRequest` callback for automatic decisions
- [x] `mode_set_request` / `mode_set_response` message types
- [x] `PermissionMode` enum: default, plan, acceptEdits, bypassPermissions
- [x] `setWorkerMode()` / `broadcastMode()` Coordinator API
- [x] `getCurrentMode()` Worker API with auto-expiration
- [x] Mode duration auto-reset timer
- [ ] `team_permission_update` broadcast (deferred - use broadcastMode instead)

**Design Decisions**:
- Plan Approval has NO auto-approve (all plans need explicit decision)
- Mode is state-only; behavior interpretation is integration's responsibility
- Mode expiration prevents Workers staying in elevated mode indefinitely

---

## 10. CLI Commands (Future)

```bash
# Team management
opencode /swarm create frontend-refactor
opencode /swarm join frontend-refactor
opencode /swarm leave
opencode /swarm status

# Agent spawning
opencode /swarm spawn 3              # Spawn 3 workers
opencode /swarm spawn --role=oracle  # Spawn specialized agent

# Task management
opencode /swarm tasks                # List all tasks
opencode /swarm assign task_001 agent_xyz  # Manual assignment

# Observability
opencode /swarm logs agent_xyz       # View agent logs
opencode /swarm inspect agent_xyz    # View agent state
```

---

## 11. Open Questions

1. **Shared vs Per-Agent Tasks Directory**
   - Option A: Single `.sisyphus/tasks/` in main repo (current design)
   - Option B: Tasks replicated to each worktree
   - Recommendation: Option A (simpler, single source of truth)

2. **Coordinator Persistence**
   - What happens if coordinator's terminal closes?
   - Options: Auto-failover, manual reassignment, or "coordinator must be human-attended"

3. **Task Granularity**
   - Should each subtask be a Swarm task, or keep task = high-level goal?
   - Recommendation: High-level tasks for Swarm, subtasks handled by individual agents

4. **Permission Escalation UX**
   - Who approves permission_request: coordinator agent or human?
   - Recommendation: Coordinator by default, with option to escalate to human

---

## 12. References

- [upstream-sync-notes.md](./upstream-sync-notes.md) - Upstream Swarm status
- [understanding-orchestration-system.md](./understanding-orchestration-system.md) - Current architecture
- [category-skill-guide.md](./category-skill-guide.md) - Delegation system
