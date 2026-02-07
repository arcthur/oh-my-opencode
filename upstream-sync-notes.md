# Upstream Sync Notes (Fork Policy + Sync Anchors)

> Last updated: 2026-02-06  
> Fork branch: `dev` @ `9fcee7f5` *(worktree contains uncommitted sync work)*  
> Upstream baseline: `dev` @ `368ac310` *(local clone: `../oh-my-opencode-upstream`)*  
> merge-base: `66fd761a`  
> Divergence (`upstream/dev...dev`): behind **584** / ahead **143** commits

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
| 2026-02-04 | `1e587c55` | `66fd761a` | Wire compaction context injection (`experimental.session.compacting` + `compaction-context-injector`) and Claude Code PreCompact; align context-window compaction hooks; add hook-name migration for renamed upstream recovery hook; complete Atlas `tool.execute.before` enforcement wiring and harden `tool.execute.after`. |
| 2026-02-05 | `1e587c55` | `66fd761a` | Align tool-layer robustness: restore builtin slashcommand discovery (respecting `disabled_commands`), re-add look-at model-suggestion retry path with fork-compatible agent matching, and restore LSP binary lookup via OpenCode data-dir `bin/` path. |
| 2026-02-05 | `617d7f4f` | `66fd761a` | Sync upstream/dev follow-ups: tolerate mixed provider-models cache formats (string[] vs object[] metadata), port Windows-safe LSP spawning (Node child_process) + open-file didChange behavior, and suppress background-agent parent notification retries when parent session is aborted. |
| 2026-02-06 | `368ac310` | `66fd761a` | Reviewed **all 56 commits** in `617d7f4f..368ac310`; ported fork-safe fixes (`81a2317`, `b7f7cb4`, `b8f15af`, `bc782ca`, `3be722b`, `3c32ae0`, `6b560eb`, `53537a9` partial, `aec5624` adapted to `execution-orchestrator`, `3a0d7e8`, `60bbeb7`, `d8b29da`); applied the model upgrade wave (Opus 4.6 + GPT-5.3-Codex + config migration + `anthropic-effort`); still skipped fork-boundary task-tool migration chain. |

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

### 2026-02-04 Addendum (Compaction Pipeline + Hook Chain Completion)

- `src/index.ts`: Completed `experimental.session.compacting` wiring:
  - Runs Claude Code `PreCompact` hooks (if `output.context` is available) to inject extra compaction context.
  - Runs fork `compaction-context-injector` to enforce structured compaction summaries as a continuity checklist.
  - Uses best-effort provider/model inference from recent assistant messages (fallback to Anthropic defaults) for accurate injection metadata.
- `src/index.ts`: Hardened `tool.execute.after` against undefined output (parity with upstream issue #1035 guard) and aligned ordering: `preemptiveCompaction` runs before `contextWindowMonitor`.
- `src/hooks/compaction-context-injector/*`: Enabled as the single source of truth for compaction guidance (structured summary sections), invoked from `experimental.session.compacting`.
- `src/hooks/context-window-limit-recovery/*`: Confirmed equivalent role to upstream `anthropic-context-window-limit-recovery` with fork naming (`context-window-limit-recovery`), while retaining fork-specific phases (Dynamic Context Pruning + handoff suggestion). Stabilized executor tests via fake timers.
- `src/shared/migration.ts`: Added hook-name migration for upstream configs: `anthropic-context-window-limit-recovery` → `context-window-limit-recovery` (for `disabled_hooks` backward compatibility).
- `src/hooks/context-window-monitor.ts`: Kept fork-accurate context-limit labeling (`200K` vs `1M`) and added OH-MY-OPENCODE system directive prefix (`CONTEXT_WINDOW_MONITOR`) to prevent keyword-detector triggers.
- `src/hooks/preemptive-compaction.ts`: Aligned default compaction threshold with upstream (`0.78`), while preserving fork override via `experimental.preemptive_compaction_threshold`.
- `src/shared/session-utils.ts`: Implemented best-effort agent/orchestrator detection via in-memory session-agent map OR message-storage fallback; added `isCallerAtlas()` helper for durable Atlas detection.
- `src/hooks/atlas/index.ts` + `src/index.ts`: Switched Atlas detection to shared `isCallerAtlas()` (de-duplicated message-dir logic) and wired `atlasHook["tool.execute.before"]` so orchestrator protocol (Write/Edit warnings + single-task directive injection) is enforced preflight.
- `src/hooks/prometheus-md-only/*`: FORK_OVERRIDE. Keep fork checklist/reminder text (no Metis/Momus references) while preserving upstream path-allowlist validation and read-only constraints.
- `src/hooks/delegation-validator/index.ts`: Fork-only (no upstream equivalent). Validates presence of `<delegation-decision>` JSON block before `delegate_task`, injecting warnings for missing/suboptimal decisions.
- `src/hooks/sisyphus-junior-notepad/*`: FORK_OVERRIDE. Only inject notepad context when delegation will spawn Sisyphus-Junior (category-based or explicit `subagent_type="sisyphus-junior"`), reducing noise and token overhead.
- `src/hooks/agent-usage-reminder/constants.ts`: FORK_OVERRIDE. Keep fork-specific `delegate_task(...)` arg examples (required args) to avoid invalid tool calls, otherwise upstream-identical behavior.
- `src/hooks/task-resume-info/index.ts`: FORK_OVERRIDE. Keep fork-specific `delegate_task(...)` continuation example including required args for this fork’s tool schema.
- `src/hooks/think-mode/*`: Synced upstream test coverage for GLM (`zai-coding-plan`) provider support; kept fork compatibility aliases for Gemini `*-preview` model IDs; wired think-mode into `chat.message` (pre keyword-detector) to make the feature effective at runtime.
- `src/hooks/todo-continuation-enforcer.ts` (+ tests): Ported upstream continuation-stop integration (`isContinuationStopped`, `cancelAllCountdowns`, compaction-aware agent resolution). Wired `/stop-continuation` to stop the guard, cancel countdowns, cancel Ralph Loop, and clear `work-state`.
- `src/hooks/auto-update-checker/constants.ts`: Kept fork divergence (drops upstream unused `node:fs` import).
- `src/features/builtin-commands/templates/stop-continuation.ts`: Updated copy to reference `work-state` (not `boulder-state`) to match runtime behavior.

### 2026-02-05 Addendum (Hook Wiring Fixes)

- `src/index.ts`: Preemptive compaction now respects `disabled_hooks` (`preemptive-compaction`) in addition to `experimental.preemptive_compaction`, and `BackgroundManager` now receives `background_task` config at construction time. `createAtlasHook()` now receives the `backgroundManager` instance so Atlas continuation injection correctly suppresses itself while background tasks are running.
- `src/shared/migration.ts` + `src/shared/migration.test.ts`: Stop filtering `preemptive-compaction` from `disabled_hooks` during migration (it is a supported hook in this fork); keep filtering truly removed/no-op hook names; add regression coverage for the upstream hook rename (`anthropic-context-window-limit-recovery` → `context-window-limit-recovery`).

### 2026-02-05 Addendum (Prometheus Prompt Alignment)

- `src/agents/prometheus/behavioral-summary.ts` + `src/agents/prometheus-prompt.test.ts`: Removed stale `boulder-state` wording and now explicitly references fork `work-state` (`.sisyphus/work.yaml`). Added a regression assertion to prevent future reintroduction.
- `src/agents/prometheus/interview-mode.ts`: Ported upstream prompt improvements (TRIVIAL example, richer research prompts, expanded Agent-Executed QA guidance, simplified “Test Strategy Decision” wording) while keeping fork invariants (Phase 0 Brainstorming routing + ONE QUESTION AT A TIME discipline + schema-correct `delegate_task(...)` examples).

### 2026-02-05 Addendum (delegate_task + call_omo_agent Review)

- `src/tools/delegate-task/categories.ts`: Minor upstream parity refactor: always uses `resolveModel(...)` for model resolution (no local normalization helper), preserving the priority chain (user override → category default → system default).
- `src/tools/delegate-task/constants.ts`: Reviewed upstream’s expanded “plan agent prepend” (dependency graph + parallel execution waves + full skills evaluation) and intentionally kept the fork’s lighter protocol (explicit assumptions + minimal back-and-forth + schema-correct tool examples) to match fork multi-plan philosophy and avoid forced interview loops.
- `src/tools/call-omo-agent/constants.ts` + `src/tools/call-omo-agent/tools.ts`: Reviewed upstream’s simplifications and intentionally kept fork behavior:
  - `session_id` is sync-only (background mode rejects it).
  - Background output includes `<task_metadata> session_id: ... </task_metadata>` for `task-resume-info` continuation support.
  - Case-insensitive agent validation remains centralized via shared helpers.

### 2026-02-05 Addendum (Tools + Discovery Robustness)

- `src/tools/slashcommand/tools.ts` + `src/index.ts`: Restored builtin command discovery via `loadBuiltinCommands` (previously missing from `discoverCommandsSync`) and wired config `disabled_commands` into discovery so fork honors command-level disables.
- `src/tools/look-at/tools.ts` + `src/tools/look-at/tools.test.ts`: Ported upstream `promptWithModelSuggestionRetry` for resilient “model suggestion” prompting while keeping fork’s case-insensitive agent matching; rewrote tests to be English-only and expanded coverage for parse/prompt failure paths and model+variant passthrough.
- `src/tools/lsp/config.ts`: Restored upstream LSP binary lookup path that checks OpenCode data-dir `bin/` (e.g. `~/.local/share/opencode/bin`) to reduce “LSP not found” false negatives.
- `src/features/skill-mcp-manager/manager.ts`: Restored upstream cleanup semantics (`pendingConnections`/`authProviders` clearing, stop cleanup timer when idle) while keeping the fork’s explicit SIGINT/SIGTERM/SIGBREAK handler bookkeeping.
- `src/features/background-agent/*`: Kept fork refactor split (`manager`/`spawner`/`result-handler`/`state`) while preserving upstream semantics (non-blocking queue, idle completion, stale interruption, parent notifications). Restored upstream-equivalent ConcurrencyManager assertions and aligned background polling + cleanup retention defaults (3s poll, 10min retention). De-duplicated message-dir resolution via shared `src/shared/session-utils.ts`.
- `src/features/context-injector/*`: Fork-only extensions (context budget + per-source limits + once-per-session injection) validated via tests; upstream base behavior preserved (priority ordering + deterministic merge).
- `src/features/hook-message-injector/*`: Runtime aligned; fork keeps test-only path override helpers (`setOpenCodeStorageDirForTesting`) to prevent writing to real user data during tests.
- `src/features/claude-code-*-loader/*`: Runtime aligned; fork keeps shared utilities (`wrap*Template`, `formatScopedDescription`, `get*Directories`, `to*Record`) for maintainability without changing behavior.
- `src/features/opencode-skill-loader/*`: Fork refactor centralizes parsing (`skill-builder` + `mcp-parser`) while preserving upstream conventions (SKILL.md + `{dir}.md`, frontmatter + `mcp.json` MCP config, allowed-tools parsing, model-source sanitization).
- `src/config/schema.ts`: Re-added `preemptive-compaction` to `HookNameSchema`, restored background concurrency `0 => Infinity` compatibility, aligned compaction-threshold documentation to `0.78`, and kept upstream reasoning-effort compatibility (`xhigh`).

### 2026-02-05 Addendum (Config + Model/Agent Resolution)

- `src/plugin-handlers/config-handler.ts` + `src/plugin-handlers/config-handler.test.ts`: Synced upstream config assembly and hardened edge-cases (core-agent ordering, plan-agent demotion fix, builtin-agent overwrite prevention, MCP merge order). Preserved fork semantics: Prometheus multi-model arrays for multi-plan (first model used for the Prometheus agent), Prometheus model priority `agents.prometheus.model` → category model → fallbackChain → `config.model` (system default, not UI override), and Sisyphus-Junior delegation remains denied (defense-in-depth).
- `src/shared/model-resolver.ts` + `src/shared/model-resolver.test.ts`: Ported upstream wrapper around `resolveModelPipeline` (UI selection + config override + category-default + fallbackChain + optional system default), including the full upstream test suite (availability-based + connected-provider-cache paths).
- `src/shared/agent-tool-restrictions.ts`: Inlined case-insensitive restrictions lookup (drop `findCaseInsensitive` import) to match upstream semantics and reduce dependency surface.
- `src/shared/model-resolution-pipeline.ts`: Kept fork-only result type name (`ModelResolutionPipelineResult`) to avoid barrel export conflicts with `src/shared/model-resolver.ts` (`ModelResolutionResult`).

### 2026-02-05 Addendum (CLI Run Event Stream)

- `src/cli/run/events.ts` + `src/cli/run/types.ts` + `src/cli/run/events.test.ts`: Synced upstream run-event streaming + verbose logging (sessionTag system fallback, tool markers, message.part text preview). Dropped `message.updated` content streaming fallback to avoid duplicate/buggy output; it now only marks `hasReceivedMeaningfulWork` for assistant messages. Ported upstream coverage for `hasReceivedMeaningfulWork` semantics (kept fork BDD `#given/#when/#then` comment style).

### 2026-02-05 Addendum (CLI Install Model Fallback)

- `src/cli/model-fallback.ts` + `src/cli/model-fallback.test.ts` + `src/cli/__snapshots__/model-fallback.test.ts.snap`: Synced upstream model fallback generator to use `src/shared/model-requirements.ts` as the single source of truth (provider availability mapping incl. Kimi; `requiresAnyModel`/`requiresModel` gating; category downgrade `unspecified-high` → `unspecified-low` when not Max plan; explore/sisyphus/hephaestus special cases). Snapshots updated to reflect the fork’s agent set (no Metis/Momus; includes `plan-synthesizer`).

### 2026-02-05 Addendum (CLI Config Manager)

- `src/cli/config-manager.ts` + `src/cli/config-manager.test.ts`: Synced upstream Antigravity provider catalog by removing legacy tier-suffixed Gemini Pro entries (`antigravity-gemini-3-pro-{low,high}`) in favor of variants, and aligned tests to validate variant definitions across Gemini (Pro/Flash) and Claude thinking models.

### 2026-02-05 Addendum (CLI Doctor Parity)

- `src/cli/doctor/checks/dependencies.ts` + `src/cli/doctor/checks/dependencies.test.ts`: Synced upstream AST-Grep NAPI detection to use dynamic import first (bunx temp env compatibility), with fallback checks for common `node_modules/@ast-grep/napi` install paths. Updated `checkDependencyAstGrepNapi()` to await the async check.
- `src/cli/doctor/checks/opencode.ts`: Aligned with upstream (comment-only divergence removed).

### 2026-02-05 Addendum (Builtin Catalog Review)

- `src/features/builtin-skills/skills.ts` + `src/features/builtin-skills/skills/*`: Verified upstream baseline skills are in sync (playwright/agent-browser, frontend-ui-ux, git-master, dev-browser). Fork intentionally adds extra builtin skills (parallel-agents, spec/code review helpers, writing-plans, systematic-debugging, code-simplifier, cartography) and keeps them included in `createBuiltinSkills()`.
- `src/features/builtin-commands/templates/*`: Reviewed upstream parity; fork keeps deliberate overrides:
  - `start-work.ts` / `stop-continuation.ts`: reference fork `work-state` (`.sisyphus/work.yaml`) instead of upstream `boulder-state` (`.sisyphus/boulder.json`).
  - `init-deep.ts`: `delegate_task(...)` examples follow this fork’s required tool args (not upstream shorthand) to prevent invalid calls.
  - `cartography.ts`: fork-only command retained.

---

## 4. Review Coverage Checklist (WIP, Chain-Oriented)

This file used to live at `docs/upstream-sync-notes.md` and was moved to the repo root (commit `8d0cf505`) to avoid duplication and “missing notes” confusion.

Audit metrics (fork vs local upstream clone, excluding `docs/`, `dist/`, `node_modules/`):
- Upstream-only files: **56** (all under `src/`; all in explicitly excluded subsystems per policy)
- Common-but-different files: **136** (breakdown: `src/features` 33, `src/hooks` 28, `src/shared` 22, `src/agents` 21, `src/tools` 14; remainder is config/CLI/root files)
- Fork-only files: **1034** (expected given fork-only subsystems + refactors)

### Hooks — `chat.message` chain (implemented in `src/index.ts`)

- ✅ `src/hooks/think-mode/*`: Aligned; wired into `chat.message` pre keyword-detector injection (fork keeps Gemini `*-preview` aliases for backward compatibility).
- ✅ `src/hooks/keyword-detector/*`: Core detection logic aligned; `ultrawork/*` keeps fork tool-schema-correct `delegate_task(...)` examples.
- ✅ `src/hooks/claude-code-hooks/*`: Aligned.
- ✅ `src/features/session-handoff/*`: Fork-only (kept).
- ✅ `src/hooks/auto-slash-command/*`: Behavior aligned; fork uses `src/shared/command-discovery.ts` abstraction (upstream inlines equivalent logic).
- ✅ `src/hooks/start-work/*`: Fork-owned due to `work-state` (do not merge upstream `boulder-state`).
- ✅ `src/hooks/stop-continuation-guard/*`: Aligned.
- ✅ `src/hooks/ralph-loop/*`: Aligned (note: start/cancel wiring is handled inline inside `src/index.ts`).

### Hooks — `tool.execute.before` chain (implemented in `src/index.ts`)

- ✅ `src/hooks/question-label-truncator/*`: Runtime aligned; fork keeps stricter tests (no `as any` casts).
- ✅ `src/hooks/subagent-question-blocker/*`: Runtime aligned; fork keeps stricter tests (no `as any` casts).
- ✅ `src/hooks/non-interactive-env/*`: Aligned.
- ✅ `src/hooks/comment-checker/*`: Aligned.
- ✅ `src/hooks/directory-agents-injector/*`: Aligned.
- ✅ `src/hooks/directory-readme-injector/*`: Aligned.
- ✅ `src/hooks/rules-injector/*`: Aligned.
- ⚠️ `src/hooks/prometheus-md-only/*`: FORK_OVERRIDE (prompt/checklist text), preserve upstream constraints/validation behavior.
- ⚠️ `src/hooks/sisyphus-junior-notepad/*`: FORK_OVERRIDE (only inject for Sisyphus-Junior executions to reduce noise).
- ⚠️ `src/hooks/atlas/*`: Fork-owned (work-state).

### Hooks — `tool.execute.after` chain (implemented in `src/index.ts`)

- ✅ `src/hooks/tool-output-truncator.ts`: Aligned.
- ⚠️ `src/hooks/preemptive-compaction.ts`: FORK_OVERRIDE (keeps config override + shared context-limit helpers).
- ⚠️ `src/hooks/context-window-monitor.ts`: FORK_OVERRIDE (keeps fork-accurate limit labeling and directive prefix).
- ✅ `src/hooks/empty-task-response-detector.ts`: Aligned.
- ⚠️ `src/hooks/agent-usage-reminder/*`: FORK_OVERRIDE (keep fork-accurate `delegate_task(...)` examples).
- ✅ `src/hooks/category-skill-reminder/*`: Runtime aligned; tests now cover session-agent state (no dependency on `input.agent`).
- ✅ `src/hooks/interactive-bash-session/*`: Aligned.
- ✅ `src/hooks/edit-error-recovery/*`: Aligned.
- ✅ `src/hooks/delegate-task-retry/*`: Aligned.
- ⚠️ `src/hooks/task-resume-info/*`: FORK_OVERRIDE (keep fork-accurate `delegate_task(...)` continuation example).
- ⚠️ `src/hooks/atlas/*`: Fork-owned (work-state).

### Hooks — lifecycle/event chain (implemented in `src/index.ts`)

- ✅ `src/hooks/auto-update-checker/*`: Aligned (fork keeps `constants.ts` clean by dropping upstream unused `node:fs` import).
- ⚠️ `src/hooks/context-window-limit-recovery/*`: FORK_OVERRIDE (renamed from upstream `anthropic-context-window-limit-recovery`). Runtime role is equivalent (auto-recover on token limit), with fork-only extensions (Dynamic Context Pruning + handoff suggestion). `src/shared/migration.ts` provides backward-compatible hook-name migration.
- ✅ `src/hooks/todo-continuation-enforcer.ts` (+ tests): Aligned; supports stop-continuation integration (`isContinuationStopped`, `cancelAllCountdowns`, compaction-aware agent resolution).
- ⛔ Upstream-only hooks intentionally excluded: `src/hooks/task-reminder/`, `src/hooks/unstable-agent-babysitter/` (DROP per fork policy).

### Next diffs to review (not yet fully documented in this file)

- ✅ Prometheus Phase 2/3 plan prompts reviewed: `src/agents/prometheus/plan-generation.ts`, `src/agents/prometheus/high-accuracy-mode.ts`, `src/agents/prometheus/plan-template.ts`, `src/agents/prometheus/identity-constraints.ts`
  - No Metis/Momus reintroduced; multi-plan routing (`multi_plan`) + debate semantics preserved; examples remain schema-correct for this fork.
- ✅ Orchestrator prompts reviewed: `src/agents/atlas/*`
  - All `delegate_task(...)` examples updated to this fork’s required args; no boulder-state language reintroduced.
- ✅ Primary agent prompt reviewed: `src/agents/sisyphus.ts`
  - Delegation decision protocol matches `src/hooks/delegation-validator/`; examples remain schema-correct.
- ✅ Agent registry + prompt builder reviewed: `src/agents/utils.ts`, `src/agents/types.ts`, `src/agents/index.ts`, `src/agents/dynamic-agent-prompt-builder.ts`
  - Fork agent set is consistent (no Metis/Momus; includes `plan-synthesizer`); override schema supports multi-model Prometheus + category/skills/mode.

### 2026-02-05 Addendum (Final Low-Blast Review)

- ✅ `src/agents/sisyphus-junior.test.ts`: Fork-expanded coverage retained (system default model + disable semantics); confirms `call_omo_agent` remains allowed while `task`/`delegate_task` are blocked.
- ✅ `src/agents/utils.test.ts`: Rewrote to be deterministic (spy-based stubbing for model availability + connected provider cache), porting upstream coverage (gating, category expansion, deadlock prevention) while keeping fork-specific assertions (`uiSelectedModel` priority, skill injection, agent-browser gating).
- ✅ `src/agents/AGENTS.md`: Updated to reflect the fork’s agent set and layout (no Metis/Momus; Prometheus is `src/agents/prometheus/*`; includes Sisyphus-Junior + Plan-Synthesizer) and to document model resolution + tool restrictions accurately.
- ✅ `src/hooks/delegation-validator/index.ts`: Hardened `session.messages()` payload handling (`{ data }` vs array) and added regression coverage.
- ✅ `src/hooks/sisyphus-junior-notepad/index.ts`: Now requires `sessionID` + non-empty `prompt` before injecting, preventing accidental mutation of invalid tool calls; keeps the fork’s “inject only for Sisyphus-Junior executions” policy.
- ✅ `src/hooks/atlas/index.ts` + `src/hooks/atlas/index.test.ts`: Fixed background-task detection to match fork `delegate_task` output (`Background task continued`) so Atlas does not transform/append verification reminders for background launches/continuations; added regression tests for undefined `tool.execute.after` output guard and background continuation outputs; `delegate_task` single-task directive is now prepended for stronger enforcement; reminder copy now references the actual `active_plan` path and uses Markdown checkbox syntax (`- [ ]` → `- [x]`) to remove ambiguity (including Manus-style plans).
- ✅ User-facing text cleanup: Removed stale `boulder` wording from builtin command description (`src/features/builtin-commands/commands.ts`) and eliminated ambiguous `delegate_task()` prose in prompts/skills (standardized on `delegate_task(...)` and ensured schema-required args appear where examples are provided).
- ✅ Repo-level diff audit (local upstream clone): Upstream-only files count = **56**, all under `src/` and all in explicitly excluded subsystems (task tool + claude-tasks + boulder-state + tmux-subagent + task-reminder + unstable-agent-babysitter + anthropic recovery hook + metis/momus). No upstream-only files exist outside `src/` (excluding `docs/`, `dist/`, `node_modules/`).
- ✅ Hooks parity audit (upstream hook files excluding intentionally dropped subsystems): **145** considered → **105** byte-identical, **40** fork-overridden (by design), **0** missing.

### 2026-02-05 Addendum (Upstream/dev @ `617d7f4f` — selective port, fork-safe)

- `src/hooks/write-existing-file-guard/*` + `src/config/schema.ts` + `src/hooks/index.ts` + `src/index.ts` + `src/hooks/AGENTS.md`: Ported upstream hook and wired it into `tool.execute.before` (after `subagent-question-blocker`). Blocks accidental writes to existing files via `Write` tool; includes regression tests.
- `src/features/opencode-skill-loader/loader.ts` + `src/features/opencode-skill-loader/skill-builder.ts` + `src/features/opencode-skill-loader/merger.ts` (+ tests): Ported upstream “nested skills” discovery (bounded depth) + cross-scope deduplication with scope priority (`opencode-project > opencode > project > user`). Keeps fork naming conventions (prefixed nested skill names).
- `src/features/opencode-skill-loader/skill-content.ts` + `src/features/builtin-skills/skills.ts` (+ tests): Added end-to-end `disabledSkills` filtering for both builtin and discovered skills; cache bypass to make disabling deterministic.
- `src/tools/delegate-task/*` + `src/index.ts`: Threaded `disabledSkills` into `delegate_task` skill resolution. Fixed model precedence so explicit `categories[category].model` overrides the “Sisyphus Junior model override” configuration; aligned default artistry variant (`max` → `high`) with upstream without changing fork tool schema.
- `src/shared/connected-providers-cache.ts` + `src/shared/model-availability.ts` (+ tests): Hardened provider-models cache parsing to accept both `string[]` and metadata object arrays (e.g. Ollama-style `{ id, context, output }`). Improved `fuzzyMatchModel` with exact model-ID matching and made fallback-availability permissive when providers are connected but model cache is incomplete.
- `src/tools/lsp/client.ts` (+ `src/tools/lsp/client.test.ts`): Ported upstream Windows-safe spawn strategy (Node `child_process`) and added cwd validation to avoid Bun segfaults. Synced `openFile` to emit `didChange`/`didSave` when file content changes on disk.
- `src/features/background-agent/result-handler.ts` (+ `src/features/background-agent/result-handler.test.ts`): Swallowed “aborted session” errors during parent-session lookup/notification, preventing log spam + repeated retries when the parent session has been aborted.

### 2026-02-06 Addendum (Full Commit Ledger: `617d7f4f..368ac310`)

Review guarantee:
- Reviewed commit list via `git log --reverse 617d7f4f..368ac310`.
- Total commits in range: **56**.
- This table is exhaustive (no omissions).

Decision tags:
- `PORTED`: merged as-is or equivalent behavior already in fork.
- `PORTED_PARTIAL`: merged with fork-specific adaptation.
- `SKIPPED_POLICY`: blocked by fork boundary/policy.
- `SKIPPED_SCOPE`: deferred to dedicated model-upgrade/feature window.
- `SKIPPED_DIVERGENCE`: intentional fork divergence or low-value/noise for this fork.
- `SKIPPED_META`: merge/CLA/docs/release-only commit (no runtime merge required).

| Commit | Decision | Rationale |
|--------|----------|-----------|
| `81a2317` | `PORTED` | Doctor now shows user-configured `variant` in model resolution output. |
| `d8137c0` | `SKIPPED_POLICY` | `boulder-state` lifecycle tracking; fork canonical state is `work-state`/`execution-orchestrator`. |
| `169ccb6` | `SKIPPED_POLICY` | Atlas continuation bound to `boulder-state`; fork uses `work-state` continuation semantics. |
| `38b40bc` | `SKIPPED_POLICY` | `prometheus-md-only` boulder-priority logic does not apply to fork state model. |
| `f08d4ec` | `SKIPPED_DIVERGENCE` | Upstream refactor target (`atlas/utils`) does not map cleanly to fork structure; no behavior delta. |
| `02e1043` | `SKIPPED_META` | CLA signature only. |
| `77e99d8` | `SKIPPED_META` | PR merge commit only. |
| `6cfaac9` | `SKIPPED_META` | PR merge commit only. |
| `b2e8eec` | `SKIPPED_META` | PR merge commit only. |
| `b7f7cb4` | `PORTED` | Model-requirements variant normalization for `gemini-3-pro` fallback path. |
| `b3864d6` | `SKIPPED_META` | PR merge commit only. |
| `b8d7723` | `SKIPPED_DIVERGENCE` | Hephaestus autonomy prompt strategy intentionally diverges in fork; mixed commit not split. |
| `f468eff` | `SKIPPED_META` | PR merge commit only. |
| `2224183` | `SKIPPED_DIVERGENCE` | Dead-code deletion conflicts with fork usage (`getModelLimit` still referenced). |
| `11d0005` | `PORTED_PARTIAL` | Model upgrade wave applied in fork runtime (Opus 4.6 priority); fork topology preserved (Plan-Synthesizer, no Metis/Momus). |
| `e450e4f` | `SKIPPED_META` | PR merge commit only. |
| `04576c3` | `SKIPPED_META` | CLA signature only. |
| `b8f15af` | `PORTED` | Hephaestus gating switched to provider-connectivity semantics (not single-model presence). |
| `d3999d7` | `SKIPPED_META` | PR merge commit only. |
| `4c72154` | `PORTED_PARTIAL` | Model upgrade wave applied in fork runtime (`gpt-5.2-codex -> gpt-5.3-codex`) with fork-safe surface-area updates + tests/snapshots. |
| `1f64920` | `PORTED_PARTIAL` | Model upgrade wave applied in fork runtime (`claude-opus-4-5 -> claude-opus-4-6`) while preserving fork-owned agent topology. |
| `25e436a` | `PORTED_PARTIAL` | Think-mode switcher + snapshots updated as part of the model upgrade wave (no duplicate keys; fork test suite adapted). |
| `f63bf52` | `SKIPPED_META` | PR merge commit only. |
| `93d3acc` | `SKIPPED_META` | CLA signature only. |
| `161a864` | `PORTED` | No redundant Opus 4.6 fallback entries remain after the model upgrade wave; upstream dedup not needed as a standalone cherry-pick. |
| `bda44a5` | `SKIPPED_META` | PR merge commit only. |
| `7e5a657` | `PORTED_PARTIAL` | Model-version migration (`MODEL_VERSION_MAP` + `migrateModelVersions`) landed with the runtime upgrade wave and fork-specific config migration wiring + tests. |
| `917bba9` | `SKIPPED_META` | PR merge commit only. |
| `bc782ca` | `PORTED` | Regex special-char escaping fix in tool matcher. |
| `3c32ae0` | `PORTED_PARTIAL` | `disabled_tools` filtering enforced via fork helper (`filterDisabledTools`) + tests. |
| `3166cff` | `SKIPPED_META` | PR merge commit only. |
| `d779a48` | `SKIPPED_META` | PR merge commit only. |
| `3be722b` | `PORTED` | Added literal-match regression assertions for pattern matcher special chars. |
| `ca8ec49` | `SKIPPED_META` | Docs-only AGENTS.md reference cleanup. |
| `6b560eb` | `PORTED_PARTIAL` | Dynamic categories/skills wired for plan-agent prompts with fork prompt-policy retention. |
| `53537a9` | `PORTED_PARTIAL` | Zod/runtime sync adapted to fork: builtin commands parity + schema guard tests. |
| `aec5624` | `PORTED_PARTIAL` | Continuation failure loop guard ported to fork `execution-orchestrator` (not upstream atlas path). |
| `3a0d7e8` | `PORTED` | Sisyphus-Junior no longer inherits UI-selected system model. |
| `9271f82` | `SKIPPED_META` | PR merge commit only. |
| `728eaae` | `SKIPPED_META` | PR merge commit only. |
| `c6c149e` | `SKIPPED_META` | Docs-only AGENTS.md merge commit. |
| `e9a3d57` | `SKIPPED_META` | PR merge commit only. |
| `f1b2f6f` | `SKIPPED_META` | PR merge commit only. |
| `60bbeb7` | `PORTED_PARTIAL` | Compaction model hardcode removal ported to fork compaction pipeline + static regression check. |
| `2b2160b` | `SKIPPED_META` | PR merge commit only. |
| `d8b29da` | `PORTED_PARTIAL` | Category-skill reminder now dynamic; fork-specific reminder wording preserved. |
| `8961026` | `SKIPPED_META` | PR merge commit only. |
| `4692809` | `SKIPPED_META` | AGENTS.md regeneration only. |
| `f1c794e` | `SKIPPED_META` | Release/version bump only (`v3.2.4`). |
| `a691a3a` | `SKIPPED_POLICY` | `delegate_task -> task` migration crosses fork boundary (`sisyphus-tasks`/`work-state` ownership). |
| `d209f3c` | `SKIPPED_META` | PR merge commit only. |
| `98f4adb` | `SKIPPED_DIVERGENCE` | Strict modular-rule injection not adopted (high-noise, incompatible with current fork architecture). |
| `6febebc` | `PORTED_PARTIAL` | `anthropic-effort` hook landed as part of the Opus 4.6 upgrade wave (fork keeps runtime chain order and compatibility). |
| `ec520e6` | `PORTED_PARTIAL` | `anthropic-effort` hook exported/registered in fork (`src/hooks/index.ts`, `src/config/schema.ts`, `src/index.ts`). |
| `cb2169f` | `PORTED_PARTIAL` | `anthropic-effort` hardened for null/undefined model IDs (defensive guard retained). |
| `368ac31` | `SKIPPED_META` | PR merge commit only. |

Net result for this cycle:
- Functional commits in range: **29**
- Ported (full/partial): **21**
- Deferred/skipped by policy/scope/divergence: **8**
- Meta commits (merge/CLA/docs/release): **27**


### 2026-02-06 Addendum (Skipped Commits Re-Validation, One-by-One)

Validation method:
- Re-opened every explicitly skipped functional commit with `git show --name-only`.
- Matched touched paths against fork-owned/deprecated boundaries.
- Confirmed current fork worktree does NOT reintroduce deprecated upstream modules.

Deprecated upstream modules checked (must remain absent in fork):
- `src/features/boulder-state`
- `src/features/claude-tasks`
- `src/tools/task`
- `src/hooks/task-reminder`
- `src/hooks/unstable-agent-babysitter`
- `src/features/tmux-subagent`
- `src/shared/tmux`

Result: all above paths are absent in this fork, and none are introduced by current sync changes.

| Commit | Touched area(s) | Re-validation result |
|--------|------------------|----------------------|
| `d8137c0` | `src/features/boulder-state/*`, `src/hooks/atlas/*`, `src/hooks/start-work/*` | Hard conflict with fork-owned `work-state`; keep skipped. |
| `169ccb6` | `src/hooks/atlas/*` (boulder-agent continuation) | Depends on boulder semantics; keep skipped. |
| `38b40bc` | `src/hooks/prometheus-md-only/*` (boulder-priority) | Fork uses non-boulder source of truth; keep skipped. |
| `f08d4ec` | `src/agents/atlas/utils.ts`, dynamic prompt builder refactor | Upstream file layout differs; no behavior necessity for fork; keep skipped. |
| `b8d7723` | `src/agents/hephaestus.ts` prompt strategy + unrelated test file | Intentional fork prompt-policy divergence; keep skipped. |
| `2224183` | `src/plugin-state.ts`, `src/shared/ollama-ndjson-parser.ts`, `src/types/*.d.ts` deletions | Fork still references/uses these paths; unsafe to import blindly; keep skipped. |
| `a691a3a` | massive `delegate_task -> task` refactor, `src/tools/task/*`, metis/momus files | Violates fork boundary (`sisyphus-tasks`/`work-state`); keep skipped. |
| `98f4adb` | `.sisyphus/rules/modular-code-enforcement.md`, `.gitignore` unignore | Not adopted in fork workflow; high-noise policy injection; keep skipped. |

- Guardrail added in fork: `src/fork-boundary.deprecated-paths.static.test.ts` asserts deprecated upstream subsystem paths remain absent, preventing accidental reintroduction during future syncs.

### 2026-02-06 Addendum (Model Upgrade Chain Deep-Dive, Commit-by-Commit)

Focused chain reviewed one-by-one:
- `11d0005`, `4c72154`, `1f64920`, `25e436a`, `161a864`, `7e5a657`, `6febebc`, `ec520e6`, `cb2169f`

Current fork runtime status (before this wave):
- Still primarily on `claude-opus-4-5` + `gpt-5.2-codex` in:
  - `src/shared/model-requirements.ts`
  - `src/tools/delegate-task/constants.ts`
  - `src/hooks/think-mode/switcher.ts`
  - `src/cli/model-fallback.ts`
  - `src/shared/migration.ts`
- Therefore, this chain is **not safe for isolated cherry-picks**; it must be merged as an atomic migration wave.

| Commit | Decision | Fork-fit rationale |
|--------|----------|--------------------|
| `11d0005` | `ADAPTABLE_DEFERRED` | Introduces Opus 4.6 priority entry. In this fork, if adopted, keep `4-5` as compatibility fallback until provider coverage is confirmed (do not force hard cutover via single commit). |
| `4c72154` | `ADOPT_IN_BATCH` | `gpt-5.2-codex -> gpt-5.3-codex` is valuable for hephaestus/ultrabrain/deep paths, but high blast radius (runtime + tests + docs). Merge only with full test/snapshot update. |
| `1f64920` | `ADAPT_REQUIRED` | Broad `4-5 -> 4-6` replacement; upstream includes metis/momus/atlas-facing churn not directly applicable to this fork. Must port selectively to fork runtime surfaces only. |
| `25e436a` | `FOLLOWUP_IF_ADOPTED` | Fixes duplicate switcher key introduced in prior update. Required only if adopting upstream-style switcher change; otherwise derive equivalent fix in fork switcher map. |
| `161a864` | `ADAPT_REQUIRED` | Removes duplicate 4.6 fallback entries after broad replacement. If fork intentionally keeps dual-entry compatibility (`4-6` then `4-5`), do not apply mechanically. |
| `7e5a657` | `ADOPT_IN_BATCH` | Model string migration (`5.2-codex -> 5.3-codex`, `opus-4-5 -> 4-6`) is high value, but only when runtime defaults/fallbacks are upgraded in the same wave. |
| `6febebc` | `OPTIONAL_AFTER_4_6` | New `anthropic-effort` hook is meaningful after Opus 4.6 adoption. |
| `ec520e6` | `OPTIONAL_AFTER_4_6` | Schema/index registration for `anthropic-effort`; depends on previous hook. |
| `cb2169f` | `REQUIRED_IF_HOOK_ADOPTED` | Null-guard hardening for `anthropic-effort`; mandatory with the hook to avoid runtime edge-case crashes. |

Recommended migration sequence for this fork (model chain only):
1. **Phase A (atomic runtime migration)**  
   Update model IDs in fork-owned runtime surfaces:  
   `src/shared/model-requirements.ts`, `src/tools/delegate-task/constants.ts`, `src/hooks/think-mode/switcher.ts`, `src/cli/model-fallback.ts`, `src/shared/migration.ts`  
   + update corresponding tests/snapshots together.
2. **Phase B (optional optimization)**  
   Add `anthropic-effort` (`6febebc/ec520e6/cb2169f`) only after Phase A is stable.
3. **Phase C (docs-only sync)**  
   Refresh docs/AGENTS references after runtime behavior is confirmed.

Fork boundary reminders for this chain:
- Do **not** reintroduce upstream-only deprecated systems while applying model upgrades (`boulder-state`, `claude-tasks`, `task` tool chain, `tmux-subagent`, etc.).
- Preserve fork agent topology (`plan-synthesizer` instead of metis/momus) when porting tests or prompt text.

### 2026-02-06 Addendum (Model Upgrade Chain Applied in Fork Runtime)

Applied as one migration wave (runtime + tests/snapshots + schema):

- Runtime model defaults/fallbacks upgraded:
  - `claude-opus-4-5 -> claude-opus-4-6`
  - `gpt-5.2-codex -> gpt-5.3-codex`
  - files: `src/shared/model-requirements.ts`, `src/tools/delegate-task/constants.ts`, `src/cli/model-fallback.ts`
- Think-mode high-variant mapping extended for Opus 4.6 while keeping 4.5 compatibility alias:
  - file: `src/hooks/think-mode/switcher.ts`
- Config migration upgraded to auto-migrate legacy model strings in both `agents` and `categories`:
  - file: `src/shared/migration.ts`
- Added optional Opus 4.6 optimization hook `anthropic-effort`:
  - new files: `src/hooks/anthropic-effort/index.ts`, `src/hooks/anthropic-effort/index.test.ts`
  - wired via `src/hooks/index.ts`, `src/config/schema.ts`, `src/index.ts` (`chat.params`)
- Synced schema artifact:
  - `assets/oh-my-opencode.schema.json`
- Updated affected test suites/snapshots to match fork-adapted runtime behavior (including `plan-synthesizer` topology and no deprecated subsystem reintroduction).

### 2026-02-06 Addendum (Commit Coverage Machine Check)

Verification script:
- Extract all commits from upstream range: `git -C ../oh-my-opencode-upstream log --reverse --oneline 617d7f4f..368ac310`
- Extract all short SHAs referenced in this notes file.
- Compute set difference (`upstream_commits - noted_commits`).

Result:
- Upstream commits in range: **56**
- Missing commits in notes: **0**
- Conclusion: full one-by-one coverage is recorded for `617d7f4f..368ac310`.
