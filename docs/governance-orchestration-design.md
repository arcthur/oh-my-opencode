# Governance Orchestration Design

> Architecture design document for governance-oriented orchestration

## 1. Design Philosophy

### 1.1 Core Principle: Governance over Definition

The core value of oh-my-opencode lies not in "defining workflows" but in "establishing guardrails for LLM behavior."

| Dimension | Definition-Oriented (Lobster) | Governance-Oriented (oh-my-opencode) |
|-----------|-------------------------------|--------------------------------------|
| Workflow Definition | Explicit DSL (YAML/Pipeline) | Implicit Hook Chain |
| Execution Path | Predefined, Deterministic | LLM Dynamic Decision |
| Core Value | Predictable, Replayable | Observable, Intervenable |
| Target Scenario | Data Processing Tasks | Development Tasks |

**Key Insight**: Development task paths are dynamically decided by LLMs. Forcing predefined workflows limits agent autonomy. What we need is **observability**, not **definability**.

### 1.2 Environment Philosophy: Reconciliation over Snapshot

**Lobster's Snapshot Logic**: Resume Tokens assume immutability—each step's output is treated as a constant, and resuming execution is like restarting from a snapshot.

**oh-my-opencode's Reconciliation Logic**: Similar to Kubernetes' Reconciliation Loop, we don't trust "snapshots"—we only trust "the currently observed system state."

**Design Choice**: In development scenarios, external codebases change constantly, and Token-captured context may become stale. Therefore:
- No **snapshot-style Resume Tokens** (tokens that assume immutable state)
- Allow **checkpoint-refs** (references to semantic checkpoints for recovery)
- Allow **approval-tokens** (short-lived tokens for suspend/resume flow)
- Introduce **Semantic State Checkpoints** with environment awareness
- Environment hash changes trigger "partial re-perception" rather than full reruns

> **Terminology Clarification**: When we say "no Resume Tokens," we specifically mean snapshot-style tokens that treat past state as immutable truth. We DO use:
> - `resumeToken` in `SuspendInfo` - a short-lived approval flow token (default TTL: 30 minutes; configurable via `approval.tokenExpiryMs`)
> - `checkpointId` - a reference to a semantic checkpoint that can be re-validated

---

## 2. Core Components

### 2.1 Semantic Checkpoint

#### 2.1.1 Problem Statement

Resume Tokens work for data processing scenarios but have fundamental issues in development contexts:
- Codebases can change at any time (other commits, manual edits)
- Environment dependencies may change (package.json, lock files)
- LLM context assumptions may become invalid

Simple "rerun if environment hash changed" is also imprecise, causing unnecessary repeated work.

#### 2.1.2 Design: Layered State Model

The environment is not a single entity but multi-layered:

```
Layer 0: Task Intent      - The task definition itself (plan.md intent)
Layer 1: Affected Files   - Code files involved in the task
Layer 2: Dependencies     - Environment dependencies (package.json, lock files)
Layer 3: System State     - Git status, branch information
```

#### 2.1.3 Interface Definition

```typescript
/**
 * Semantic checkpoint for development tasks
 * Tracks task state with environment awareness
 */
interface SemanticCheckpoint {
  /** Unique identifier for this checkpoint */
  id: string

  /** Timestamp of checkpoint creation */
  createdAt: number

  /** Layer 0: Semantic fingerprint of task intent */
  taskIntent: {
    hash: string           // Content hash of task description
    summary: string        // Human-readable summary
    affectedScope: string[] // Expected affected paths (glob patterns)
  }

  /** Layer 1: Tracked files with their roles */
  affectedFiles: Map<string, FileState>

  /** Layer 2: Critical dependency versions */
  criticalDeps: {
    lockfileHash?: string  // package-lock.json / bun.lockb hash
    configHashes: Map<string, string> // tsconfig, etc.
  }

  /** Layer 3: Git context */
  gitContext: {
    branch: string
    baseCommit: string
    hasUncommittedChanges: boolean
  }

  /** Completed phases and their outputs */
  completedPhases: PhaseRecord[]

  /** Pending work */
  pendingPhases: TaskPhase[]
}

/**
 * Serialization Protocol for Checkpoints
 *
 * Checkpoints need to persist to disk and transfer across processes.
 * Map<K, V> does not serialize to JSON directly, so we define explicit
 * serialization formats.
 */
interface SerializedCheckpoint {
  /** Schema version for forward compatibility */
  schemaVersion: "1.0"

  /** Standard fields (no Maps) */
  id: string
  createdAt: number
  taskIntent: SemanticCheckpoint["taskIntent"]
  gitContext: SemanticCheckpoint["gitContext"]
  completedPhases: PhaseRecord[]
  pendingPhases: TaskPhase[]

  /**
   * Map<string, FileState> serialized as array of entries
   * JSON: [["path/to/file", { contentHash: "...", ... }], ...]
   */
  affectedFiles: Array<[string, FileState]>

  /**
   * criticalDeps.configHashes serialized as array of entries
   * JSON: [["tsconfig.json", "abc123"], ...]
   */
  criticalDeps: {
    lockfileHash?: string
    configHashes: Array<[string, string]>
  }
}

/**
 * Serialize checkpoint for storage
 */
function serializeCheckpoint(cp: SemanticCheckpoint): SerializedCheckpoint {
  return {
    schemaVersion: "1.0",
    id: cp.id,
    createdAt: cp.createdAt,
    taskIntent: cp.taskIntent,
    gitContext: cp.gitContext,
    completedPhases: cp.completedPhases,
    pendingPhases: cp.pendingPhases,
    affectedFiles: Array.from(cp.affectedFiles.entries()),
    criticalDeps: {
      lockfileHash: cp.criticalDeps.lockfileHash,
      configHashes: Array.from(cp.criticalDeps.configHashes.entries())
    }
  }
}

/**
 * Deserialize checkpoint from storage
 */
function deserializeCheckpoint(data: SerializedCheckpoint): SemanticCheckpoint {
  return {
    id: data.id,
    createdAt: data.createdAt,
    taskIntent: data.taskIntent,
    gitContext: data.gitContext,
    completedPhases: data.completedPhases,
    pendingPhases: data.pendingPhases,
    affectedFiles: new Map(data.affectedFiles),
    criticalDeps: {
      lockfileHash: data.criticalDeps.lockfileHash,
      configHashes: new Map(data.criticalDeps.configHashes)
    }
  }
}

interface FileState {
  /** Content hash */
  contentHash: string

  /** AST-level semantic hash (ignores formatting) */
  semanticHash: string

  /** Export fingerprint for impact propagation */
  exportFingerprint?: ExportFingerprint

  /**
   * Role in this task (ACCESS INTENT - does not change during propagation)
   * - read: File is read/imported by task
   * - write: File is modified by task
   * - both: File is both read and written
   */
  role: "read" | "write" | "both"

  /**
   * Validity state (FRESHNESS - changes during impact propagation)
   * - valid: Our cached state matches actual file
   * - stale: Minor changes detected, may still be usable
   * - invalid: Major changes detected, must re-read
   */
  validity: "valid" | "stale" | "invalid"

  /** Last known modification time */
  mtime: number

  /** Files that import/depend on this file */
  consumers?: string[]
}

/**
 * Export fingerprint for tracking API surface changes
 * Used for impact propagation when public API changes
 */
interface ExportFingerprint {
  /** Hash of exported function signatures */
  functionSignatures: string

  /** Hash of exported type definitions */
  typeDefinitions: string

  /** Hash of exported constants/values */
  exportedValues: string

  /** List of exported identifiers */
  exportedNames: string[]
}

/**
 * Task Phase Model
 *
 * Development tasks follow a 5-phase lifecycle. Each phase has:
 * - Clear inputs and outputs
 * - Defined replay semantics for partial-rerun recovery
 *
 * | Phase       | Input                    | Output                  | Replay Semantics           |
 * |-------------|--------------------------|-------------------------|----------------------------|
 * | perception  | Task description         | Codebase understanding  | Re-read changed files      |
 * | planning    | Understanding + intent   | Implementation plan     | Re-plan from new state     |
 * | execution   | Plan + file states       | Code changes            | Resume from last completed |
 * | verification| Changed files            | Test results, lint      | Re-run all checks          |
 * | delivery    | Verified changes         | Commit, PR, docs        | Idempotent (skip if done)  |
 */
type TaskPhase =
  | "perception"   // Understanding codebase state
  | "planning"     // Creating implementation plan
  | "execution"    // Writing/modifying code
  | "verification" // Running tests, linting
  | "delivery"     // Committing, creating PR

/**
 * Phase definitions with replay behavior
 */
const PHASE_DEFINITIONS: Record<TaskPhase, {
  description: string
  replayBehavior: "re-execute" | "resume" | "skip-if-done"
  requiresValidation: boolean
}> = {
  perception: {
    description: "Gather understanding of current codebase state",
    replayBehavior: "re-execute",  // Always re-perceive on drift
    requiresValidation: true
  },
  planning: {
    description: "Create or update implementation plan",
    replayBehavior: "re-execute",  // Re-plan from current understanding
    requiresValidation: true
  },
  execution: {
    description: "Implement planned changes",
    replayBehavior: "resume",      // Resume from last completed step
    requiresValidation: false
  },
  verification: {
    description: "Validate changes via tests and linting",
    replayBehavior: "re-execute",  // Always re-verify
    requiresValidation: false
  },
  delivery: {
    description: "Commit and publish changes",
    replayBehavior: "skip-if-done", // Idempotent - don't double-commit
    requiresValidation: false
  }
}

/**
 * Get phases that need re-execution after a given phase
 * Used by partial-rerun recovery
 */
function getPhasesAfter(phase: TaskPhase): TaskPhase[] {
  const order: TaskPhase[] = ["perception", "planning", "execution", "verification", "delivery"]
  const index = order.indexOf(phase)
  return order.slice(index + 1)
}

interface PhaseRecord {
  /** Which phase this record represents */
  phase: TaskPhase
  phaseId: string
  completedAt: number
  outputSummary: string
  outputFiles: string[]
}
```

#### 2.1.4 AST Limitations and Lazy Fingerprinting

**Problem**: AST does not represent runtime intent:
- Changing a constant's value leaves AST structure unchanged (both are Literals), but business logic changes
- Modifying a public function referenced by multiple files has hard-to-track impact

**Solution: Impact Propagation + Lazy Fingerprinting**

```typescript
/**
 * Lazy fingerprint strategy
 * - Normal mode: Only track mtime (fast)
 * - Conflict mode: Trigger AST comparison (precise)
 */
interface FingerprintStrategy {
  mode: "fast" | "precise"

  /**
   * Fast mode: mtime-based change detection
   */
  detectChangeFast(file: string, lastKnown: FileState): boolean

  /**
   * Precise mode: AST + export fingerprint comparison
   * Only invoked when:
   * 1. Fast detection found a change
   * 2. We're in recovery mode
   * 3. User explicitly requests verification
   */
  detectChangePrecise(file: string, lastKnown: FileState): ChangeAnalysis
}

interface ChangeAnalysis {
  /** Whether the change is semantically significant */
  isSignificant: boolean

  /** Type of change detected */
  changeType:
    | "formatting-only"      // AST unchanged, safe to ignore
    | "internal-refactor"    // AST changed but exports unchanged
    | "api-change"           // Export fingerprint changed
    | "value-change"         // Constant/config value changed

  /** If api-change, list affected consumers */
  affectedConsumers?: string[]

  /** Confidence level of analysis */
  confidence: "high" | "medium" | "low"
}

/**
 * File validity states (separate from role!)
 *
 * - role: Access intent (read/write/both) - does NOT change during propagation
 * - validity: Whether the file state is current - DOES change during propagation
 */
type FileValidity = "valid" | "stale" | "invalid"

/**
 * Impact propagation: When a file's export fingerprint changes,
 * mark all consumers' validity as stale/invalid
 *
 * IMPORTANT: We mark VALIDITY, not ROLE. Role is "how we access the file"
 * (read/write), validity is "is our cached state current".
 */
function propagateImpact(
  changedFile: string,
  checkpoint: SemanticCheckpoint,
  severity: "minor" | "major" = "major",
  visited: Set<string> = new Set()  // Prevent infinite recursion in cyclic deps
): string[] {
  // Cycle detection
  if (visited.has(changedFile)) return []
  visited.add(changedFile)

  const fileState = checkpoint.affectedFiles.get(changedFile)
  if (!fileState?.consumers) return []

  const affected: string[] = []

  for (const consumer of fileState.consumers) {
    const consumerState = checkpoint.affectedFiles.get(consumer)
    if (consumerState) {
      // Mark consumer VALIDITY based on severity (NOT role - role is access intent)
      consumerState.validity = severity === "major" ? "invalid" : "stale"
      affected.push(consumer)

      // Recursively propagate if consumer also has exports
      const nested = propagateImpact(consumer, checkpoint, severity, visited)
      affected.push(...nested)
    }
  }

  return affected
}
```

**Performance Trade-off**:

| Mode | Trigger | Cost | Precision |
|------|---------|------|-----------|
| Fast (mtime) | Every checkpoint | O(1) per file | Low (false positives) |
| Precise (AST) | Recovery/conflict | O(n) parse time | High |

#### 2.1.5 Recovery Strategy

```typescript
type RecoveryDecision =
  | { action: "continue"; reason: string }
  | {
      action: "partial-rerun"
      fromPhase: TaskPhase          // Use typed phase, not arbitrary string
      affectedPhases: TaskPhase[]   // Phases that will be re-executed
      reason: string
    }
  | { action: "full-rerun"; reason: string }
  | { action: "user-decision"; changes: ChangeReport }

interface ChangeReport {
  layer: 0 | 1 | 2 | 3
  description: string
  affectedPhases: TaskPhase[]
  recommendation: RecoveryDecision
}
```

**Recovery Logic**:

| Change Layer | Change Type | Recovery Strategy |
|--------------|-------------|-------------------|
| Layer 0 | Task intent changed | Full rerun |
| Layer 1 | "write" file externally modified | Rerun from affected phase |
| Layer 1 | "read" file changed | Partial re-perception |
| Layer 2 | Dependency version changed | Warning + user decision |
| Layer 3 | Branch switched | Full rerun |
| Layer 3 | New commits on base | Warning + user decision |

---

### 2.2 Hook Isolation (Logical Sandbox)

#### 2.2.1 Problem Statement

The current Hook chain operates in "trust mode":
- Hooks run in the same process space
- A badly written Hook can crash the entire coordinator
- Erroneous state modifications can cause cascading failures

Subprocess isolation is too heavy for Claude Code plugin scenarios (high Hook call frequency, unacceptable startup overhead).

#### 2.2.2 Proxy Limitations and Mitigation

**Critical Issue**: Proxy isolation at the JS layer is a "soft constraint." Hooks can bypass it:

```typescript
// These bypass Proxy-wrapped SessionContext
const fs = require('fs')           // Direct file access
const env = process.env.SECRET     // Environment variables
global.sharedState = "malicious"   // Global pollution
```

**Mitigation Strategies**:

| Strategy | Implementation | Trade-off |
|----------|---------------|-----------|
| Runtime Permission (Deno-style) | Node 20+ `--experimental-permission` | Requires Node 20+, may break deps |
| Context Injection | Hooks as pure functions, no global access | Limits flexibility |
| StateProposal Pattern | All mutations via proposal queue | Adds latency, but auditable |

**Recommended: StateProposal Pattern**

```typescript
/**
 * State proposal for auditable mutations
 * Hooks cannot directly modify state - they propose changes
 * Core governance layer reviews and applies proposals
 */
interface StateProposal {
  /** Unique proposal ID */
  id: string

  /** Hook that submitted this proposal */
  submitter: string

  /** Timestamp */
  timestamp: number

  /** Type of state change */
  type: "write" | "delete" | "merge"

  /** Target namespace */
  namespace: string

  /** Key to modify */
  key: string

  /** Proposed value */
  value: unknown

  /** Rationale for the change */
  rationale: string
}

/**
 * Proposal queue with governance review
 */
interface ProposalQueue {
  /** Submit a proposal (non-blocking) */
  submit(proposal: Omit<StateProposal, "id" | "timestamp">): string

  /** Review pending proposals (core only) */
  review(): StateProposal[]

  /** Apply a proposal (core only) */
  apply(proposalId: string): void

  /** Reject a proposal with reason (core only) */
  reject(proposalId: string, reason: string): void
}
```

**Enforcement**: Plugin-level hooks MUST use `StateProposal` for any shared state modification. Direct writes are blocked at the Proxy level and logged to Governance Ledger.

#### 2.2.3 Design: Layered Trust + Proxy Isolation

```typescript
/**
 * Trust levels for hook execution
 * Higher trust = more permissions
 */
type HookTrustLevel =
  | "core"      // System hooks, can modify global state
  | "plugin"    // Plugin hooks, namespace-scoped writes
  | "external"  // External hooks, read-only + explicit grants

/**
 * Permission manifest for a hook
 */
interface HookPermissions {
  trustLevel: HookTrustLevel

  /** Namespaces this hook can write to */
  writeNamespaces: string[]

  /** Global state keys this hook can read */
  readableGlobals: string[] | "*"

  /** Tools this hook can invoke */
  allowedTools: string[] | "*"

  /** Maximum execution time (ms) */
  timeoutMs: number

  /** Maximum memory allocation hint */
  memoryLimitMb?: number
}

/**
 * Sandboxed execution context for hooks
 */
interface SandboxedHookContext {
  /** Session ID (read-only) */
  readonly sessionId: string

  /** Read-only access to session state */
  readonly sessionState: Readonly<SessionState>

  /** Scoped state writer */
  scopedState: ScopedStateWriter

  /** Logger with hook context */
  logger: ScopedLogger

  /** Tool invoker with permission checks */
  tools: RestrictedToolInvoker
}

interface ScopedStateWriter {
  /** Write to hook's own namespace */
  set(key: string, value: unknown): void

  /** Read from hook's own namespace */
  get<T>(key: string): T | undefined

  /** Request write to shared namespace (may throw PermissionError) */
  requestSharedWrite(namespace: string, key: string, value: unknown): void
}
```

#### 2.2.4 Proxy Implementation

```typescript
/**
 * Creates a sandboxed context for hook execution
 * Uses Proxy to intercept and validate all state access
 */
function createSandboxedContext(
  baseCtx: SessionContext,
  hook: HookDefinition,
  permissions: HookPermissions
): SandboxedHookContext {

  const scopedState = new Map<string, unknown>()

  // Proxy for session state - enforces read-only
  const sessionStateProxy = new Proxy(baseCtx.sessionState, {
    get(target, prop: string) {
      if (permissions.readableGlobals !== "*" &&
          !permissions.readableGlobals.includes(prop)) {
        throw new HookPermissionError(
          `Hook "${hook.name}" cannot read global state "${prop}"`
        )
      }
      return deepFreeze(target[prop])
    },
    set() {
      throw new HookPermissionError(
        `Hook "${hook.name}" cannot modify session state directly`
      )
    }
  })

  // Scoped state writer with namespace enforcement
  const scopedStateWriter: ScopedStateWriter = {
    set(key, value) {
      scopedState.set(`${hook.namespace}:${key}`, value)
    },
    get(key) {
      return scopedState.get(`${hook.namespace}:${key}`)
    },
    requestSharedWrite(namespace, key, value) {
      if (!permissions.writeNamespaces.includes(namespace)) {
        throw new HookPermissionError(
          `Hook "${hook.name}" cannot write to namespace "${namespace}"`
        )
      }
      // Emit event for coordinator to process
      baseCtx.emit("hook:shared-write-request", {
        hook: hook.name,
        namespace,
        key,
        value
      })
    }
  }

  // Tool invoker with permission checks
  const toolInvoker: RestrictedToolInvoker = {
    async invoke(toolName, args) {
      if (permissions.allowedTools !== "*" &&
          !permissions.allowedTools.includes(toolName)) {
        throw new HookPermissionError(
          `Hook "${hook.name}" cannot invoke tool "${toolName}"`
        )
      }
      return baseCtx.tools.invoke(toolName, args)
    }
  }

  return {
    sessionId: baseCtx.sessionId,
    sessionState: sessionStateProxy,
    scopedState: scopedStateWriter,
    logger: createScopedLogger(hook.name),
    tools: toolInvoker
  }
}
```

---

### 2.3 Execution Trace (Shadow Execution)

#### 2.3.1 Problem Statement

Explicit DSL (YAML) has pitfalls:
- When you start writing `condition: $approve.approved`, you're reinventing a poor programming language
- Developers don't need to hardcode paths in YAML, but they need to see paths clearly in a Dashboard

#### 2.3.2 Design: Dynamic Trace Graph

While implicit Hooks run, automatically generate an observable dynamic trace graph.

```typescript
/**
 * Runtime execution trace
 * Built automatically, not defined statically
 */
interface ExecutionTrace {
  /** Unique trace identifier */
  traceId: string

  /** Session this trace belongs to */
  sessionId: string

  /** Start time of the trace */
  startedAt: number

  /** All executed nodes */
  nodes: TraceNode[]

  /** Relationships between nodes */
  edges: TraceEdge[]

  /** Chronological event log */
  timeline: TraceEvent[]

  /** Aggregated metrics */
  metrics: TraceMetrics
}

interface TraceNode {
  /** Unique node identifier */
  id: string

  /** Node type */
  type: "hook" | "tool" | "agent" | "decision" | "checkpoint"

  /** Human-readable name */
  name: string

  /** Execution timing */
  timing: {
    startedAt: number
    endedAt?: number
    durationMs?: number
  }

  /** Input snapshot (sanitized) */
  inputs: Record<string, unknown>

  /** Output snapshot (sanitized) */
  outputs?: Record<string, unknown>

  /** Resource consumption */
  resources: {
    tokensUsed?: number
    apiCalls?: number
    filesRead?: number
    filesWritten?: number
  }

  /** Execution status */
  status: "running" | "completed" | "failed" | "suspended"

  /** Error details if failed */
  error?: {
    type: string
    message: string
    stack?: string
  }
}

interface TraceEdge {
  /** Source node ID */
  from: string

  /** Target node ID */
  to: string

  /** Edge type */
  type: "data-flow" | "control-flow" | "trigger" | "spawn"

  /** What triggered this edge */
  trigger: {
    type:
      | "output"
      | "event"
      | "condition"
      | "explicit"
      | "state-dependency"
      | "file-dependency"
    key?: string
    path?: string
    eventType?: string
    details?: string
  }

  /** Data transferred (if data-flow) */
  dataKeys?: string[]
}

interface TraceEvent {
  timestamp: number
  nodeId?: string
  type:
    | "node-start"
    | "node-end"
    | "edge-created"
    | "state-change"
    | "state-write"
    | "state-read"
    | "proposal-submit"
    | "proposal-applied"
    | "file-dependency"
    | "event-emit"
    | "event-consume"
    | "resource-warning"
    | "error"
  details: Record<string, unknown>
}

interface TraceMetrics {
  totalDurationMs: number
  totalTokensUsed: number
  totalApiCalls: number
  nodeCount: number
  edgeCount: number
  failedNodes: number
  suspendedNodes: number
}
```

#### 2.3.3 Causal Compression (Preventing Trace Explosion)

**Problem**: In long sessions, Hooks fire hundreds or thousands of times. Full recording leads to visualization chaos.

**Solution: Causal Merging + Critical Path Extraction**

```typescript
/**
 * Trace compression strategies
 */
interface TraceCompressor {
  /**
   * Causal compression: Merge consecutive low-impact nodes
   * If N consecutive hooks don't modify core state, merge into one block
   */
  causalMerge(nodes: TraceNode[], threshold: number): CompressedTrace

  /**
   * Critical path extraction: Only keep decision points
   * Nodes with condition/LLM decision triggers are marked as critical
   */
  extractCriticalPath(trace: ExecutionTrace): CriticalPathTrace
}

interface CompressedTrace {
  /** Original node count */
  originalCount: number

  /** Compressed node count */
  compressedCount: number

  /** Compression ratio */
  ratio: number

  /** Compressed nodes (GovernanceBlocks + critical nodes) */
  nodes: (TraceNode | GovernanceBlock)[]

  /** Edges (only between visible nodes) */
  edges: TraceEdge[]
}

/**
 * Governance block: Merged low-impact nodes
 */
interface GovernanceBlock {
  type: "governance-block"

  /** Block identifier */
  id: string

  /** Number of merged nodes */
  mergedCount: number

  /** Time span of merged nodes */
  timeSpan: { start: number; end: number }

  /** Summary of merged activity */
  summary: string

  /** Aggregated resource usage */
  totalResources: {
    tokensUsed: number
    apiCalls: number
  }

  /** Original node IDs (for drill-down) */
  originalNodeIds: string[]
}

/**
 * Critical path: Only decision points and state changes
 */
interface CriticalPathTrace {
  /** Critical nodes only */
  nodes: TraceNode[]

  /** Why each node is critical */
  criticality: Map<string, CriticalityReason>
}

type CriticalityReason =
  | { type: "llm-decision"; decision: string }
  | { type: "condition-branch"; condition: string; result: boolean }
  | { type: "state-mutation"; keys: string[] }
  | { type: "approval-gate"; action: "approved" | "rejected" }
  | { type: "error"; error: string }
  | { type: "checkpoint"; checkpointId: string }

/**
 * Compression rules
 */
const COMPRESSION_RULES = {
  /** Consecutive hooks without state change -> merge */
  mergeThreshold: 5,

  /** Always keep these node types as critical */
  alwaysCritical: ["decision", "checkpoint", "approval-gate"],

  /** Hooks that are always low-impact (can be merged) */
  lowImpactHooks: ["logger", "metrics", "telemetry"],

  /** State keys that indicate high-impact change */
  highImpactStateKeys: ["plan", "task", "approval", "error"]
}
```

**Visualization Modes**:

| Mode | Description | Use Case |
|------|-------------|----------|
| Full | All nodes, no compression | Debugging specific issues |
| Compressed | Causal merge applied | Normal review |
| Critical Path | Only decision points | Quick overview |

#### 2.3.4 Auto-Tracing Implementation

```typescript
/**
 * Tracer that automatically instruments hook execution
 */
class ExecutionTracer {
  private trace: ExecutionTrace
  private nodeStack: string[] = []

  constructor(sessionId: string) {
    this.trace = {
      traceId: generateId(),
      sessionId,
      startedAt: Date.now(),
      nodes: [],
      edges: [],
      timeline: [],
      metrics: this.initMetrics()
    }
  }

  /**
   * Wrap a hook execution with automatic tracing
   */
  async traceHook<T>(
    hook: HookDefinition,
    ctx: SandboxedHookContext,
    execute: () => Promise<T>
  ): Promise<T> {
    const nodeId = this.startNode({
      type: "hook",
      name: hook.name,
      inputs: this.sanitizeInputs(ctx)
    })

    // Track parent-child relationship
    if (this.nodeStack.length > 0) {
      this.addEdge({
        from: this.nodeStack[this.nodeStack.length - 1],
        to: nodeId,
        type: "control-flow",
        trigger: { type: "explicit" }
      })
    }

    this.nodeStack.push(nodeId)

    try {
      const result = await execute()

      this.endNode(nodeId, {
        status: "completed",
        outputs: this.sanitizeOutputs(result)
      })

      // Infer data-flow edges from output usage
      this.inferDataFlowEdges(nodeId, result)

      return result
    } catch (error) {
      if (error instanceof SuspendException) {
        this.endNode(nodeId, {
          status: "suspended",
          outputs: { suspendReason: error.reason }
        })
      } else {
        this.endNode(nodeId, {
          status: "failed",
          error: this.formatError(error)
        })
      }
      throw error
    } finally {
      this.nodeStack.pop()
    }
  }

  // ===========================================================================
  // Data-flow Inference API
  //
  // Data-flow edges are inferred from OBSERVABLE SIGNALS, not arbitrary output
  // inspection. This ensures the inference is implementable and deterministic.
  //
  // Observable signals:
  // 1. State writes/reads via recordStateWrite/recordStateRead
  // 2. StateProposal submissions and applications
  // 3. Event emissions and consumptions
  // 4. File dependencies (tracked by checkpoint system)
  // ===========================================================================

  /**
   * Track which nodes write to which state keys
   */
  private stateWriters = new Map<string, { nodeId: string; timestamp: number }>()

  /**
   * Record a state write - creates potential data-flow edge
   */
  recordStateWrite(nodeId: string, namespace: string, key: string): void {
    const fullKey = `${namespace}:${key}`
    this.stateWriters.set(fullKey, { nodeId, timestamp: Date.now() })
    this.addTimelineEvent("state-write", nodeId, { namespace, key })
  }

  /**
   * Record a state read - creates data-flow edge if writer exists
   */
  recordStateRead(nodeId: string, namespace: string, key: string): string | undefined {
    const fullKey = `${namespace}:${key}`
    const writer = this.stateWriters.get(fullKey)

    if (writer && writer.nodeId !== nodeId) {
      this.addEdge({
        from: writer.nodeId,
        to: nodeId,
        type: "data-flow",
        trigger: { type: "state-dependency", key: fullKey }
      })
      return writer.nodeId
    }
    return undefined
  }

  /**
   * Record event emission - creates potential data-flow edge
   */
  recordEventEmit(nodeId: string, eventType: string): void {
    this.stateWriters.set(`event:${eventType}`, { nodeId, timestamp: Date.now() })
  }

  /**
   * Record event consumption - creates data-flow edge if emitter exists
   */
  recordEventConsume(nodeId: string, eventType: string): string | undefined {
    const emitter = this.stateWriters.get(`event:${eventType}`)
    if (emitter && emitter.nodeId !== nodeId) {
      this.addEdge({
        from: emitter.nodeId,
        to: nodeId,
        type: "data-flow",
        trigger: { type: "event", eventType }
      })
      return emitter.nodeId
    }
    return undefined
  }

  /**
   * Record file dependency (from checkpoint system)
   */
  recordFileDependency(readerNodeId: string, writerNodeId: string, filePath: string): void {
    if (readerNodeId !== writerNodeId) {
      this.addEdge({
        from: writerNodeId,
        to: readerNodeId,
        type: "data-flow",
        trigger: { type: "file-dependency", path: filePath }
      })
    }
  }

  /**
   * Export trace for visualization
   */
  exportForVisualization(): TraceVisualization {
    return {
      // D3.js / Mermaid compatible format
      nodes: this.trace.nodes.map(n => ({
        id: n.id,
        label: n.name,
        type: n.type,
        status: n.status,
        duration: n.timing.durationMs
      })),
      edges: this.trace.edges.map(e => ({
        source: e.from,
        target: e.to,
        type: e.type
      })),
      // Gantt chart data
      timeline: this.trace.nodes.map(n => ({
        id: n.id,
        name: n.name,
        start: n.timing.startedAt,
        end: n.timing.endedAt
      }))
    }
  }
}
```

---

### 2.4 Agent Envelope (State Contract)

#### 2.4.1 Problem Statement

Tools and Agents passing raw strings lack structural guarantees:
- Cannot track resource consumption
- Cannot verify input/output integrity
- Cannot dynamically adjust permissions

#### 2.4.2 Design: Structured Envelope Protocol

```typescript
/**
 * Standardized envelope for all agent/tool communication
 * Ensures traceability and permission management
 */
interface AgentEnvelope<T = unknown> {
  /** Envelope version for compatibility */
  version: "1.0"

  /** Unique envelope identifier */
  envelopeId: string

  /** Metadata about this operation */
  metadata: EnvelopeMetadata

  /** The actual payload */
  payload: T

  /** Permission and action guidance */
  permissions: EnvelopePermissions
}

interface EnvelopeMetadata {
  /** Token/cost consumption */
  gasUsed: number

  /** Integrity hash of payload */
  integrityHash: string

  /** Timestamp */
  timestamp: number

  /** Source of this envelope */
  source: {
    type: "tool" | "agent" | "hook" | "user"
    id: string
  }

  /** Trace context for distributed tracing */
  traceContext?: {
    traceId: string
    spanId: string
    parentSpanId?: string
  }
}

interface EnvelopePermissions {
  /** How this permission was granted */
  grantedBy: "task-definition" | "user-escalation" | "auto-inferred"

  /** Scope of this permission */
  scope: "this-step" | "this-session" | "persistent"

  /** Human-readable rationale */
  rationale?: string

  /** Suggested next actions (soft guidance) */
  suggestedNextActions: string[]

  /** Actions requiring explicit user confirmation */
  escalationRequired: string[]

  /** Actions explicitly forbidden */
  forbidden: string[]
}

/**
 * Envelope result types
 */
type EnvelopeResult<T> =
  | EnvelopeSuccess<T>
  | EnvelopeError
  | EnvelopeSuspended

interface EnvelopeSuccess<T> {
  status: "success"
  envelope: AgentEnvelope<T>
}

interface EnvelopeError {
  status: "error"
  error: {
    type: string
    message: string
    recoverable: boolean
    suggestedAction?: string
  }
  partialEnvelope?: AgentEnvelope<unknown>
}

interface EnvelopeSuspended {
  status: "suspended"
  reason: string
  resumeToken: string
  previewData?: unknown
  envelope: AgentEnvelope<{ suspendedAt: string }>
}
```

#### 2.4.3 Envelope Validation

```typescript
/**
 * Validates envelope integrity and permissions
 */
class EnvelopeValidator {
  /**
   * Validate incoming envelope
   */
  validate(envelope: AgentEnvelope): ValidationResult {
    const errors: ValidationError[] = []

    // Check integrity
    const computedHash = this.computeHash(envelope.payload)
    if (computedHash !== envelope.metadata.integrityHash) {
      errors.push({
        field: "metadata.integrityHash",
        error: "Integrity check failed - payload may be corrupted"
      })
    }

    // Check permission consistency
    const forbidden = new Set(envelope.permissions.forbidden)
    for (const action of envelope.permissions.suggestedNextActions) {
      if (forbidden.has(action)) {
        errors.push({
          field: "permissions",
          error: `Action "${action}" is both suggested and forbidden`
        })
      }
    }

    // Check gas budget
    if (envelope.metadata.gasUsed < 0) {
      errors.push({
        field: "metadata.gasUsed",
        error: "Gas usage cannot be negative"
      })
    }

    return {
      valid: errors.length === 0,
      errors
    }
  }

  /**
   * Create envelope from raw data
   */
  wrap<T>(
    payload: T,
    source: EnvelopeMetadata["source"],
    permissions: Partial<EnvelopePermissions> = {}
  ): AgentEnvelope<T> {
    return {
      version: "1.0",
      envelopeId: generateId(),
      metadata: {
        gasUsed: 0, // Will be updated after execution
        integrityHash: this.computeHash(payload),
        timestamp: Date.now(),
        source
      },
      payload,
      permissions: {
        grantedBy: "auto-inferred",
        scope: "this-step",
        suggestedNextActions: [],
        escalationRequired: [],
        forbidden: [],
        ...permissions
      }
    }
  }
}
```

---

### 2.5 Approval Gate Middleware

#### 2.5.1 Problem Statement

The current system relies on Claude Code's built-in permission system, lacking:
- Standardized approval workflows
- Configurable approval policies
- Integration with Checkpoints

#### 2.5.2 Design: SuspendException-based Approval

```typescript
/**
 * Tool criticality metadata
 */
interface ToolCriticalityMeta {
  /** Static criticality flag or dynamic evaluator */
  critical: boolean | ((args: unknown) => boolean)

  /** Human-readable reason for criticality */
  reason: string

  /** Category of critical action */
  category: "destructive" | "external" | "expensive" | "irreversible"

  /** Preview generator for approval UI */
  generatePreview?: (args: unknown) => ApprovalPreview
}

interface ApprovalPreview {
  title: string
  description: string
  affectedItems: Array<{
    type: string
    identifier: string
    action: string
  }>
  estimatedImpact?: {
    filesAffected?: number
    tokensRequired?: number
    externalCalls?: number
  }
}

/**
 * Suspend exception for approval flow
 */
class SuspendException extends Error {
  constructor(
    public readonly suspendInfo: SuspendInfo
  ) {
    super(`Execution suspended: ${suspendInfo.reason}`)
    this.name = "SuspendException"
  }
}

interface SuspendInfo {
  /** Reason for suspension */
  reason: string

  /** Checkpoint for resumption */
  checkpoint: SemanticCheckpoint

  /** Token for resuming execution */
  resumeToken: string

  /** Preview data for user decision */
  previewData: ApprovalPreview

  /** Available actions for user */
  availableActions: ApprovalAction[]
}

type ApprovalAction =
  | { type: "approve"; label: string }
  | { type: "reject"; label: string }
  | { type: "modify"; label: string; modifyPrompt: string }
  | { type: "defer"; label: string; deferUntil?: string }

/**
 * Approval gate middleware
 */
const approvalGateMiddleware: Hook = {
  name: "approval-gate",
  event: "tool.execute.before",

  async execute(ctx: HookContext): Promise<void> {
    const toolMeta = getToolCriticalityMeta(ctx.tool.name)
    if (!toolMeta) return

    const isCritical = typeof toolMeta.critical === "function"
      ? toolMeta.critical(ctx.args)
      : toolMeta.critical

    if (!isCritical) return

    // Check if already approved in this session
    const approvalKey = computeApprovalKey(ctx.tool.name, ctx.args)
    if (ctx.sessionState.approvedActions?.has(approvalKey)) {
      return // Already approved, proceed
    }

    // Create checkpoint
    const checkpoint = await createSemanticCheckpoint(ctx)

    // Generate preview
    const preview = toolMeta.generatePreview?.(ctx.args) ?? {
      title: `Approve ${ctx.tool.name}`,
      description: toolMeta.reason,
      affectedItems: []
    }

    // Suspend execution
    throw new SuspendException({
      reason: toolMeta.reason,
      checkpoint,
      resumeToken: checkpoint.id,
      previewData: preview,
      availableActions: [
        { type: "approve", label: "Approve and continue" },
        { type: "reject", label: "Reject and cancel" },
        { type: "modify", label: "Modify parameters", modifyPrompt: "Adjust the operation:" }
      ]
    })
  }
}

/**
 * Tool criticality registry
 */
const TOOL_CRITICALITY: Record<string, ToolCriticalityMeta> = {
  "Edit": {
    critical: false,
    reason: "File edits are generally safe",
    category: "destructive"
  },

  "Write": {
    critical: (args: { file_path: string }) => {
      // Critical if overwriting existing file or system paths
      return args.file_path.includes("/etc/") ||
             args.file_path.includes("/.") ||
             existsSync(args.file_path)
    },
    reason: "Creating or overwriting files",
    category: "destructive",
    generatePreview: (args: { file_path: string; content: string }) => ({
      title: "Create/Overwrite File",
      description: `Will write to: ${args.file_path}`,
      affectedItems: [{
        type: "file",
        identifier: args.file_path,
        action: existsSync(args.file_path) ? "overwrite" : "create"
      }],
      estimatedImpact: {
        filesAffected: 1
      }
    })
  },

  "Bash": {
    critical: (args: { command: string }) => {
      const dangerousPatterns = [
        /rm\s+-rf?/,
        /sudo/,
        />\s*\//, // redirect to root
        /dd\s+/,
        /mkfs/,
        /chmod\s+777/
      ]
      return dangerousPatterns.some(p => p.test(args.command))
    },
    reason: "Potentially dangerous shell command",
    category: "irreversible"
  },

  "delegate_task": {
    critical: (args: { prompt: string }) => {
      const criticalKeywords = ["delete", "remove", "drop", "destroy", "force"]
      return criticalKeywords.some(k =>
        args.prompt.toLowerCase().includes(k)
      )
    },
    reason: "Delegating potentially destructive task",
    category: "external"
  }
}
```

#### 2.5.4 Approval Lifecycle State Machine

The approval flow follows a well-defined state machine to handle suspend/resume:

```
                    ┌─────────────────────────────────────────┐
                    │                                         │
                    ▼                                         │
┌─────────┐   SuspendException    ┌───────────┐              │
│ running │ ──────────────────►   │ suspended │              │
└─────────┘                       └─────┬─────┘              │
                                        │                     │
                                        │ user action         │
                                        ▼                     │
                               ┌─────────────────┐            │
                               │ pending_approval│            │
                               └────────┬────────┘            │
                                        │                     │
              ┌─────────────────────────┼─────────────────────┤
              │              │          │          │          │
              ▼              ▼          ▼          ▼          │
         ┌────────┐   ┌──────────┐ ┌────────┐ ┌────────┐      │
         │approved│   │ modified │ │rejected│ │deferred│      │
         └───┬────┘   └────┬─────┘ └───┬────┘ └───┬────┘      │
             │              │           │          │          │
             │              │           │          │ (timeout)│
             ▼              ▼           ▼          └──────────┘
         ┌───────┐     ┌───────┐   ┌─────────┐
         │resumed│     │resumed│   │cancelled│
         └───────┘     └───────┘   └─────────┘
```

**State Definitions:**

| State | Description |
|-------|-------------|
| `running` | Normal execution, no suspension |
| `suspended` | Execution paused, waiting for user response |
| `pending_approval` | User has viewed the suspension, decision pending |
| `approved` | User approved the action |
| `modified` | User approved with modified parameters |
| `rejected` | User rejected the action |
| `deferred` | User deferred decision to a later time |
| `resumed` | Execution resumed after approval |
| `cancelled` | Execution cancelled after rejection |

```typescript
type SuspendState =
  | "running"
  | "suspended"
  | "pending_approval"
  | "approved"
  | "modified"
  | "rejected"
  | "deferred"
  | "resumed"
  | "cancelled"
```

**Resume Handler Interface:**

```typescript
/**
 * Handles the resume flow after suspension
 */
interface ResumeHandler {
  /**
   * Register a new suspension
   */
  registerSuspension(
    sessionId: string,
    suspendInfo: SuspendInfo
  ): void

  /**
   * Process user's resume decision
   */
  processResume(input: ResumeInput): ResumeResult

  /**
   * Check if there are pending suspensions for a session
   */
  isPending(sessionId: string): boolean
}

interface ResumeInput {
  /** Resume token from SuspendInfo */
  resumeToken: string

  /** User's action choice */
  action: "approve" | "modify" | "reject" | "defer"

  /** Modified arguments (if action is "modify") */
  modifiedArgs?: unknown

  /** Reason for rejection/deferral */
  reason?: string

  /** Defer until timestamp (if action is "defer") */
  deferUntil?: string
}

interface ResumeResult {
  /** Whether resume was successful */
  success: boolean

  /** Current state after processing */
  state: SuspendState

  /** Original suspend info */
  suspendInfo: SuspendInfo

  /** Error message if failed */
  error?: string

  /** Resolved arguments (original or modified) */
  resolvedArgs?: unknown
}
```

**Key Behaviors:**

1. **Idempotent Approval Keys**: Each approval is keyed by `hash(toolName + canonicalArgs)`. Repeat approvals for the same key within a session do not re-prompt.

2. **Token Expiry**: Resume tokens expire after `approval.tokenExpiryMs` (default: 30 minutes). Expired tokens return `{ success: false, error: "token_expired" }`.

3. **Duplicate Response Handling**: Once a token is consumed (approved/rejected), subsequent responses return `{ success: false, error: "token_already_consumed" }`.

4. **Checkpoint Re-validation**: On resume, if the checkpoint's environment fingerprint has drifted:
   - Minor drift: Proceed with warning logged to ledger
   - Major drift: Return to user with `{ success: false, error: "environment_changed" }`

5. **Deferred Action Timeout**: Deferred suspensions auto-expire. On expiry, state transitions to `cancelled` with ledger entry.

---

### 2.6 Circuit Breaker

#### 2.6.1 Problem Statement

The current truncator's problem is **passive truncation**:
- Loses context coherence
- Agent may become disoriented after truncation
- Cannot recover gracefully

#### 2.6.2 The "Terminal Hallucination" Problem

**Critical Issue**: When the model receives a 70% budget warning, it may trigger "terminal hallucination":
- To forcibly "converge," it skips necessary validation steps
- Produces simplified incorrect solutions
- Makes false "task complete" claims

**Root Cause**: Directly telling the model Token counts triggers anxiety behavior.

**Solution: Two-Phase Refactor + Hidden Budget**

```typescript
/**
 * Budget presentation strategy
 * Never expose raw token counts to LLM
 */
interface BudgetPresentation {
  /**
   * Convert token budget to "estimated remaining steps"
   * More intuitive and less anxiety-inducing
   */
  toEstimatedSteps(remaining: number, avgStepCost: number): number

  /**
   * Present budget as qualitative phase, not quantitative
   */
  toPhaseDescription(percentage: number): string
}

const PHASE_DESCRIPTIONS = {
  healthy: "You have plenty of capacity to explore thoroughly.",
  midpoint: "Good progress. Continue with your current approach.",
  wrapUp: "Begin consolidating your work toward deliverables.",
  critical: "Focus only on essential remaining tasks."
}

/**
 * Two-phase context defragmentation
 */
interface TwoPhaseRefactor {
  /**
   * Phase 1 (70%): Garbage Collection
   * - Delete stale tool_output entries
   * - Compress verbose intermediate results
   * - Keep: latest state, essential history, key decisions
   */
  garbageCollect(context: ConversationContext): GCResult

  /**
   * Phase 2 (90%): Session Fork
   * - Generate TransferManifest
   * - Create new session with compressed context
   * - Inject handoff prompt
   */
  forkSession(context: ConversationContext): ForkResult
}

interface GCResult {
  /** Tokens freed */
  freedTokens: number

  /** Items removed */
  removedItems: Array<{
    type: "tool_output" | "intermediate" | "verbose_log"
    count: number
  }>

  /** Items preserved */
  preservedItems: string[]
}

interface ForkResult {
  /** New session ID */
  newSessionId: string

  /** Transfer manifest */
  manifest: TransferManifest

  /** Handoff prompt */
  handoffPrompt: string
}

interface TransferManifest {
  /** Task progress percentage */
  progressPercentage: number

  /** Completed milestones */
  completedMilestones: string[]

  /** Remaining work items */
  remainingWork: string[]

  /** Critical context to carry */
  criticalContext: {
    keyDecisions: string[]
    currentState: string
    blockers: string[]
  }

  /** Files to carry forward (content, not just paths) */
  essentialFiles: Map<string, string>
}
```

#### 2.6.3 Design: Budget Monitor + Two-Phase Refactor

```typescript
/**
 * Token budget allocation for a task
 */
interface TokenBudget {
  /** Total allocated budget */
  allocated: number

  /** Currently consumed */
  consumed: number

  /** Warning threshold (default: 0.7 = 70%) */
  warningThreshold: number

  /** Force refactor threshold (default: 0.9 = 90%) */
  refactorThreshold: number

  /** Hard limit (default: 0.95 = 95%) */
  hardLimit: number
}

/**
 * Budget monitor events
 */
type BudgetEvent =
  | { type: "consumption"; amount: number; total: number }
  | { type: "warning"; percentage: number; remaining: number }
  | { type: "refactor-triggered"; reason: string }
  | { type: "hard-limit-reached" }

/**
 * Refactor strategy for context compression
 */
interface RefactorStrategy {
  /** Generate compressed context summary */
  generateSummary(currentState: TaskState): Promise<ContextSummary>

  /** Determine what to carry forward */
  selectCriticalContext(summary: ContextSummary): CriticalContext

  /** Create new session with compressed context */
  forkSession(context: CriticalContext, remainingBudget: number): Promise<Session>
}

interface ContextSummary {
  /** Compressed representation of current progress */
  progressSummary: string

  /** Key decisions made so far */
  keyDecisions: Array<{
    decision: string
    rationale: string
    timestamp: number
  }>

  /** Files modified with change summaries */
  fileChanges: Array<{
    path: string
    changeType: "created" | "modified" | "deleted"
    summary: string
  }>

  /** Remaining work */
  remainingTasks: string[]

  /** Blockers or issues */
  blockers: string[]
}

interface CriticalContext {
  /** Minimal context needed to continue */
  summary: string

  /** Last checkpoint for recovery */
  checkpoint: SemanticCheckpoint

  /** Essential file contents to carry */
  essentialFiles: Map<string, string>

  /** Next action to take */
  nextAction: string
}

/**
 * Budget monitor implementation
 */
class BudgetMonitor extends EventEmitter {
  private budget: TokenBudget
  private refactorStrategy: RefactorStrategy
  private stepCount: number = 0
  private gcTriggered: boolean = false
  private forkTriggered: boolean = false

  constructor(budget: TokenBudget, strategy: RefactorStrategy) {
    super()
    this.budget = budget
    this.refactorStrategy = strategy
  }

  /**
   * Record token consumption
   */
  async recordConsumption(tokens: number): Promise<void> {
    this.budget.consumed += tokens
    this.stepCount++
    const percentage = this.budget.consumed / this.budget.allocated

    this.emit("consumption", {
      type: "consumption",
      amount: tokens,
      total: this.budget.consumed
    })

    if (percentage >= this.budget.hardLimit) {
      this.emit("hard-limit", { type: "hard-limit-reached" })
      throw new BudgetExhaustedError("Token budget exhausted")
    }

    if (percentage >= this.budget.refactorThreshold && !this.forkTriggered) {
      this.forkTriggered = true
      await this.triggerRefactor("Budget threshold exceeded")
      return
    }

    if (percentage >= this.budget.warningThreshold) {
      if (!this.gcTriggered) {
        this.gcTriggered = true
        await this.triggerGarbageCollection()
      }

      this.emit("warning", {
        type: "warning",
        percentage: percentage * 100,
        remaining: this.budget.allocated - this.budget.consumed
      })

      // Inject convergence hint to LLM
      this.injectConvergenceHint(percentage)
    }
  }

  /**
   * Inject hint to LLM using hidden budget strategy
   * NEVER expose raw token counts - use estimated steps instead
   */
  private injectConvergenceHint(percentage: number): void {
    // Calculate estimated remaining steps (not tokens)
    const avgStepCost = this.budget.consumed / Math.max(this.stepCount, 1)
    const remainingTokens = this.budget.allocated - this.budget.consumed
    const estimatedSteps = Math.floor(remainingTokens / avgStepCost)

    // Use qualitative phase description
    const phase = percentage >= 0.9 ? "critical" :
                  percentage >= 0.7 ? "wrapUp" :
                  percentage >= 0.5 ? "midpoint" : "healthy"

    const phaseDescriptions = {
      healthy: "You have plenty of capacity to explore thoroughly.",
      midpoint: "Good progress. Continue with your current approach.",
      wrapUp: "Begin consolidating your work toward deliverables.",
      critical: "Focus only on essential remaining tasks."
    }

    // Hidden budget: Tell model "steps" not "tokens"
    const hint = `
[Progress Update] ${phaseDescriptions[phase]}
Estimated capacity: approximately ${estimatedSteps} more actions.

${phase === "wrapUp" ? `Please:
1. Identify the 2-3 most critical remaining items
2. Begin producing deliverable outputs
3. Defer non-essential improvements` : ""}

${phase === "critical" ? `IMPORTANT:
- Complete only essential tasks
- Skip optional optimizations
- Produce final deliverables now` : ""}
`.trim()

    // Inject as system message
    this.emit("inject-hint", hint)
  }

  /**
   * Phase 1: Garbage Collection (triggered at 70%)
   * Frees up context without losing critical information
   */
  private async triggerGarbageCollection(): Promise<GCResult> {
    this.emit("gc-triggered", { percentage: this.getPercentage() })

    const gcTargets = [
      // Stale tool outputs (older than N turns)
      { type: "tool_output", maxAge: 10 },
      // Verbose intermediate results
      { type: "intermediate", predicate: (item: any) => item.verbose },
      // Debug logs
      { type: "verbose_log", all: true }
    ]

    const result: GCResult = {
      freedTokens: 0,
      removedItems: [],
      preservedItems: []
    }

    for (const target of gcTargets) {
      const freed = await this.collectGarbage(target)
      result.freedTokens += freed.tokens
      result.removedItems.push({
        type: target.type as any,
        count: freed.count
      })
    }

    // Always preserve
    result.preservedItems = [
      "task_definition",
      "current_plan",
      "key_decisions",
      "latest_file_states",
      "error_context"
    ]

    return result
  }

  /**
   * Trigger context refactoring
   */
  private async triggerRefactor(reason: string): Promise<void> {
    this.emit("refactor-triggered", { type: "refactor-triggered", reason })

    // Generate context summary
    const summary = await this.refactorStrategy.generateSummary(
      this.getCurrentTaskState()
    )

    // Select critical context
    const criticalContext = this.refactorStrategy.selectCriticalContext(summary)

    // Calculate remaining budget for new session (30% of original)
    const remainingBudget = Math.floor(this.budget.allocated * 0.3)

    // Fork new session
    const newSession = await this.refactorStrategy.forkSession(
      criticalContext,
      remainingBudget
    )

    // Throw to transition to new session
    throw new SessionRefactorException(newSession, criticalContext)
  }

  /**
   * Get current budget status
   */
  getStatus(): BudgetStatus {
    const percentage = this.budget.consumed / this.budget.allocated
    return {
      consumed: this.budget.consumed,
      allocated: this.budget.allocated,
      percentage,
      remaining: this.budget.allocated - this.budget.consumed,
      phase: percentage >= this.budget.refactorThreshold ? "critical" :
             percentage >= this.budget.warningThreshold ? "warning" : "normal"
    }
  }

  private getPercentage(): number {
    return this.budget.consumed / this.budget.allocated
  }

  private getCurrentTaskState(): TaskState {
    // Implementation depends on session context
    throw new Error("Must be implemented by subclass")
  }

  private async collectGarbage(target: any): Promise<{ tokens: number; count: number }> {
    // Implementation depends on context storage
    throw new Error("Must be implemented by subclass")
  }
}

interface BudgetStatus {
  consumed: number
  allocated: number
  percentage: number
  remaining: number
  phase: "normal" | "warning" | "critical"
}

/**
 * Default refactor strategy implementation
 */
class DefaultRefactorStrategy implements RefactorStrategy {
  async generateSummary(state: TaskState): Promise<ContextSummary> {
    // Use LLM to generate compressed summary
    const prompt = `
Summarize the current task progress:

Task: ${state.taskDescription}

Files modified:
${state.modifiedFiles.map(f => `- ${f.path}: ${f.changeType}`).join('\n')}

Recent actions:
${state.recentActions.slice(-10).map(a => `- ${a}`).join('\n')}

Generate a concise summary (max 500 tokens) that captures:
1. What has been accomplished
2. Key decisions made
3. What remains to be done
4. Any blockers
`.trim()

    // Call LLM for summary (with strict token limit)
    const response = await this.callLLM(prompt, { maxTokens: 500 })

    return this.parseSummary(response)
  }

  selectCriticalContext(summary: ContextSummary): CriticalContext {
    // Prioritize: blockers > remaining tasks > key decisions
    const nextAction = summary.blockers.length > 0
      ? `Resolve blocker: ${summary.blockers[0]}`
      : summary.remainingTasks[0] ?? "Complete the task"

    return {
      summary: summary.progressSummary,
      checkpoint: this.getLatestCheckpoint(),
      essentialFiles: this.selectEssentialFiles(summary.fileChanges),
      nextAction
    }
  }

  async forkSession(
    context: CriticalContext,
    remainingBudget: number
  ): Promise<Session> {
    // Calculate estimated steps (hidden budget principle - never expose raw tokens)
    const estimatedSteps = Math.floor(remainingBudget / 2000) // ~2000 tokens per step

    return createSession({
      inheritedContext: context.summary,
      checkpoint: context.checkpoint,
      budget: {
        allocated: remainingBudget,
        consumed: 0,
        warningThreshold: 0.7,
        refactorThreshold: 0.9,
        hardLimit: 0.95
      },
      initialPrompt: `
Continue from checkpoint. Context:

${context.summary}

Essential files carried forward:
${Array.from(context.essentialFiles.keys()).join(', ')}

Next action: ${context.nextAction}

Estimated capacity: approximately ${estimatedSteps} more actions available.
Focus on completing the remaining work efficiently.
`.trim()
    })
  }

  private async callLLM(prompt: string, options: { maxTokens: number }): Promise<string> {
    throw new Error("Must be implemented")
  }

  private parseSummary(response: string): ContextSummary {
    throw new Error("Must be implemented")
  }

  private getLatestCheckpoint(): SemanticCheckpoint {
    throw new Error("Must be implemented")
  }

  private selectEssentialFiles(changes: ContextSummary["fileChanges"]): Map<string, string> {
    throw new Error("Must be implemented")
  }
}
```

---

### 2.7 Governance Ledger (Audit Log)

#### 2.7.1 Problem Statement

Trace as a visualization tool has value, but lacks audit capability:
- Cannot trace back to root cause of abnormal behavior
- Permission escalations and violation warnings are scattered
- Hard to distinguish "environment drift causing misjudgment" from "90% forced refactor causing context loss"

#### 2.7.2 Design: Immutable Audit Ledger

Upgrade Trace to an **immutable audit ledger** where all governance events are recorded.

```typescript
/**
 * Governance Ledger: Immutable audit log
 * The ultimate source of truth for "what happened and why"
 */
interface GovernanceLedger {
  /** Ledger identifier */
  ledgerId: string

  /** Session this ledger belongs to */
  sessionId: string

  /** Creation time */
  createdAt: number

  /** Immutable event entries */
  entries: LedgerEntry[]

  /** Integrity chain (each entry references previous hash) */
  integrityChain: string[]
}

/**
 * Ledger entry types - all governance-significant events
 */
type LedgerEntry =
  | PermissionEscalation
  | PermissionViolation
  | BudgetEvent
  | CheckpointEvent
  | RecoveryEvent
  | ApprovalEvent
  | StateProposalEvent
  | EnvironmentDriftEvent

interface LedgerEntryBase {
  /** Entry ID */
  id: string

  /** Timestamp */
  timestamp: number

  /** Hash of previous entry (for integrity chain) */
  previousHash: string

  /** Entry type discriminator */
  type: string
}

interface PermissionEscalation extends LedgerEntryBase {
  type: "permission-escalation"

  /** Who requested escalation */
  requestor: string

  /** What permission was requested */
  permission: string

  /** How it was granted */
  grantedBy: "user" | "auto-inferred" | "policy"

  /** Rationale */
  rationale: string
}

interface PermissionViolation extends LedgerEntryBase {
  type: "permission-violation"

  /** Who attempted the violation */
  violator: string

  /** What was attempted */
  attemptedAction: string

  /** Why it was blocked */
  blockReason: string

  /** Was it logged to user */
  userNotified: boolean
}

interface BudgetEvent extends LedgerEntryBase {
  type: "budget-event"

  /** Event subtype */
  subtype: "warning" | "gc-triggered" | "fork-triggered" | "exhausted"

  /** Budget state at time of event */
  budgetState: {
    consumed: number
    allocated: number
    percentage: number
  }

  /** Action taken */
  actionTaken: string

  /** Tokens freed (if GC) */
  tokensFreed?: number
}

interface CheckpointEvent extends LedgerEntryBase {
  type: "checkpoint-event"

  /** Checkpoint ID */
  checkpointId: string

  /** Event subtype */
  subtype: "created" | "restored" | "invalidated"

  /** Reason for event */
  reason: string

  /** Files tracked */
  trackedFiles: string[]
}

interface RecoveryEvent extends LedgerEntryBase {
  type: "recovery-event"

  /** Recovery decision */
  decision: "continue" | "partial-rerun" | "full-rerun" | "user-choice"

  /** What triggered recovery */
  trigger: {
    layer: 0 | 1 | 2 | 3
    description: string
  }

  /** Affected phases */
  affectedPhases: string[]
}

interface ApprovalEvent extends LedgerEntryBase {
  type: "approval-event"

  /** Tool that required approval */
  tool: string

  /** User decision */
  decision: "approved" | "rejected" | "modified" | "deferred"

  /** Preview shown to user */
  previewShown: string

  /** Time to decision (ms) */
  decisionTimeMs: number
}

interface StateProposalEvent extends LedgerEntryBase {
  type: "state-proposal"

  /** Proposal ID */
  proposalId: string

  /** Submitter */
  submitter: string

  /** Proposal outcome */
  outcome: "applied" | "rejected" | "pending"

  /** Target namespace and key */
  target: { namespace: string; key: string }

  /** Rejection reason if rejected */
  rejectionReason?: string
}

interface EnvironmentDriftEvent extends LedgerEntryBase {
  type: "environment-drift"

  /** What drifted */
  driftType: "file-changed" | "dependency-changed" | "branch-switched" | "external-commit"

  /** Affected files/items */
  affected: string[]

  /** Impact assessment */
  impact: "none" | "minor" | "major" | "critical"

  /** Action recommended */
  recommendedAction: string
}

/**
 * Ledger writer with integrity guarantees
 */
class GovernanceLedgerWriter {
  private ledger: GovernanceLedger
  private lastHash: string = "genesis"

  /**
   * Append entry to ledger (immutable)
   */
  append<T extends LedgerEntry>(entry: Omit<T, "id" | "timestamp" | "previousHash">): void {
    const fullEntry: LedgerEntry = {
      ...entry,
      id: generateId(),
      timestamp: Date.now(),
      previousHash: this.lastHash
    } as T

    // Compute hash of this entry
    const entryHash = this.computeHash(fullEntry)

    // Append to ledger
    this.ledger.entries.push(fullEntry)
    this.ledger.integrityChain.push(entryHash)

    // Update last hash for next entry
    this.lastHash = entryHash

    // Persist immediately (append-only file)
    this.persistEntry(fullEntry)
  }

  /**
   * Verify ledger integrity
   */
  verifyIntegrity(): IntegrityReport {
    const errors: string[] = []

    for (let i = 1; i < this.ledger.entries.length; i++) {
      const entry = this.ledger.entries[i]
      const expectedPrevHash = this.ledger.integrityChain[i - 1]

      if (entry.previousHash !== expectedPrevHash) {
        errors.push(`Entry ${entry.id}: previousHash mismatch`)
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      entryCount: this.ledger.entries.length
    }
  }

  /**
   * Query ledger for specific events
   */
  query(filter: LedgerFilter): LedgerEntry[] {
    return this.ledger.entries.filter(entry => {
      if (filter.type && entry.type !== filter.type) return false
      if (filter.after && entry.timestamp < filter.after) return false
      if (filter.before && entry.timestamp > filter.before) return false
      return true
    })
  }

  /**
   * Generate diagnostic report
   * "Why did the agent behave this way?"
   */
  generateDiagnosticReport(symptom: string): DiagnosticReport {
    // Find relevant events based on symptom
    const relevantEvents = this.findRelevantEvents(symptom)

    // Build causal chain
    const causalChain = this.buildCausalChain(relevantEvents)

    return {
      symptom,
      likelyCause: this.inferCause(causalChain),
      supportingEvents: relevantEvents,
      causalChain,
      recommendation: this.generateRecommendation(causalChain)
    }
  }

  private computeHash(entry: LedgerEntry): string {
    // SHA-256 of JSON-serialized entry
    throw new Error("Must be implemented")
  }

  private persistEntry(entry: LedgerEntry): void {
    // Append to JSONL file
    throw new Error("Must be implemented")
  }

  private findRelevantEvents(symptom: string): LedgerEntry[] {
    throw new Error("Must be implemented")
  }

  private buildCausalChain(events: LedgerEntry[]): string[] {
    throw new Error("Must be implemented")
  }

  private inferCause(chain: string[]): string {
    throw new Error("Must be implemented")
  }

  private generateRecommendation(chain: string[]): string {
    throw new Error("Must be implemented")
  }
}

interface LedgerFilter {
  type?: LedgerEntry["type"]
  after?: number
  before?: number
}

interface DiagnosticReport {
  symptom: string
  likelyCause: string
  supportingEvents: LedgerEntry[]
  causalChain: string[]
  recommendation: string
}

interface IntegrityReport {
  valid: boolean
  errors: string[]
  entryCount: number
}
```

#### 2.7.3 Ledger Storage

```typescript
/**
 * Append-only file storage for ledger
 * One JSONL file per session: .sisyphus/ledger/{sessionId}.jsonl
 */
const LEDGER_STORAGE = {
  /** Base directory */
  baseDir: ".sisyphus/ledger",

  /** File format: JSON Lines (one entry per line) */
  format: "jsonl",

  /** Retention policy */
  retention: {
    /** Keep ledgers for N days */
    maxAgeDays: 30,

    /** Keep at most N ledgers */
    maxCount: 100,

    /** Never delete ledgers with unresolved errors */
    preserveErrors: true
  }
}
```

#### 2.7.4 Diagnostic Queries

```typescript
// Example: "Why did the task fail at 90%?"
const report = ledger.generateDiagnosticReport("task-incomplete-at-90-percent")
// Returns:
// {
//   symptom: "task-incomplete-at-90-percent",
//   likelyCause: "Budget fork triggered before validation step",
//   supportingEvents: [BudgetEvent, RecoveryEvent],
//   causalChain: [
//     "70% warning issued",
//     "Agent began convergence",
//     "90% fork triggered",
//     "Validation step skipped in transfer",
//     "New session started without validation context"
//   ],
//   recommendation: "Add 'validation_pending' to TransferManifest.criticalContext"
// }

// Example: "Why did recovery choose full-rerun?"
const report = ledger.generateDiagnosticReport("unexpected-full-rerun")
// Returns:
// {
//   likelyCause: "Layer 2 environment drift: package.json changed",
//   supportingEvents: [EnvironmentDriftEvent, RecoveryEvent],
//   ...
// }
```

---

### 2.8 Trace Persistence and Observability

#### 2.8.1 Problem Statement

The ExecutionTracer (Section 2.3) and GovernanceLedger (Section 2.7) provide rich observability during execution, but both are primarily in-memory structures:
- Traces are lost when the session ends
- Post-session debugging requires access to persisted data
- Correlation between tracer nodes and ledger entries is implicit

#### 2.8.2 Design: Persistent Trace Storage

Traces are automatically persisted to disk when a governance session ends.

**Storage Location**: `~/.sisyphus/traces/{sessionId}.json`

```typescript
/**
 * Persisted trace format (compressed for storage)
 */
interface PersistedTrace {
  /** Format version */
  version: 1
  /** Session ID */
  sessionId: string
  /** Trace ID */
  traceId: string
  /** When trace started */
  startedAt: number
  /** When trace ended */
  endedAt: number
  /** Total duration in ms */
  durationMs: number
  /** Summary metrics */
  metrics: TraceMetrics
  /** Critical nodes only (filtered) */
  nodes: PersistedTraceNode[]
  /** Edges between nodes */
  edges: TraceEdge[]
  /** Recent timeline events (last N) */
  recentTimeline: TraceEvent[]
  /** Compression stats */
  compression: {
    originalNodeCount: number
    persistedNodeCount: number
    originalTimelineCount: number
    persistedTimelineCount: number
  }
}

/**
 * Simplified node for persistence (reduced size)
 */
interface PersistedTraceNode {
  id: string
  type: TraceNode["type"]
  name: string
  status: TraceNode["status"]
  startedAt: number
  durationMs?: number
  /** Summarized inputs (keys only, not values) */
  inputKeys?: string[]
  /** Summarized outputs (keys only, not values) */
  outputKeys?: string[]
  /** Resource usage */
  resources?: TraceNode["resources"]
  /** Error summary if failed */
  error?: { type: string; message: string }
  /** Parent node for hierarchy */
  parentId?: string
}
```

#### 2.8.3 Compression Strategy

To minimize storage while preserving debugging value:

| Filter | Criteria | Rationale |
|--------|----------|-----------|
| Critical Node Types | `tool`, `agent`, `decision`, `checkpoint` | Skip routine hooks |
| Failed Nodes | Any node with `status: "failed"` | Always keep errors |
| Significant Duration | `durationMs > 100ms` | Skip fast operations |
| Timeline Limit | Last 100 events | Bound event log size |
| Data Sanitization | Keys only, no values | Reduce payload size |

**Retention**: Last 50 traces are kept; older traces are automatically cleaned up.

#### 2.8.4 Tracer-Ledger Correlation

Ledger entries now include a `traceNodeId` field to correlate with tracer nodes:

```typescript
interface LedgerEntryBase {
  id: string
  timestamp: number
  previousHash: string
  type: string
  /** Correlation to tracer node */
  traceNodeId?: string
}

interface BudgetEvent extends LedgerEntryBase {
  type: "budget-event"
  /** Event subtype */
  subtype: "consumption" | "warning" | "gc-triggered" | "fork-triggered" | "exhausted"
  /** Tool that triggered this event */
  tool?: string
  /** Budget state at time of event */
  budgetState: { consumed: number; allocated: number; percentage: number }
  /** Action taken */
  actionTaken: string
  /** Tokens freed (if GC) */
  tokensFreed?: number
}
```

This enables queries like:
- "What tool call triggered the 70% budget warning?"
- "Which trace node corresponds to this approval event?"

#### 2.8.5 Debug Skill

A built-in `/debug` skill provides easy access to observability data:

```bash
# View execution trace
/debug trace              # Latest trace
/debug trace session123   # Specific session

# View governance ledger
/debug ledger             # Recent entries
/debug ledger budget      # Budget events only
/debug ledger approval    # Approval events only

# View memory operations
/debug memory             # Memory operations log

# Generate comprehensive report
/debug report             # Combined trace + ledger + memory
```

**Output Formats**:
- YAML for human readability
- Mermaid flowchart for trace visualization
- JSON for programmatic access

#### 2.8.6 Persistence API

```typescript
// Persist a trace
function persistTrace(trace: ExecutionTrace): PersistedTrace | null

// Load a persisted trace
function loadTrace(sessionId: string): PersistedTrace | null

// List available traces
function listTraces(filter?: TraceQueryFilter): TraceListEntry[]

// Get the most recent trace
function getLatestTrace(): PersistedTrace | null

// Delete a trace
function deleteTrace(sessionId: string): boolean

// Format for display
function formatTraceAsYaml(trace: PersistedTrace): string
function traceToMermaid(trace: PersistedTrace): string

// Get summary for dashboard
function getTracesSummary(): {
  totalTraces: number
  recentTraces: TraceListEntry[]
  totalDurationMs: number
  avgDurationMs: number
}
```

---

## 3. Integration Architecture

### 3.1 Component Interaction Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                     User Message                                 │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                  SessionStateCoordinator                         │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │                  BudgetMonitor                            │   │
│  │  - Track token consumption (hidden from LLM)              │   │
│  │  - Phase 1: GC at 70%                                     │   │
│  │  - Phase 2: Fork at 90%                                   │   │
│  └──────────────────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │                GovernanceLedger                           │   │
│  │  - Immutable audit log                                    │   │
│  │  - Records all governance events                          │   │
│  │  - Diagnostic query support                               │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Hook Execution Pipeline                       │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐             │
│  │   Hook 1    │──│   Hook 2    │──│   Hook N    │             │
│  │ (sandboxed) │  │ (sandboxed) │  │ (sandboxed) │             │
│  └─────────────┘  └─────────────┘  └─────────────┘             │
│         │                │                │                      │
│         └────────────────┴────────────────┘                      │
│                          │                                       │
│                          ▼                                       │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │               ExecutionTracer                             │   │
│  │  - Auto-trace hook execution                              │   │
│  │  - Build dynamic trace graph                              │   │
│  │  - Causal compression                                     │   │
│  │  - Export for visualization                               │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                   Tool Execution                                 │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │              ApprovalGateMiddleware                       │   │
│  │  - Check tool criticality                                 │   │
│  │  - Generate preview                                       │   │
│  │  - Throw SuspendException if approval needed              │   │
│  └──────────────────────────────────────────────────────────┘   │
│                          │                                       │
│                          ▼                                       │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │              EnvelopeValidator                            │   │
│  │  - Wrap tool input/output in AgentEnvelope                │   │
│  │  - Validate integrity                                     │   │
│  │  - Track permissions                                      │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                 Checkpoint Management                            │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │            SemanticCheckpointManager                      │   │
│  │  - Create checkpoints at key points                       │   │
│  │  - Detect environment changes                             │   │
│  │  - Determine recovery strategy                            │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

### 3.2 Event Flow

```
1. User Message Received
   │
   ├─► BudgetMonitor.recordConsumption()
   │   └─► If warning threshold: triggerGarbageCollection() (once) + injectConvergenceHint()
   │   └─► If refactor threshold: triggerRefactor() (fork)
   │
   ├─► For each Hook:
   │   ├─► ExecutionTracer.traceHook() starts
   │   ├─► createSandboxedContext()
   │   ├─► Hook.execute(sandboxedCtx)
   │   └─► ExecutionTracer.traceHook() ends
   │
   ├─► Tool Execution Request
   │   ├─► ApprovalGateMiddleware.execute()
   │   │   └─► If critical: suspend and return approval request (resumeToken)
   │   │        └─► User responds (/approve|/reject|/modify|/defer)
   │   │            └─► ResumeHandler.processResume()
   │   │                 └─► If approved/modified: re-invoke tool with resolved args
   │   ├─► EnvelopeValidator.wrap(input)
   │   ├─► Tool.execute()
   │   ├─► EnvelopeValidator.wrap(output)
   │   └─► SemanticCheckpointManager.maybeCheckpoint()
   │
   └─► Response to User
       └─► ExecutionTracer.exportForVisualization()
```

---

## 4. Implementation Priorities

> **ROI Analysis**: SuspendException + Resume Token has the highest ROI. It immediately prevents "Agent autonomously executing high-risk commands" and provides natural breakpoints for "shadow execution."

### Phase 1: Critical Control (Week 1-2)

**Priority: Critical | Risk: Low**

1. **SuspendException + ApprovalGate** - Approval Gate ⭐ Highest Priority
   - Tool criticality registry
   - SuspendException mechanism
   - Basic Resume Token implementation
   - Integration with Claude Code permission system
   - *Rationale*: Immediately block high-risk operations, provide breakpoint recovery capability

2. **GovernanceLedger** - Audit Ledger
   - Append-only JSONL storage
   - Basic event type implementation
   - Integrity chain verification
   - *Rationale*: Provides audit foundation for all subsequent components

### Phase 2: Observability (Week 3-4)

**Priority: High | Risk: Low**

3. **ExecutionTracer** - Execution Tracing
   - TraceNode/TraceEdge data structures
   - Automatic hook execution tracing
   - Causal Compression implementation
   - Integration with Ledger
   - *Rationale*: Observability gains + debugging capability

4. **AgentEnvelope** - State Contract
   - Define Envelope interface
   - EnvelopeValidator implementation
   - Integration into tool call flow
   - *Rationale*: Structured communication foundation

### Phase 3: Budget Control (Week 5-6)

**Priority: High | Risk: Medium**

5. **BudgetMonitor** - Circuit Breaker
   - Hidden budget strategy (steps not tokens)
   - Phase 1 GC (70%)
   - Phase 2 Fork (90%)
   - *Rationale*: Solve truncator passive truncation + terminal hallucination problems

### Phase 4: Resilience (Week 7-8)

**Priority: Medium | Risk: Medium**

6. **SemanticCheckpoint** - Semantic Checkpoints
   - Layered state model implementation
   - Change detection logic
   - Recovery strategy
   - *Rationale*: Improve long-task reliability

7. **RefactorStrategy** - Context Refactoring
   - Summary generation
   - Critical context selection
   - Session fork mechanism
   - *Rationale*: Work with BudgetMonitor for graceful circuit breaking

### Phase 5: Isolation (Week 9-10)

**Priority: Medium | Risk: High**

8. **Hook Isolation** - Logical Sandbox
   - Trust level definition
   - Proxy-based permission control
   - Scoped state writer
   - StateProposal mechanism
   - *Rationale*: Improve system stability, but requires careful implementation

### Phase 6: Visualization (Optional)

**Priority: Low | Risk: Low**

9. **Trace Visualization**
   - Mermaid/D3.js export
   - Dashboard UI (if needed)
   - *Rationale*: Nice to have, not core functionality

---

## 5. Configuration Schema

```typescript
/**
 * Governance orchestration configuration
 */
interface GovernanceConfig {
  /**
   * Budget monitoring settings
   */
  budget: {
    /** Default token budget per task */
    defaultAllocation: number

    /** Warning threshold (0-1) */
    warningThreshold: number

    /** Refactor threshold (0-1) */
    refactorThreshold: number

    /** Hard limit (0-1) */
    hardLimit: number

    /** Enable automatic refactoring */
    autoRefactor: boolean
  }

  /**
   * Approval gate settings
   */
  approval: {
    /** Enable approval gates */
    enabled: boolean

    /** Resume token expiry (ms) */
    tokenExpiryMs: number

    /** Tools that always require approval */
    alwaysCritical: string[]

    /** Tools that never require approval */
    neverCritical: string[]

    /** Custom criticality rules */
    customRules: Record<string, ToolCriticalityMeta>
  }

  /**
   * Checkpoint settings
   */
  checkpoint: {
    /** Enable semantic checkpoints */
    enabled: boolean

    /** Auto-checkpoint interval (in tool calls) */
    autoCheckpointInterval: number

    /** File patterns to track for change detection */
    trackPatterns: string[]

    /** Recovery strategy preference */
    recoveryStrategy: "conservative" | "aggressive" | "user-choice"
  }

  /**
   * Hook isolation settings
   */
  isolation: {
    /** Enable hook sandboxing */
    enabled: boolean

    /** Default trust level for unknown hooks */
    defaultTrustLevel: HookTrustLevel

    /** Hook timeout (ms) */
    hookTimeoutMs: number

    /** Per-hook trust overrides */
    trustOverrides: Record<string, HookTrustLevel>
  }

  /**
   * Tracing settings
   */
  tracing: {
    /** Enable execution tracing */
    enabled: boolean

    /** Trace retention (number of traces to keep) */
    retention: number

    /** Export format */
    exportFormat: "json" | "mermaid" | "both"

    /** Compression settings */
    compression: {
      /** Enable causal compression */
      enabled: boolean

      /** Merge threshold for consecutive low-impact hooks */
      mergeThreshold: number

      /** Always keep these hook types as critical */
      alwaysCritical: string[]
    }

    /** Sanitization rules for sensitive data */
    sanitization: {
      /** Fields to redact */
      redactFields: string[]

      /** Max string length before truncation */
      maxStringLength: number
    }
  }

  /**
   * Governance Ledger settings
   */
  ledger: {
    /** Enable governance ledger */
    enabled: boolean

    /** Storage directory (relative to project root) */
    storageDir: string

    /** Retention policy */
    retention: {
      /** Keep ledgers for N days */
      maxAgeDays: number

      /** Keep at most N ledgers */
      maxCount: number

      /** Never delete ledgers with unresolved errors */
      preserveErrors: boolean
    }

    /** Event types to record */
    recordEvents: {
      permissions: boolean
      budget: boolean
      checkpoints: boolean
      recovery: boolean
      approvals: boolean
      stateProposals: boolean
      environmentDrift: boolean
    }
  }
}

/**
 * Default configuration
 */
const DEFAULT_GOVERNANCE_CONFIG: GovernanceConfig = {
  budget: {
    defaultAllocation: 100000, // 100k tokens
    warningThreshold: 0.7,
    refactorThreshold: 0.9,
    hardLimit: 0.95,
    autoRefactor: true
  },
  approval: {
    enabled: true,
    tokenExpiryMs: 30 * 60 * 1000, // 30 minutes
    alwaysCritical: ["Bash", "Write"],
    neverCritical: ["Read", "Glob", "Grep"],
    customRules: {}
  },
  checkpoint: {
    enabled: false, // Opt-in: disabled by default, enable when ready for recovery features
    autoCheckpointInterval: 10,
    trackPatterns: ["src/**/*", "package.json", "tsconfig.json"],
    recoveryStrategy: "conservative"
  },
  isolation: {
    enabled: false, // Disabled by default until stable
    defaultTrustLevel: "plugin",
    hookTimeoutMs: 5000,
    trustOverrides: {}
  },
  tracing: {
    enabled: true,
    retention: 100,
    exportFormat: "json",
    compression: {
      enabled: true,
      mergeThreshold: 5,
      alwaysCritical: ["decision", "checkpoint", "approval-gate"]
    },
    sanitization: {
      redactFields: ["password", "token", "secret", "key"],
      maxStringLength: 1000
    }
  },
  ledger: {
    enabled: true,
    storageDir: ".sisyphus/ledger",
    retention: {
      maxAgeDays: 30,
      maxCount: 100,
      preserveErrors: true
    },
    recordEvents: {
      permissions: true,
      budget: true,
      checkpoints: true,
      recovery: true,
      approvals: true,
      stateProposals: true,
      environmentDrift: true
    }
  }
}
```

---

## 6. Migration Path

### 6.1 Backward Compatibility

All new components are designed as **optional enhancements**, not breaking existing functionality:

| Component | Default State | Migration Effort |
|-----------|---------------|------------------|
| SuspendException | Enabled | Review tool criticality |
| GovernanceLedger | Enabled | Zero migration (passive recording) |
| ExecutionTracer | Enabled | Zero migration |
| CausalCompression | Enabled | Configure merge threshold |
| AgentEnvelope | Opt-in | Gradual adoption per tool |
| BudgetMonitor | Enabled | Configure thresholds |
| HiddenBudget | Enabled | No action needed |
| TwoPhaseRefactor | Enabled | Configure GC/Fork behavior |
| SemanticCheckpoint | Opt-in | Enable when ready |
| ExportFingerprint | Opt-in | Enable for precision recovery |
| StateProposal | Opt-in | Enable with hook isolation |
| HookIsolation | Disabled | Enable after testing |

### 6.2 Feature Flags

```typescript
// Feature flags for gradual rollout
const GOVERNANCE_FEATURES = {
  ENVELOPE_VALIDATION: "governance.envelope.enabled",
  EXECUTION_TRACING: "governance.tracing.enabled",
  BUDGET_MONITORING: "governance.budget.enabled",
  APPROVAL_GATES: "governance.approval.enabled",
  SEMANTIC_CHECKPOINTS: "governance.checkpoint.enabled",
  HOOK_ISOLATION: "governance.isolation.enabled",
  GOVERNANCE_LEDGER: "governance.ledger.enabled"
}
```

---

## 7. Success Metrics

| Metric | Current State | Target | Measurement |
|--------|---------------|--------|-------------|
| Context truncation rate | ~15% of long tasks | <5% | Truncator trigger count |
| Task recovery success | N/A | >80% | Checkpoint restore success |
| Approval gate adoption | 0 | 100% critical tools | Tool coverage |
| Trace completeness | N/A | >95% | Nodes with full metadata |
| Trace compression ratio | N/A | >60% reduction | Compressed vs full node count |
| Hook isolation coverage | 0% | >90% (when enabled) | Sandboxed hook ratio |
| Ledger integrity | N/A | 100% | Integrity chain verification |
| Diagnostic query success | N/A | >70% | Useful cause identification |
| Terminal hallucination incidents | Unknown | <5% | Validation skips after warning |
| Hidden budget effectiveness | N/A | <10% anxiety behavior | Post-warning erratic actions |

---

## 8. Open Questions

1. **Checkpoint Storage**: Filesystem vs SQLite vs Memory?
   - Current preference: Filesystem (`.sisyphus/checkpoints/`), simple and debuggable

2. **Trace Visualization**: Built-in vs External tools?
   - Current preference: JSON export + external tools (Mermaid Live Editor)

3. **Hook Isolation Granularity**: Per-hook vs per-namespace?
   - Current preference: Per-namespace, reduces configuration complexity

4. **Approval UX**: CLI interaction vs popup?
   - Rely on existing Claude Code mechanisms, don't reinvent

---

## Appendix A: Glossary

| Term | Definition |
|------|------------|
| Governance Orchestration | Governance-oriented orchestration emphasizing observability and intervention over predefined workflows |
| Semantic Checkpoint | Checkpoint with environment awareness containing task state snapshot |
| Export Fingerprint | Fingerprint tracking file public API changes for impact propagation |
| Impact Propagation | Automatically marking consumers as invalid when a file's API changes |
| Lazy Fingerprinting | On-demand fingerprinting: mtime normally, AST comparison only on conflict |
| Hook Isolation | Hook logical sandbox limiting state access via Proxy |
| StateProposal | State proposal mechanism where hooks request shared state modification via proposal queue |
| Execution Trace | Execution trace, dynamically generated call graph at runtime |
| Causal Compression | Merging consecutive low-impact hooks into GovernanceBlocks |
| Critical Path | Simplified trace keeping only decision points and state changes |
| Agent Envelope | State contract, standardized Agent/Tool communication protocol |
| Approval Gate | Human confirmation mechanism before critical operations |
| SuspendException | Exception triggering approval flow and creating recovery point |
| Circuit Breaker | Graceful degradation strategy when budget exceeds limits |
| Hidden Budget | Presenting "remaining steps" to LLM instead of token counts |
| Two-Phase Refactor | Progressive strategy: 70% GC + 90% Fork |
| Terminal Hallucination | Model behavior skipping validation after receiving budget warning |
| Governance Ledger | Immutable audit log |
| Transfer Manifest | Critical context carried during Session Fork |

---

## Appendix B: Related Documents

- [Context Management Strategy](./context-management-strategy.md)
- [Multi-Model Planning Guide](./multi-model-planning-guide.md)
- [Planning with Files Guide](./planning-with-files-guide.md)
- [Orchestration Guide](./orchestration-guide.md)
