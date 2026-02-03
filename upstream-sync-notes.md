# Upstream Sync Notes (Fork Policy + Sync Anchors)

> Last updated: 2026-02-03  
> Fork branch: `dev` @ `e4b0759e` *(worktree contains uncommitted sync work)*  
> Upstream baseline: `dev` @ `1e587c55` *(local clone: `../oh-my-opencode-upstream`)*  
> merge-base: `66fd761a`  
> Divergence (`upstream/dev...dev`): behind **416** / ahead **117** commits

This document is the **authoritative policy record** for syncing this fork with `upstream/dev`.

It answers:
- Which upstream commit we are syncing against (anchors)
- Which subsystems are **fork-owned** (upstream equivalents must not be merged)
- Which upstream artifacts are **explicitly excluded** from this fork
- How to resolve the predictable conflict hotspots consistently

It intentionally does **not** track every file-level merge/cherry-pick. Use Git history/diffs for the ground truth of exact changes.

---

## 1. Refreshing the Sync Anchors

```bash
# Remote upstream (if available)
git fetch --no-tags upstream dev
git rev-list --left-right --count upstream/dev...dev

# Local upstream clone (preferred for offline work)
UP_REPO=../oh-my-opencode-upstream
UP=$(git -C "$UP_REPO" rev-parse dev)
BASE=$(GIT_ALTERNATE_OBJECT_DIRECTORIES="$UP_REPO/.git/objects" git merge-base HEAD "$UP")
echo "upstream:   $UP"
echo "merge-base: $BASE"
GIT_ALTERNATE_OBJECT_DIRECTORIES="$UP_REPO/.git/objects" git rev-list --left-right --count "$UP...HEAD"
```

The output is `<behind> <ahead>` (commits only in upstream / commits only in this fork).

---

## 2. Sync Policy (Conflict Resolution Rules)

Policy keywords used below:
- **FOLLOW**: upstream is the default source of truth; prefer upstream on conflicts unless a fork policy says otherwise.
- **FORK_ONLY**: exists only in this fork; keep.
- **FORK_OWNED**: the fork owns this subsystem; do not merge upstream equivalents (even if upstream has a similar implementation).
- **FORK_OVERRIDE**: upstream has a similar subsystem, but this fork intentionally diverges (naming/API/behavior). Keep the fork interface and selectively port upstream fixes.
- **DROP**: upstream has runtime code, but this fork intentionally excludes it.
- **IGNORE_NOOP**: upstream schema/docs residue without runtime implementation; keep removed in this fork until upstream ships a real implementation.

---

## 3. Fork Boundary Matrix (Authoritative)

| Area | Upstream artifact(s) | Fork implementation | Policy | Decision | Sync action |
|------|-----------------------|--------------------|--------|----------|------------|
| Governance & approvals | *(none)* | `src/features/governance/` | FORK_ONLY | 2026-02-03 | Keep fork. Conflicts touching governance should be resolved in favor of the fork. |
| Session handoff | *(none)* | `src/features/session-handoff/` | FORK_ONLY | 2026-02-03 | Keep fork. |
| User memory (embeddings) | *(none)* | `src/features/user-memory/` | FORK_ONLY | 2026-02-03 | Keep fork. |
| Org/team memory | *(none)* | `src/features/org-memory/` | FORK_ONLY | 2026-02-03 | Keep fork. |
| Conditional rules | *(none)* | `src/features/conditional-rules/` | FORK_ONLY | 2026-02-03 | Keep fork. |
| Multi-plan pipeline | *(none)* | `src/features/multi-plan/`, `src/tools/multi-plan/`, `src/agents/plan-synthesizer.ts` | FORK_ONLY | 2026-02-03 | Keep fork. |
| Planning-with-files workflow | *(none)* | `src/features/planning-with-files/`, `src/hooks/planning-with-files/` | FORK_ONLY | 2026-02-03 | Keep fork. |
| Work state (project execution state) | `src/features/boulder-state/` | `src/features/work-state/` | FORK_OWNED | 2026-02-03 | Do not reintroduce `boulder-state`. Port ideas selectively if needed, but keep `work-state` as the canonical state system. |
| Swarm coordination | *(none)* | `src/features/sisyphus-swarm/` | FORK_ONLY | 2026-02-03 | Keep fork. |
| Task storage & distribution | `src/features/claude-tasks/`, `src/tools/task/`, `src/hooks/task-reminder/` | `src/features/sisyphus-tasks/` + `src/features/work-state/` | FORK_OWNED | 2026-02-03 | Never merge `claude-tasks` or `task_*` tools. If we need Claude Code TodoWrite compatibility, build an adapter on top of `sisyphus-tasks` (do not reintroduce upstream storage). |
| Tmux automation | `src/features/tmux-subagent/`, `src/shared/tmux/` | `tmux-parallel-agents` hook + `src/features/sisyphus-swarm/tmux` (and config `tmux_parallel_agents`) | FORK_OWNED | 2026-02-03 | Always delete upstream `tmux-subagent` + `shared/tmux` on sync. Do not re-add the upstream `tmux` config schema key. |
| Context window recovery hook naming | `anthropic-context-window-limit-recovery` (hook) | `context-window-limit-recovery` (hook) | FORK_OVERRIDE | 2026-02-03 | Keep fork hook name and behavior. If upstream evolves the recovery logic, port fixes into the fork hook without reverting the name. |
| Upstream babysitter hook | `src/hooks/unstable-agent-babysitter/` | *(none)* | DROP | 2026-02-03 | Keep removed. Only re-add via an explicit decision if we adopt its behavior. |
| No-op hook names (upstream schema/docs only) | `grep-output-truncator`, `tasks-todowrite-disabler` | *(removed from schema/docs; filtered in migration)* | IGNORE_NOOP | 2026-02-03 | Keep removed to avoid “phantom hooks”. Re-evaluate only if upstream ships a real implementation. |
| Docs-only legacy mentions | `background-compaction`, `empty-message-sanitizer` | *(removed from docs)* | IGNORE_NOOP | 2026-02-03 | Keep removed to avoid misleading configuration guidance. |

---

## 4. High-Conflict Hotspots (Expect Conflicts During Sync)

These paths are structurally conflict-prone. Resolve with a stable rule rather than ad-hoc edits:

- `src/index.ts`: registry of hooks/tools/features; the most frequent conflict hotspot
- `src/config/schema.ts`: hook names, categories, defaults; keep it consistent with runtime exports
- `src/tools/delegate-task/*`: fast-moving API surface (args/protocol) and category behavior
- `src/tools/call-omo-agent/*`: explore/librarian execution + `session_id` metadata/continuation; keep fork semantics consistent with `delegate_task`
- `src/agents/sisyphus.ts`, `src/agents/atlas/*`: prompt/protocol changes; tightly coupled to tool args
- `src/features/builtin-skills/skills.ts`: upstream additions vs fork-only skills; decide case-by-case
- `docs/*`: upstream docs drift frequently; prefer this fork’s policy where it differs

---

## 5. Sync Workflow (Recommended)

1. Create a working branch (e.g. `sync/upstream-dev-YYYYMMDD`).
2. Update upstream baseline (fetch remote or update `../oh-my-opencode-upstream`).
3. Merge/rebase onto `upstream/dev`.
4. Apply the fork boundary matrix:
   - Delete/keep modules according to §3 (especially `tmux-subagent`, `claude-tasks`, `boulder-state`, and `unstable-agent-babysitter`).
   - Keep schema/docs free of `IGNORE_NOOP` hook names.
5. Fix buildability first (typecheck + tests), then resolve behavioral differences.
6. Regenerate schema: `bun run build:schema`.
7. Update this document:
   - Refresh anchors in the header
   - Add new decisions (dated) if you intentionally diverge further

---

## 6. Minimal Verification Commands

```bash
bun run typecheck
bun test
bun run build:schema
```

---

## 7. Sync Log (High-Level)

| Date | Upstream baseline | merge-base | Summary |
|------|-------------------|------------|---------|
| 2026-02-03 | `1e587c55` | `66fd761a` | Drop upstream `tmux-subagent`/`claude-tasks`/`unstable-agent-babysitter`; remove upstream schema/docs no-op hook names; keep fork-owned replacements (`work-state`, `sisyphus-tasks`, `sisyphus-swarm`, governance/memory/multi-plan). |

### 2026-02-03 Addendum (File-by-File Review + Link Validation)

- `src/agents/*`: Do NOT reintroduce upstream `metis/momus`; the fork’s planning capability is covered by `multi-plan` + `plan-synthesizer` (see `docs/multi-model-planning-guide.md`).
- `src/agents/utils.ts`: Fixed a broken override path where `skills` injection via agent overrides did not affect the final resolved prompt; added regression coverage to ensure config overrides are actually applied.
- `src/tools/delegate-task/constants.ts`: Do NOT merge upstream’s Momus-gated mega prompt; instead, port the underlying intent (dependency/parallelism analysis + category/skills recommendations) in a fork-aligned minimal form consistent with the multi-plan philosophy (minimal back-and-forth, explicit assumptions).
- `src/tools/delegate-task/tools.ts`: Clarified that `run_in_background` is REQUIRED to prevent missing-arg tool-call failures.
- `src/tools/call-omo-agent/*`: Kept `<task_metadata>` (background outputs include `session_id`) to preserve stable continuation flows; updated tool description to state `session_id` is not supported in background mode and recommend continuing via `delegate_task(session_id=...)`.
- `src/hooks/atlas/index.ts`: Ported upstream-safe orchestration improvements without reintroducing `boulder-state`; fixed background-task output handling (`Background task continued`), and made `session_id` continuation extraction robust (supports `<task_metadata>`).
- `src/hooks/atlas/index.test.ts`: Added regression coverage for background continuation skip + `<task_metadata>` `session_id` extraction to prevent silent infinite loops.
- `src/hooks/keyword-detector/index.ts` + `src/hooks/keyword-detector/index.test.ts`: Fully aligned with upstream. Verified the chat-message chain is: ignore `[SYSTEM DIRECTIVE: OH-MY-OPENCODE …]` → strip `<system-reminder>` content → detect `[ultrawork/search/analyze]` (model-aware) → skip background-task sessions + non-main sessions → prepend mode message into the first text part. Also verified planner agents (e.g. Prometheus) do NOT receive `ultrawork` injection to avoid redundant/recursive prompting.
- `src/hooks/keyword-detector/ultrawork/*`: FORK_OVERRIDE. Keep fork versions of `default.ts`, `gpt5.2.ts`, `planner.ts` because they include tool-schema-correct `delegate_task(...)` examples (this fork requires `description`, `prompt`, `load_skills`, and `run_in_background`); upstream’s shortened examples can cause invalid tool-call args.
- `src/hooks/claude-code-hooks/*`: Fully aligned with upstream (no fork-specific divergence). Verified the end-to-end chain (`src/index.ts` → `createClaudeCodeHooksHook` → Pre/PostToolUse/UserPromptSubmit/Stop/PreCompact), and kept transcript + todo compatibility behavior unchanged.
- `src/hooks/non-interactive-env/*`: Fully aligned with upstream. Maintains the invariant that the `Bash` tool always uses Unix `export ...; cmd` syntax (even on Windows) for git commands, and keeps the warning message non-emoji (stable for downstream parsers).
- `src/hooks/comment-checker/*`: Fully aligned with upstream (no fork-specific divergence). Verified the lifecycle (`tool.execute.before` capture → `tool.execute.after` CLI check) and preserved lazy binary resolution/download behavior.
- `src/hooks/directory-agents-injector/*`: Fully aligned with upstream. Removed the fork’s Batch-tool plumbing + tests because upstream confirmed it was dead code (OpenCode has no `batch` tool); verified the effective chain is `tool.execute.after(read)` → inject nearest-parent `AGENTS.md` files (skipping repo root) with dynamic truncation, and `tool.execute.before` is a no-op.
- `src/hooks/directory-readme-injector/*`: Fully aligned with upstream (no fork-specific divergence). Verified the effective chain is `tool.execute.after(read)` → inject nearest-parent `README.md` files (includes repo root) with dynamic truncation, and `tool.execute.before` is a no-op.
- `src/hooks/rules-injector/*`: Fully aligned with upstream (no fork-specific divergence). Verified the effective chain is `tool.execute.after(read/write/edit/multiedit)` → resolve target file path → discover applicable rule files (supports `.claude/rules/`, `.cursor/rules/`, and `.sisyphus/rules/`) → inject de-duplicated rule bodies with dynamic truncation and stable on-disk tracking.
- `src/hooks/edit-error-recovery/*`: Fully aligned with upstream. Verified the chain is `tool.execute.after(edit)` → detect known Edit failure patterns → append a short, imperative recovery checklist to prevent repeated wrong edits.
- `src/hooks/delegate-task-retry/*`: Fully aligned with upstream. Verified the chain is `tool.execute.after(delegate_task)` → detect invalid-args patterns → append precise retry guidance (including `run_in_background` + `load_skills` invariants and “available list” extraction).
- `src/hooks/tool-output-truncator.ts`: Fully aligned with upstream. Verified the chain is `tool.execute.after(large-output tools)` → dynamic truncation with tool-specific token caps (notably `webfetch/WebFetch`) → replace output only when truncated, with graceful degradation on truncator failures.
- `src/hooks/empty-task-response-detector.ts`: Fully aligned with upstream. Verified the chain is `tool.execute.after(Task)` → detect empty response → replace with an explicit warning that the call already completed.
- `src/hooks/start-work/*`: FORK_OWNED alignment (upstream uses `boulder-state`, fork uses `work-state`). Ported upstream-safe behavior without reintroducing `boulder-state`:
  - Plan discovery/progress is computed directly from `.sisyphus/plans/*.md` (works even when no `work.yaml` exists yet).
  - Explicit plan selection no longer pollutes the injected context with the previous plan name; keeps the prompt minimal and unambiguous.
  - Session count reporting is consistent with “current session appended”.
- `src/hooks/auto-slash-command/constants.ts`: Fully aligned with upstream (no fork-specific divergence). Verified `/handoff` is no longer excluded here because the fork’s `session-handoff` hook handles it earlier in the chat-message pipeline.
- `src/hooks/auto-slash-command/executor.ts`: FORK_OVERRIDE. Keep the fork implementation because it reuses shared discovery utilities (`src/shared/command-discovery.ts`, `src/shared/paths.ts`) while preserving upstream behavior (OPENCODE/Claude Code command directories, model sanitization, and lazy skill content loading).
- `src/hooks/stop-continuation-guard/*`: Fully aligned with upstream (no fork-specific divergence). Verified it cancels continuation mechanisms early in `chat.message` to prevent auto-continue loops when the user explicitly opts out.
- `src/hooks/ralph-loop/*`: Fully aligned with upstream. Verified completion detection prefers transcript JSONL (skips `type: "user"` to avoid false positives, issue #622), falls back to the session-messages API, and uses message-file fallback to preserve agent/model context for `session.prompt` when the API is unavailable.
- `src/hooks/category-skill-reminder/*`: Ported upstream behavior (track delegatable tool calls; inject after 3 calls only if no delegation tools were used; reset on session delete/compaction). FORK_OVERRIDE: keep fork-specific `delegate_task(...)` example text in the reminder so it matches this fork’s required tool args (notably `prompt`).
- `src/hooks/planning-with-files/index.ts`: Fork-only (no upstream equivalent). Reviewed end-to-end hook chain (ContextCollector injection + multi_plan structured result parsing) and removed dead code (unused imports/locals) to keep the workflow minimal and non-redundant.
- `src/features/work-state/manager.ts`: Improved Manus compatibility for fork-owned `work-state`:
  - Derive `plan_name` from the plan directory when `active_plan` is `*/task_plan.md` (fixes Atlas plan naming).
  - Parse Manus `## Phases` table rows for progress + phase utilities.
  - Treat Manus `blocked` phases as non-actionable completion for `getPlanProgress()` (prevents Atlas auto-continuation loops when all remaining work is blocked).
