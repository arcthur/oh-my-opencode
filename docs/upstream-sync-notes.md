# Upstream Sync Notes

> Last updated: 2026-01-31  
> Local `dev`: `5f68dc77`  
> Remote `upstream/dev`: `96e7b39a`  
> Status: `dev` is **ahead 92** / **behind 336** vs `upstream/dev` (merge-base: `66fd761a`)

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
dev:         5f68dc77   (we are ahead 92 commits)
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

Note: we renamed upstream `anthropic-context-window-limit-recovery` to `context-window-limit-recovery` and expanded capabilities (see 2.3 / 3.3).

---

### 2.2 Upstream Additions Not Yet Merged (Missing in Our `dev`)

This section is the main source of “upstream decisions/features we might want to follow”.

#### `src/features/` (New Upstream Modules)

| Module | Potential Value | Recommendation |
|--------|----------|------|
| `tmux-subagent/` | tmux-pane automation/collaboration | Evaluate relevance; may be tmux-only |
| `sisyphus-tasks/` | Task storage/types | Likely worth evaluating; may reduce our custom state surface |
| `sisyphus-swarm/` | Swarm-related primitives | Small today; can defer |

#### `src/hooks/` (New Upstream Hooks)

| Hook | Intent (as implemented upstream) | Recommendation |
|------|----------------------|------|
| ~~`stop-continuation-guard`~~ | ~~`/stop-continuation`: halts continuation mechanisms~~ | ✅ **Merged** (2026-01-31) |
| ~~`subagent-question-blocker`~~ | ~~Prevent subagents from asking users via question tools~~ | ✅ **Merged** (2026-01-31) |
| ~~`question-label-truncator`~~ | ~~Truncate long labels for question tool UI/protocol safety~~ | ✅ **Merged** (2026-01-31) |
| `category-skill-reminder` | Remind orchestrators to delegate via category+skill system | Overlaps with our validator; consider merging |
| `sisyphus-junior-notepad` | Inject notepad directive into delegated prompts | Evaluate; may improve stability/quality |

#### Key Interfaces/Conventions That Changed Upstream (Now Aligned)

1) ~~**Canonical IDs moved to lowercase**~~ ✅ **Aligned** (2026-01-31) - Now using `sisyphus`, `atlas`, `prometheus`, `sisyphus-junior` everywhere.

2) ~~**`delegate_task` arguments diverged**~~ ✅ **Aligned** (2026-01-31) - Now using upstream naming: `load_skills`, `session_id`, `command`.

3) **Category system evolved upstream**: upstream added a `deep` category and continues to hardcode default models; we chose provider-agnostic defaults (see 3.2).

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

- `category-skill-reminder`: overlaps with `delegation-validator`; may be merged into stronger “delegation governance”
- `sisyphus-junior-notepad`: worth it if it measurably stabilizes subagent outputs
- `sisyphus-tasks/`: evaluate whether it can reduce our custom state surface
- `deep` category: can exist as an optional preset without hardcoding models by default

### 6.3 Low Priority (Can Defer)

- `tmux-subagent/`: environment-specific, narrow applicability
- `sisyphus-swarm/`: currently small (mailbox types); revisit when upstream matures

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
