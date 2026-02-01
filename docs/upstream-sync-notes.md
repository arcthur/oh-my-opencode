# Upstream Sync Notes

> Last updated: 2026-02-01  
> Local `dev`: `beddc1f5`  
> Remote `upstream/dev`: `96e7b39a`  
> Status: `dev` is **ahead 94** / **behind 336** vs `upstream/dev` (merge-base: `66fd761a`)

This document tracks the key architectural deltas between our `dev` branch and `upstream/dev`, and records the design decisions behind intentional divergence.

Goals:
- Clearly separate **fork-only deltas** we intend to keep from upstream changes we may want to follow.
- Identify **upstream additions not yet merged** (and prioritize them).
- Highlight **conflict hotspots** and recommended sync strategy.

---

## 0. Quick Verification (Run Before Updating This Doc)

```bash
git fetch --no-tags upstream dev
git rev-list --left-right --count upstream/dev...dev
```

Note: output is `<behind> <ahead>` i.e. “commits only in upstream / commits only in our fork”.

---

## 1. Branch Relationship (Snapshot)

```
merge-base: 66fd761a

upstream/dev: 96e7b39a  (we are behind 336 commits)
dev:         beddc1f5   (we are ahead 94 commits)
```

Conclusion: this is a **bidirectionally diverged** fork (not “ahead-only”). Over time, “small cherry-picks” become less effective; prefer periodic merge/rebase with explicit conflict resolution on known hotspots.

---

## 2. Difference Taxonomy: Fork-only / Upstream-only / Both-modified

### 2.1 Fork-only Additions (Not Present in `upstream/dev`)

These are the core differentiators of our fork. If upstream later introduces similar capabilities, we should decide per item whether to align, replace, or run both.

#### `src/features/` (Core Capabilities)

| Module | Purpose | Notes |
|--------|------|------|
| `governance/` | Budgeting / approvals / ledger / tracing | Primary differentiation |
| `session-handoff/` | Cross-session knowledge transfer | `/handoff` + citation/recall |
| `user-memory/` | Persistent user preferences/history (embeddings) | Adds `@huggingface/transformers` |
| `org-memory/` | Organization/team memory | Shared context |
| `conditional-rules/` | Path/condition-sensitive rule injection | `AGENTS.md` parsing + matcher |
| `multi-plan/` | Multi-model planning pipeline | Clarity/complexity routing, etc. |
| `planning-with-files/` | File-based planning workflow (Manus-style) | Integrated with `work-state` |
| `work-state/` | Unified work state (YAML) | Replaces upstream `boulder-state` |
| `session-state-coordinator/` | Session lifecycle coordination | Cross-feature cleanup/coherence |

#### `src/agents/` (Agents)

| Agent | Purpose | File |
|-------|------|------|
| `plan-synthesizer` | Critique + synthesize multiple plans | `src/agents/plan-synthesizer.ts` |

#### `src/tools/` (Tools)

| Tool | Purpose | Notes |
|------|------|------|
| `multi-plan` | Trigger/execute the multi-plan pipeline | No upstream equivalent |

#### `src/hooks/` (Protocols / Guardrails)

| Hook | Purpose | Notes |
|------|------|------|
| `multi-plan-trigger` | Auto-detect when multi-plan is needed | Not in upstream |
| `planning-with-files` | File-based planning workflow hook | Not in upstream |
| `silent-tool-output` | Reduce noisy tool output / context | Not in upstream |
| `pre-completion-verification` | Prevent “done” claims without verification | Not in upstream |
| `delegation-validator` | Validate delegation protocol for `delegate_task` | Not in upstream |
| `anti-slop-enforcer` | Enforce anti-slop formatting/guardrails | Not in upstream |
| `repo-overview-injector` | Inject repository overview context | Not in upstream |
| `runtime-tracker` | Runtime / performance tracking | Not in upstream |
| `tmux-parallel-agents` | Tmux window automation for background agents | Hybrid: upstream auto-trigger + parallel-agents skill patterns |

Note: we renamed upstream `anthropic-context-window-limit-recovery` to `context-window-limit-recovery` and expanded capabilities (see 2.3 / 3.3).

---

### 2.2 Upstream Additions Not Yet Merged (Missing in Our `dev`)

This section is the main source of “upstream decisions/features we might want to follow”.

#### `src/features/` (New Upstream Modules)

| Module | Potential Value | Recommendation |
|--------|----------|------|
| `tmux-subagent/` | tmux-pane automation/collaboration | Evaluate relevance; may be tmux-only |
| `sisyphus-tasks/` | JSON task storage with dependency tracking | Future: Swarm task pool; complements work-state (see §3.5) |
| `sisyphus-swarm/` | Multi-agent coordination via mailbox | Future: parallel agent orchestration (see §3.6) |

#### `src/hooks/` (New Upstream Hooks)

| Hook | Intent (as implemented upstream) | Recommendation |
|------|----------------------|------|
| ~~`stop-continuation-guard`~~ | ~~`/stop-continuation`: halts continuation mechanisms~~ | ✅ **Merged** (2026-01-31) |
| ~~`subagent-question-blocker`~~ | ~~Prevent subagents from asking users via question tools~~ | ✅ **Merged** (2026-01-31) |
| ~~`question-label-truncator`~~ | ~~Truncate long labels for question tool UI/protocol safety~~ | ✅ **Merged** (2026-01-31) |
| ~~`category-skill-reminder`~~ | ~~Remind orchestrators to delegate via category+skill system~~ | ✅ **Merged** (2026-02-01) - Complements delegation-validator |
| ~~`sisyphus-junior-notepad`~~ | ~~Inject notepad directive into delegated prompts~~ | ✅ **Merged** (2026-02-01) - Dynamic injection, refactored agent prompt |

#### Key Interfaces/Conventions That Changed Upstream (Now Aligned)

1) ~~**Canonical IDs moved to lowercase**~~ ✅ **Aligned** (2026-01-31) - Now using `sisyphus`, `atlas`, `prometheus`, `sisyphus-junior` everywhere.

2) ~~**`delegate_task` arguments diverged**~~ ✅ **Aligned** (2026-01-31) - Now using upstream naming: `load_skills`, `session_id`, `command`.

3) ~~**Category system evolved upstream**~~ ✅ **Aligned** (2026-02-01) - Added `deep` category (provider-agnostic, no hardcoded model).

---

### 2.3 Both-modified Areas (High Conflict / Requires an Explicit Strategy)

These paths are likely to conflict in future syncs. Decide up front “who wins” and how to merge:

- `src/index.ts`: main entry for registering hooks/tools/features (highest conflict rate)
- `src/config/schema.ts`: naming, fields, defaults, and migration compatibility
- `src/tools/delegate-task/*`: rapidly evolving args/behavior/default categories
- `src/agents/sisyphus.ts`, `src/agents/atlas.ts`: prompt/protocol changes; tightly coupled to tool args
- `src/features/boulder-state/*` vs `src/features/work-state/*`: state system divergence
- `src/features/builtin-skills/skills.ts`: upstream-added skills (e.g. `agent-browser`) vs our additions
- `src/hooks/*`: both sides add hooks; requires consistent HookNameSchema + exports

---

## 3. Key Design Decisions (Why We Intentionally Diverge)

### 3.1 Governance: `governance/`

Goal: provide a configurable cross-cutting layer for observability, budgets, approvals, ledger, and tracing—primarily to keep agent behavior controlled in complex projects.

Risk: upstream may eventually introduce similar mechanisms; we should decide whether to replace ours or continue maintaining our implementation.

### 3.2 Category Strategy: Provider-agnostic Defaults

Upstream: hardcodes recommended `model` values in `DEFAULT_CATEGORIES` (e.g. `google/gemini-3-pro`, `openai/gpt-5.2-codex`), and adds a `deep` category.

Ours: do not set `model` by default; keep `variant`/prompt-append semantics and rely on the user’s system default model, with optional overrides in `categories`.

Trade-offs:
- ✅ Works with single-provider setups (no hard dependency on specific vendors)
- ✅ Reduces startup failures due to unavailable default models
- ❌ Loses upstream’s “batteries-included” recommended model mapping
- ❌ Gradually diverges from upstream docs/prompts (especially `deep`)

Recommendation: keep provider-agnostic defaults short-term, but consider adding an optional “upstream-recommended models” preset (not the default) to reduce long-term drift.

### 3.3 Context Window Recovery: Hook Naming and Capability Expansion

Upstream: `anthropic-context-window-limit-recovery` (provider-specific naming), reflected in schema hook names.

Ours: `context-window-limit-recovery` (provider-agnostic naming), plus more aggressive/configurable pruning capabilities (e.g. richer pruning executor, turn protection, etc.).

Risk: upstream configs copied verbatim (e.g. `disabled_hooks`) won’t match our hook name; requires migration support or documentation.

### 3.4 State System: `boulder-state` → `work-state`

Upstream: JSON state file (`.sisyphus/boulder/boulder.json`) with relatively few fields.

Ours: YAML state (`.sisyphus/work.yaml`) with richer fields (errors/blockers/decisions/progress, etc.), better suited for long-lived, auditable workflows and handoffs.

Risk: as upstream evolves `boulder-state`, we need to decide whether to reintroduce compatibility or keep the forked model.

### 3.5 sisyphus-tasks: Task Storage vs Work State

**What it is:** JSON-based task storage system with per-task files and dependency tracking.

```
.sisyphus/tasks/{listId}/{taskId}.json
```

**Upstream implementation (~100 LOC):**
- Task schema: `id`, `subject`, `description`, `status`, `blocks`, `blockedBy`, `owner`, `metadata`
- Atomic writes via temp file + rename
- `claude_code_compat` mode for Claude Code TodoWrite compatibility
- Zod validation

**Relationship to work-state:**

| Concern | sisyphus-tasks | work-state |
|---------|----------------|------------|
| **Purpose** | Task storage/distribution | Session execution state |
| **Question answered** | "What tasks exist? Who owns them?" | "How is current session progressing?" |
| **Scope** | Multi-agent task pool | Single orchestrator workflow |
| **Features** | CRUD + dependencies | 2-action rule, 3-strike protocol, blockers, decisions, phase reflection |

**Conclusion:** Not competing systems. Future integration path:
- `sisyphus-tasks`: Swarm task pool (shared across agents)
- `work-state`: Per-agent execution state (errors, progress, decisions)

### 3.6 sisyphus-swarm: Multi-Agent Coordination

**What it is:** Distributed agent coordination via file-based mailbox protocol.

**Architecture difference:**

```
Current: Single Orchestrator + Subagents (synchronous)
┌─────────────┐
│  Sisyphus   │ ──delegate_task()──► sisyphus-junior (sync call, same process)
└─────────────┘

Swarm: Multiple Independent Agents (asynchronous)
┌─────────┐     ┌─────────┐     ┌─────────┐
│ Agent A │     │ Agent B │     │ Agent C │   ← separate terminals/processes
└────┬────┘     └────┬────┘     └────┬────┘
     └───────────────┼───────────────┘
                     ▼
        .sisyphus/teams/{team}/inboxes/*.json   ← async mailbox
```

**Mailbox protocol messages (upstream):**
- `join_request` / `join_approved` / `join_rejected`: Team membership
- `task_assignment` / `task_completed` / `idle_notification`: Task lifecycle
- `permission_request` / `permission_response`: Cross-agent permissions
- `plan_approval_request` / `plan_approval_response`: Plan review
- `shutdown_request` / `shutdown_approved` / `shutdown_rejected`: Graceful termination
- `mode_set_request`: Change agent mode (plan, delegate, acceptEdits, etc.)

**Why Swarm matters (future):**
1. **Breaks single-instance limits** - Multiple Claude Code instances in parallel
2. **True parallelism** - Not just subagent calls, but independent processes
3. **Fault tolerance** - One agent crash doesn't kill others
4. **Human observability** - tmux panes show each agent's work

**Current status:** Upstream has only `mailbox/types.ts` (~120 LOC). No runtime implementation yet.

**Integration plan when ready:**
1. Sync `sisyphus-tasks/` as shared task pool
2. Sync `sisyphus-swarm/` for mailbox protocol
3. Keep `work-state/` as per-agent execution state (complementary, not replaced)

---

## 4. Dependency Differences (vs `upstream/dev`)

| Package | Upstream | Ours | Notes |
|---------|----------|------|------|
| `@huggingface/transformers` | ❌ | ✅ | Local embeddings provider for `user-memory` |

Note: items like `vscode-jsonrpc` and `mcp-oauth` already exist in current `upstream/dev` and are no longer fork-only.

---

## 5. Sync Strategy (Recommended)

Given **behind=336**, prefer periodic merge/rebase over per-commit cherry-picks:

1) Create a working branch (e.g. `sync/upstream-dev-YYYYMMDD`)
2) Merge or rebase onto `upstream/dev` (choose based on history policy)
3) Resolve the high-conflict hotspots in 2.3 first, then make the repo buildable (typecheck + tests)
4) Decide module-by-module whether to follow upstream additions (see 2.2)

---

## 6. “Better Upstream Decisions?” Follow Candidates (Prioritized)

This is the main action section: identify upstream changes worth following to avoid long-term maintenance drag from divergence.

### 6.1 High Priority (Follow Soon)

- ~~Upstream hooks: `stop-continuation-guard`, `subagent-question-blocker`, `question-label-truncator`~~ ✅ **Merged** (2026-01-31)
- ~~Align `delegate_task` args: `load_skills` / `session_id` / `command`~~ ✅ **Merged** (2026-01-31)
- ~~Canonical ID lowercasing (agent/hook/skill)~~ ✅ **Merged** (2026-01-31) - Now using `sisyphus`, `atlas`, `prometheus`, `sisyphus-junior`

### 6.2 Medium Priority (Evaluate Before Deciding)

- ~~`category-skill-reminder`~~ ✅ **Merged** (2026-02-01) - Complements delegation-validator as pre-decision nudge
- ~~`sisyphus-junior-notepad`~~ ✅ **Merged** (2026-02-01) - Dynamic injection saves tokens, refactored agent prompt
- ~~`sisyphus-tasks/`~~ → **Deferred to §6.4** - Complements work-state, not replaces; sync with Swarm (see §3.5)
- ~~`deep` category~~ ✅ **Merged** (2026-02-01) - Added as optional category with `variant: "high"`, no model hardcoding

### 6.3 Low Priority (Evaluated)

- ~~`bb181ee5` background-agent memory leak~~ ✅ **Merged** (2026-02-01) - Track and cancel completion timers
- ~~`b03e463b` zombie processes fix~~ ✅ **Merged** (2026-02-01) - Proper process lifecycle in LSP/skill-mcp-manager/interactive-bash
- ~~`tmux-subagent/`~~ → **Merged as `tmux-parallel-agents` hook** (2026-02-01)
  - Hybrid approach: upstream's automatic `session.created` triggering + user's parallel-agents skill patterns
  - Features: wm-* naming, git worktree isolation, status detection, auto-rescue, @workmux_status icons
  - Config: `tmux_parallel_agents: { enabled, auto_rescue, status_icons, worktree: { enabled, dir_pattern, copy_files, symlink, auto_cleanup } }`

### 6.4 Future Priority (Swarm Infrastructure)

These modules form the foundation for multi-agent coordination. Defer until upstream has runtime implementation, then sync together.

- `sisyphus-tasks/`: JSON task storage with dependency tracking (see §3.5)
  - Status: Schema + storage utilities only (~100 LOC)
  - When to sync: When Swarm runtime is ready, or if we want Claude Code TodoWrite compatibility
  - Integration: Complements work-state (task pool vs execution state)

- `sisyphus-swarm/`: Mailbox-based multi-agent coordination (see §3.6)
  - Status: Type definitions only (~120 LOC), no runtime yet
  - When to sync: When upstream adds actual mailbox read/write + agent coordination logic
  - Integration: Each Swarm agent would use work-state for local execution tracking

---

## 7. Reference Commands (Minimal Set)

```bash
# Update upstream reference
git fetch --no-tags upstream dev

# Count divergence
git rev-list --left-right --count upstream/dev...dev

# Inspect upstream-only commits
git log --oneline dev..upstream/dev

# Inspect our commits
git log --oneline upstream/dev..dev

# Compare a specific file
git diff upstream/dev..dev -- path/to/file
```
