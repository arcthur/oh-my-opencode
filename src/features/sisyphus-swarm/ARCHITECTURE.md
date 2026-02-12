# Sisyphus Swarm Architecture (2026-02)

This document describes the current implementation of Sisyphus Swarm, including control-plane responsibilities, data-plane semantics, concurrency guarantees, and security boundaries.

Swarm defaults to a local filesystem transport and does not require external infrastructure.

## 1. Design Goals

1. Local-first reliability: stable operation for single-host tmux + multi-agent workflows.
2. Crash recovery: reconstructable state from persisted artifacts after process failure.
3. Verifiable control flow: sender, epoch, and signature checks on privileged messages.
4. Evolvability: business logic decoupled from transport details via `MailboxTransport`.

## 2. Planes and Responsibilities

### Control Plane

- `SwarmRuntimeService`: single in-process owner for session/team/runtime-handle mappings.
- `CoordinatorAgent`: membership governance, assignment orchestration, approval arbitration, stale-worker handling.
- `WorkerAgent`: execution runtime, heartbeat emission, permission/plan requests, completion reporting.
- `coordinator-lease.json`: coordinator lease ownership + epoch fencing.

### Data Plane

- Filesystem mailbox queue (`pending/processing/done`) for inter-agent messaging.
- TaskGraph (`scope=swarm`, `container_id=teamName`) for task state/dependency lifecycle.
- Dedicated heartbeat and idle stores to avoid manifest write hotspots.

## 3. Storage Layout

```text
.sisyphus/
├── teams/
│   └── {teamName}/
│       ├── manifest.json
│       ├── coordinator-lease.json
│       ├── heartbeats/
│       │   └── {agentId}.json
│       ├── idle/
│       │   └── {agentId}.idle
│       ├── security/
│       │   └── control-message-signing-key.json
│       ├── diagnostics/
│       │   └── late-responses/
│       │       └── *.json
│       └── inboxes/
│           └── {agentId}/
│               ├── _meta.json
│               ├── pending/
│               ├── processing/
│               └── done/
└── tasks/
    └── swarm/
        └── {teamName}/
            └── task_*.json
```

Notes:

- `manifest.json` is low-frequency topology/configuration state only (members, coordinator, settings).
- High-frequency runtime signals (`heartbeat`, `idle`) are persisted outside manifest.

## 4. Protocol Envelope and Trust Model

Envelope shape (`InboxMessage`):

```ts
type EnvelopeAuth = {
  alg: "ed25519"
  keyId: string
  sig: string
}

type InboxMessage = {
  id: string
  from: string
  timestamp: number
  read: boolean
  epoch?: number
  auth?: EnvelopeAuth
  payload: ProtocolMessage
}
```

Privileged control messages (sender-validated and signature-validated by default):

- `permission_response`
- `plan_approval_response`
- `mode_set_request`
- `shutdown_approved`
- `shutdown_rejected`

## 5. Core Execution Flows

### 5.1 Join / Leave

1. Worker sends `join_request`.
2. `join_request.capabilities` is required; missing/invalid payload is rejected and logged as `invalid_join_request`.
3. Coordinator persists membership first (`addMemberAsync`), then emits `join_approved`.
4. Worker accepts `join_approved` only when:
   - `message.from === coordinatorId`, and
   - membership is already persisted.
5. Leave is coordinator-arbitrated; `shutdown_*` validation includes sender checks and signature checks (default).

### 5.2 Assignment / Completion

1. Coordinator selects from idle workers and sends `task_assignment`.
2. Busy workers emit `task_rejected`; coordinator safely requeues/reassigns.
3. Worker completion emits `task_completed`.
4. Coordinator enforces:
   - known-worker sender check,
   - `message.from === payload.agentId`,
   - epoch match against current coordinator lease epoch.

### 5.3 Permission and Plan Approval

1. Worker transitions to `paused` while awaiting approval response.
2. Coordinator maintains bounded pending stores (TTL + max entries).
3. Late responses after timeout are not silently dropped:
   - structured security events are emitted,
   - diagnostics are persisted under `diagnostics/late-responses/` (24h retention by default).

## 6. Concurrency and Consumption Semantics

### 6.1 Mailbox Queue Semantics

Main consumption path:

1. `claimPendingMessages()`: atomic `pending -> processing` rename.
2. On success: `ackProcessedMessage()` (delete by default, optional done retention for diagnostics).
3. On handler failure/no-consume: `requeueClaimedMessage()`.
4. Crash recovery: `requeueExpiredProcessing()`.

This removes read-modify-write races and provides single-host claim-based single-consumer semantics per message.

### 6.2 Watch + Fallback Poll

- `startWatching()` uses `fs.watch` with debounced drain.
- A low-frequency fallback poll always runs (default: 5s), even when watch is healthy.
- On watch error, the watcher degrades to polling without interrupting processing.

### 6.3 Locking Policy

- Runtime hot paths use async `withLock()`.
- Team management runtime paths do not use synchronous `withLockSync()`.

## 7. Consistency and Split-Brain Mitigation

`coordinator-lease.json` fields:

- `holderId`
- `epoch`
- `leaseExpiresAt`
- `updatedAt`

Semantics:

1. Coordinator periodically renews lease.
2. Successful takeover increments epoch.
3. Worker and coordinator both enforce epoch checks and reject stale-epoch control flow.
4. Sender + epoch validation significantly narrows split-brain pollution windows.

## 8. Security Hardening

### 8.1 Sender Validation

- Workers accept privileged controls only from the active coordinator.
- Coordinator accepts upstream controls only from known worker members.
- Invalid sender/role combinations generate security events.

### 8.2 Control Message Signatures

- Coordinator signs privileged controls using Ed25519.
- Workers reject unverifiable signatures and emit audit logs.
- Default behavior: `enforce_signature=true`.

### 8.3 Auto-Rescue Policy

- Default: `auto_rescue_policy=disabled`.
- `allowlist` mode only auto-confirms prompts matching configured patterns.
- Non-allowlisted prompts are never auto-confirmed.

## 9. Key Defaults

```yaml
sisyphus:
  swarm:
    watch_fallback_poll_ms: 5000
    enforce_sender_validation: true
    enforce_signature: true
    coordinator_lease_ttl_ms: 15000
    coordinator_lease_renew_ms: 5000
    auto_rescue_policy: "disabled"
    auto_rescue_allowlist: []
```

## 10. Latest-Only Constraints

1. Mailbox supports queue directories only: `pending/processing/done`.
2. Team APIs are async-only for runtime operations:
   - `addMemberAsync`
   - `removeMemberAsync`
   - `updateMemberAsync`
   - `takeoverAsCoordinatorAsync`
3. Idle state is sourced from `idle-store`; manifest no longer stores `idleWorkers`.

## 11. Known Limits and Next Steps

1. Single-coordinator topology remains; automatic failover policy is not fully implemented.
2. Default FS transport targets single-host semantics; cross-host consistency/isolation is out of scope.
3. Signing key lifecycle is local-file based; key rotation/multi-key rollout is not yet implemented.

## 12. Code Map

- Control plane: `src/features/sisyphus-swarm/agent/`
- Team + lease + heartbeat + idle: `src/features/sisyphus-swarm/team/`
- Mailbox + transport: `src/features/sisyphus-swarm/mailbox/`
- Security: `src/features/sisyphus-swarm/security/`
- Task assignment: `src/features/sisyphus-swarm/task-graph/`
- Runtime owner: `src/features/sisyphus-swarm/runtime/`
