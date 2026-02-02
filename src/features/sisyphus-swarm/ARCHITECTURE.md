# Sisyphus Swarm Architecture

Multi-agent coordination system using file-based messaging.

## Core Components

```
┌─────────────────────────────────────────────────────────────────┐
│                        Coordinator                               │
│  - Creates team, manages membership                              │
│  - Assigns tasks to workers                                      │
│  - Monitors heartbeats, handles completions                      │
└─────────────────────────────────────────────────────────────────┘
        │                                              ▲
        │ task_assignment                              │ task_completed
        ▼                                              │
┌─────────────────┐   ┌─────────────────┐   ┌─────────────────┐
│    Worker 1     │   │    Worker 2     │   │    Worker N     │
│  (tmux window)  │   │  (tmux window)  │   │  (tmux window)  │
└─────────────────┘   └─────────────────┘   └─────────────────┘
```

## File Structure

```
.sisyphus/
├── teams/
│   └── {team-name}/
│       ├── manifest.json          # Team metadata, member list
│       ├── inboxes/
│       │   ├── {agent-id}/        # Per-agent inbox directory
│       │   │   ├── _meta.json     # Inbox metadata (lastRead)
│       │   │   ├── msg_abc.json   # Individual messages
│       │   │   └── msg_def.json
│       │   └── ...
└── tasks/
    └── {list-id}/
        └── {task-id}.json         # Shared task pool (single source of truth)
```

Notes:
- The team manifest references the shared task list via `taskListId` (defaults to the team name).
- In worktree mode, `SISYPHUS_PROJECT_ROOT` is used so all agents share the same `.sisyphus/` directory.

## Message Flow

### Worker Join Flow
```
Worker                          Coordinator
   │                                 │
   │─── join_request ──────────────>│
   │                                 │ (auto-approve or callback)
   │<──── join_approved ────────────│
   │                                 │
   │─── idle_notification ─────────>│
   │                                 │
```

### Task Execution Flow (Decoupled Model)
```
Coordinator                     Worker                      OpenCode Session
    │                              │                              │
    │── task_assignment ──────────>│                              │
    │                              │                              │
    │                              │── prompt(task) ─────────────>│
    │                              │                              │
    │                              │   (Worker stays in           │
    │                              │    "working" state)          │
    │                              │                              │
    │                              │     ... async execution ...  │
    │                              │                              │
    │                              │<── idle timeout / tool ──────│
    │                              │    completion signal         │
    │                              │                              │
    │<── task_completed ──────────│                              │
    │                              │                              │
    │                              │── idle_notification ────────>│
```

## Key Design Decisions

### 1. Per-Message Files (Not Single Inbox File)

**Problem**: Multiple senders writing to same inbox file causes race conditions.

**Solution**: Each message is a separate file in the agent's inbox directory.

```
# Old (race condition):
Read inbox.json → Append message → Write inbox.json

# New (no race):
Write new msg_xxx.json file (atomic file creation)
```

**Trade-off**: More files to manage, but `pruneOldMessages()` handles cleanup.

### 2. Decoupled Task Completion

**Problem**: `onTask` callback model assumes synchronous execution, but OpenCode sessions are async.

**Solution**: Separate task acceptance from completion reporting.

```typescript
// Worker stays in "working" state after accepting
onTaskAssigned(task) → return true

// External code reports completion when done
worker.reportTaskComplete()
```

**Completion Detection Methods**:
1. **Idle timeout**: 5s of no activity → task complete
2. **Tool signals**: `TodoWrite(status=completed)` → task complete
3. **Explicit timeout**: 30 min max per task (configurable)

**Trade-off**: May report completion prematurely if session goes idle mid-task.
Mitigation: Increase idle timeout or use explicit completion tool calls.

### 3. Polling vs File Watching

**Current**: Polling by default (500ms interval).

**Rationale**: `fs.watch()` is platform-dependent and can miss events.

**Trade-off**: CPU overhead vs reliability.

**Future**: Could add exponential backoff when idle.

### 4. Heartbeat-Based Health Detection

**Current**: 10s heartbeat, 30s stale threshold.

**Trade-off**: Fast detection (lower threshold) vs false positives (higher threshold).

**Acceptable**: 30s delay for dead worker detection is reasonable for most use cases.

## State Machine

```
              JOIN_APPROVED
    joining ─────────────────> idle
        │                        │
        │ JOIN_REJECTED          │ TASK_ASSIGNED
        ▼                        ▼
      dead <────────────────  working ──────┐
        ▲                        │          │
        │ SHUTDOWN_APPROVED      │          │ PAUSE
        │                        │          ▼
    leaving <───────────────  idle  <───  paused
                                  ▲          │
                                  │ RESUME   │
                                  └──────────┘
```

### States

| State | Description |
|-------|-------------|
| `joining` | Waiting for coordinator approval |
| `idle` | Ready for work |
| `working` | Executing a task |
| `paused` | Non-blocking wait for external event (permission, plan approval) |
| `leaving` | Graceful shutdown in progress |
| `dead` | No heartbeat, presumed dead |

### Pause Context

When entering `paused` state, the agent saves context:
```typescript
{
  reason: string,      // "Awaiting permission for Bash"
  resumeOn: string,    // "permission_response"
  savedTaskId: string, // Task being worked on
  pausedAt: number,    // Timestamp
  timeoutMs: number,   // Auto-timeout
  requestId: string,   // Request correlation ID
}
```

## Concurrency Safety

### File Locking (v0.3+)

Critical operations use `mkdir`-based atomic locking to prevent race conditions:

```typescript
import { withLockSync } from "./sync/semaphore"

// Safe concurrent writes
withLockSync(manifestPath, () => {
  const manifest = readManifest(teamName, config)
  manifest.members.push(member)
  writeManifest(teamName, manifest, config)
})
```

**Protected Operations**:
- `addMember()`, `removeMember()`, `updateMember()`, `transferCoordinator()`
- `assignTask()` (prevents double-assignment)

**Why mkdir?**
- `mkdir()` is atomic on POSIX systems - only one process succeeds
- Crash safety: the lock directory includes metadata and can be cleaned up safely if the owning PID is no longer alive
- ~50ms retry delay, ~1s max wait

### Task Dependency Cycle Detection

Before adding `blockedBy` dependencies, the system checks for cycles:

```typescript
if (wouldCreateCycle(listId, taskId, blockerId, config)) {
  throw new Error("Cannot add dependency: would create a cycle")
}
```

Uses DFS to detect circular dependencies that would cause deadlocks.

## Permission Flow (v0.3+)

### Non-Blocking Permission Requests

Workers request permission without blocking the main loop:

```typescript
// Worker requests permission
const result = await worker.requestPermission("Bash", { command: "rm -rf" })

if (result.approved) {
  // Execute tool
} else {
  // Handle denial: result.reason
}
```

**Flow**:
1. Worker sends `permission_request`, enters `paused` state
2. Coordinator receives request, classifies risk
3. Low-risk tools (Read, Glob, etc.) auto-approved
4. High-risk tools queued for human approval or callback
5. Worker receives `permission_response`, resumes to `working`

### Auto-Approval Rules

| Risk Level | Tools | Default |
|------------|-------|---------|
| Low | Read, Glob, Grep, LSP, WebFetch, WebSearch, Task, TaskOutput | Auto-approve |
| Medium | Custom tools | Callback decides |
| High | Bash, Write, Edit, NotebookEdit | Human approval |

## Plan Approval (v0.4+)

Workers can request coordinator approval for implementation plans before execution.

### Flow
```
Worker (in plan mode):
  1. Creates plan, calls requestPlanApproval(plan)
  2. Sends plan_approval_request to Coordinator
  3. Enters PAUSED state (non-blocking)

Coordinator:
  1. Receives plan_approval_request
  2. Invokes onPlanApprovalRequest callback (or queues for manual approval)
  3. Sends plan_approval_response

Worker:
  1. Receives plan_approval_response
  2. RESUME to working state
  3. If approved: execute plan
  4. If rejected/revision_requested: handle feedback
```

### Message Types

| Type | Direction | Purpose |
|------|-----------|---------|
| `plan_approval_request` | Worker → Coordinator | Submit plan for approval |
| `plan_approval_response` | Coordinator → Worker | Decision (approved/rejected/revision_requested) |

### Coordinator API

```typescript
// Callback-based (immediate decision)
onPlanApprovalRequest: async (request) => {
  return { decision: "approved", feedback: "LGTM" }
}

// Manual approval
coordinator.approvePlan(requestId, feedback?)
coordinator.rejectPlan(requestId, feedback?)
coordinator.requestPlanRevision(requestId, feedback)
coordinator.getPendingPlanApprovals()
```

## Mode Control (v0.4+)

Coordinator can dynamically change Worker execution modes.

### Permission Modes

| Mode | Description |
|------|-------------|
| `default` | Normal operation, requires permission for high-risk tools |
| `plan` | Force plan mode, require approval before execution |
| `acceptEdits` | Auto-accept edit operations without confirmation |
| `bypassPermissions` | Skip all permission checks (dangerous) |

### Flow
```
Coordinator:
  1. Calls setWorkerMode(workerId, "acceptEdits")
  2. Sends mode_set_request to Worker

Worker:
  1. Receives mode_set_request
  2. Updates internal mode state
  3. Sends mode_set_response (ack)
  4. Subsequent operations use new mode
```

### Message Types

| Type | Direction | Purpose |
|------|-----------|---------|
| `mode_set_request` | Coordinator → Worker | Change worker mode |
| `mode_set_response` | Worker → Coordinator | Acknowledge mode change |

### Coordinator API

```typescript
// Single worker
coordinator.setWorkerMode(workerId, "acceptEdits", {
  reason: "Trusted for batch editing",
  durationMs: 300000  // Auto-reset after 5 min
})

// All workers
coordinator.broadcastMode("plan", {
  reason: "Complex task requires review"
})
```

### Worker API

```typescript
worker.getCurrentMode()  // Returns current PermissionMode
```

### Mode Expiration

Modes can have optional auto-reset:
- If `duration` is specified in mode_set_request, worker resets to `default` after timeout
- Prevents Workers from staying in elevated mode indefinitely

### Mode Behavior

Modes are enforced at two levels:

**1. Worker-enforced (automatic)**:
`requestPermission()` checks mode before contacting coordinator:

```typescript
// In Worker.requestPermission():
if (currentMode === "bypassPermissions") {
  return { approved: true }  // Skip coordinator entirely
}
if (currentMode === "acceptEdits" && ["Edit", "Write", "NotebookEdit"].includes(toolName)) {
  return { approved: true }  // Auto-approve edit tools
}
// Otherwise: send permission_request to coordinator
```

**2. Integration-enforced (hook responsibility)**:
The `plan` mode is NOT automatically enforced. Integration code should check:

```typescript
// In swarm-agent hook:
const mode = worker.getCurrentMode()

if (mode === "plan") {
  // Force plan approval before any execution
  const result = await worker.requestPlanApproval(plan)
  if (result.decision !== "approved") {
    // Handle rejection
  }
}
```

**Mode coverage**:

| Mode | `requestPermission` | `requestPlanApproval` | Notes |
|------|---------------------|----------------------|-------|
| `default` | Normal flow | Normal flow | Standard operation |
| `bypassPermissions` | Auto-approve ALL | Normal flow | Dangerous, use with caution |
| `acceptEdits` | Auto-approve Edit/Write/NotebookEdit | Normal flow | Trusted edit operations |
| `plan` | Normal flow | Normal flow | Hook should enforce plan-first workflow |

**Why `plan` mode is not auto-enforced**:
- Worker doesn't know when a "plan" is created (that's LLM behavior)
- Hook has context to decide when plan approval is needed
- Different integrations may have different plan-first semantics

### Trade-offs

| Decision | Trade-off | Rationale |
|----------|-----------|-----------|
| No auto-approve for plans | Slower workflow | Plans require human judgment; auto-approve would defeat the purpose |
| `bypassPermissions`/`acceptEdits` enforced in Worker | Less flexibility | Consistent behavior; integration doesn't need to check these modes |
| `plan` mode NOT auto-enforced | Hook must check mode | Worker doesn't know when plans are created; hook has context |
| 60s default plan timeout | May be too short for complex plans | Configurable; balance between responsiveness and review time |
| Fire-and-forget mode set | No delivery guarantee | Async messaging pattern; use `onModeChangeAcknowledged` for confirmation |
| Single `revision_requested` decision | No iteration tracking | Simple API; integration code can track revision count if needed |
| Timeout uses RESUME not PAUSE_TIMEOUT | Task stays active | Prevents task orphaning; caller handles timeout as rejection |

## Mailbox Cleanup (v0.3+)

Auto-prune during polling:
- Every 100 polls (configurable via `autoPruneInterval`)
- Removes read messages older than 1 hour (configurable via `pruneMaxAgeMs`)
- Prevents inbox directory bloat for long-running agents

## Coordinator Health Detection (v0.3+)

Workers periodically check coordinator heartbeat:
- Every 5 heartbeats (~50s with default 10s interval)
- Logs warning if coordinator appears offline
- Notifies `onError` callback for external handling

## Known Limitations

| Limitation | Impact | Mitigation |
|------------|--------|------------|
| File I/O latency | ~1-5ms per operation | Acceptable for <100 agents |
| ~~No distributed locking~~ | ~~Theoretically possible data loss~~ | **v0.3: mkdir-based locking** |
| Idle-based completion | May be premature | Configurable timeout, tool signals |
| 30s dead detection | Delayed task reassignment | Acceptable trade-off for reliability |
| Single coordinator | No automatic failover | Manual `/swarm resume` recovery |
| Plan approval no auto-approve | Every plan needs explicit approval | By design - plans need human review |
| Mode control is state-only | Integration must interpret modes | Flexible but requires hook implementation |
| No `team_permission_update` | Cannot broadcast permission policy changes | Use `broadcastMode()` instead (per-worker) |

## Configuration

```yaml
sisyphus:
  swarm:
    enabled: true
    storage_path: ".sisyphus/teams"  # Match schema default
    ui_mode: "toast"
```

Worker-specific:
```typescript
WorkerConfig {
  taskTimeoutMs?: number      // Default: 30 minutes
  heartbeatIntervalMs?: number // Default: 10 seconds
}
```

## Usage

### Start Coordinator
```bash
# In tmux session
opencode
> /swarm create my-feature
> /swarm spawn 3
```

### Worker Auto-Initialization
Workers detect swarm mode via environment variables:
```bash
OPENCODE_SWARM_TEAM="my-feature"
OPENCODE_SWARM_NAME="worker-1"
OPENCODE_SWARM_ROLE="worker"
```

The `swarm-agent` hook automatically:
1. Joins the team
2. Polls for task assignments
3. Prompts the session with assigned tasks
4. Reports completion based on idle/tool signals
