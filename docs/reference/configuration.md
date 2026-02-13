# Contract: Configuration

This document is a **normative contract** for configuration surfaces in this repo.

## Normative Language

The keywords **MUST**, **MUST NOT**, **SHOULD**, **SHOULD NOT**, and **MAY** are to be interpreted as described in RFC 2119.

## Scope

This document defines:

- Supported configuration file locations and precedence.
- JSON vs JSONC behavior.
- High-signal configuration keys that affect wiring and behavior.

This document does **not** restate every Zod schema field. The schema is authoritative.

## Source of Truth

- Schema: `src/config/schema.ts`
- Merge semantics: `src/plugin-config.ts`
- Generated JSON schema: `assets/oh-my-opencode.schema.json`

## Top-level Keys (Index)

The top-level configuration object (`OhMyOpenCodeConfigSchema`) supports these keys:

### Meta / wiring

- `config_version`: **Required**. Must equal current runtime version (`1` as of this release).
- `$schema`: Optional JSON schema URL for editor autocomplete.
- `auto_update`: Controls whether `auto-update-checker` performs automatic install or notification-only mode (see [Auto Update](#auto-update)).

### Disable / hide surfaces

- `disabled_agents`: Disable built-in agents (see [Agents](#agents)).
- `disabled_skills`: Disable schema-recognized built-in skills (see [Built-in Skills](#built-in-skills)).
- `disabled_hooks`: Disable built-in hooks (see [Hooks](#hooks) and `docs/reference/hooks.md`).
- `disabled_mcps`: Disable built-in MCP servers only (see [MCPs](#mcps) and `docs/reference/mcps.md`).
- `disabled_commands`: Disable schema-recognized built-in slash commands (see [Disabling Commands](#disabling-commands)).
- `disabled_tools`: Hide tools from the plugin tool registry by exact tool name (see [Disabling Tools](#disabling-tools) and `docs/reference/tools.md`).

### Agents / categories / skills

- `agents`: Built-in agent override block (model/variant/tools/permission/etc).
- `categories`: Category presets for `delegate_task({ category: ... })`.
- `skills`: Skill discovery/merge/enablement configuration (see `docs/reference/skills.md`).
- `default_run_agent`: Default agent name for `bunx oh-my-opencode run` (see [CLI](../guide/cli.md#4-run-message)).
- `claude_code`: Claude Code compatibility toggles (see `docs/guide/features.md` and loaders under `src/features/claude-code-*-loader/`).
- `sisyphus_agent`: Enables/disables Sisyphus orchestration and derived agents (see [Sisyphus Agent](#sisyphus-agent)).

### Orchestration / execution

- `background_task`: Background task concurrency limits (see [Background Tasks](#background-tasks)).
- `parallel_runtime`: Shared global admission control across background and swarm (see [Parallel Runtime](#parallel-runtime)).
- `ralph_loop`: Ralph loop opt-in config for `/ralph-loop` and `/ulw-loop` (see [Ralph Loop](#ralph-loop)).
- `work_orchestrator`: Unified planning + continuation + execution orchestration config (see [Work Orchestrator](#work-orchestrator)).
- `sisyphus`: Sisyphus Tasks & Swarm configuration (see [Sisyphus](#sisyphus)).
- `tmux_parallel_agents`: Auto-create tmux windows/worktrees for background agents (see [Tmux Parallel Agents](#tmux-parallel-agents)).
- `multi_plan_pipeline`: Removed in latest-only mode and rejected by schema.

### Context / memory / governance

- `context_budget`: Shared context injection token budget (see [Context Budget](#context-budget)).
- `context_window_governor`: Token-limit warning/compaction/recovery policy (see [Context Window Governor](#context-window-governor)).
- `cache_strategy`: Cache observability/provider policy/prefix stability/ledger/compiler controls (see [Cache Strategy](#cache-strategy)).
- `session_state_repair`: Session error recovery behavior controls (see [Session State Repair](#session-state-repair)).
- `tool_output_truncator`: Tool output truncation behavior controls (see [Tool Output Truncator](#tool-output-truncator)).
- `silent_tool_output`: Tool output shaping config (requires `silent-tool-output` hook; see `docs/reference/hooks.md`).
- `repo_overview`: Repository overview injection config (requires `repo-overview-injector` hook; see `docs/reference/hooks.md`).
- `runtime_tracker`: Tool runtime tracking config (requires `runtime-tracker` hook; see `docs/reference/hooks.md`).
- `comment_checker`: Comment checker hook config (see [Comment Checker](#comment-checker)).
- `user_memory`: User memory subsystem config (see `docs/reference/user-memory.md`).
- `org_memory`: Org memory subsystem config (see `docs/reference/org-memory.md`).
- `session_handoff`: Session handoff + session reference config (see [Session Handoff](#session-handoff) and `docs/journeys/session-handoff-and-reference.md`).
- `conditional_rules`: Conditional rules injection config (see `docs/journeys/conditional-rules.md`).
- `governance`: Governance module config (see `docs/reference/governance.md` and `docs/journeys/governance.md`).

### UX / notifications

- `notification`: Notification behavior controls (see [Notifications](#notifications)).

### Skills: built-in integrations

- `git_master`: git-master skill configuration (see [Git Master](#git-master)).

### Resilience

- `plugin_load_timeout_ms`: Timeout in ms for loading Claude Code plugins during config handler init (default: 10000, min: 1000).
- `safe_hook_creation`: Wrap hook creation in try/catch to prevent one failing hook from crashing the plugin (default: true).

## Config File Locations

Config file locations (priority order):
1. `.opencode/oh-my-opencode.json` (project)
2. User config (platform-specific):

| Platform        | User Config Path                                                                                            |
| --------------- | ----------------------------------------------------------------------------------------------------------- |
| **Windows**     | `~/.config/opencode/oh-my-opencode.json` (preferred) or `%APPDATA%\opencode\oh-my-opencode.json` (fallback) |
| **macOS/Linux** | `~/.config/opencode/oh-my-opencode.json`                                                                    |

Schema autocomplete supported:

```json
{
  "config_version": 1,
  "$schema": "https://raw.githubusercontent.com/code-yeongyu/oh-my-opencode/master/assets/oh-my-opencode.schema.json"
}
```

## JSONC Support

The `oh-my-opencode` configuration file supports JSONC (JSON with Comments):
- Line comments: `// comment`
- Block comments: `/* comment */`
- Trailing commas: `{ "key": "value", }`

When both `oh-my-opencode.jsonc` and `oh-my-opencode.json` files exist, `.jsonc` takes priority.

**Example with comments:**

```jsonc
{
  "config_version": 1,
  "$schema": "https://raw.githubusercontent.com/code-yeongyu/oh-my-opencode/master/assets/oh-my-opencode.schema.json",

  /* Agent overrides - customize models for specific tasks */
  "agents": {
    "oracle": {
      "model": "openai/gpt-5.2"  // GPT for strategic reasoning
    },
    "explore": {
      "model": "github-copilot/grok-code-fast-1"  // Fast exploration with low cost
    },
  },
}
```

## Disabling Commands

`disabled_commands` disables **built-in** slash commands shipped by this repo (schema: `BuiltinCommandNameSchema` in `src/config/schema.ts`).

Contract:

- Scope: built-in commands only. It MUST NOT be assumed to disable filesystem-discovered commands or skills.
- Validation: values MUST match the built-in command name enum. Invalid values cause config validation to fail for that file.
- Merge: user + project config are merged via **set union** (`src/plugin-config.ts`).

Example:

```json
{
  "disabled_commands": ["refactor", "start-work"]
}
```

## Disabling Tools

`disabled_tools` removes tool definitions from the **plugin tool registry** returned by this plugin (exact name match; case-sensitive). See `src/shared/disabled-tools.ts`.

Contract:

- Scope: plugin-provided tools only. It MUST NOT be assumed to disable OpenCode core tools.
- Matching: exact and case-sensitive (unknown names are ignored).
- Merge: last-write-wins when both user and project config specify `disabled_tools` (`src/plugin-config.ts`).

Example:

```json
{
  "disabled_tools": ["interactive_bash"]
}
```

For the built-in tool name surface shipped by this repo, see `docs/reference/tools.md`.

## Google Auth

**Recommended**: For Google Gemini authentication, install the [`opencode-antigravity-auth`](https://github.com/NoeFabris/opencode-antigravity-auth) plugin. It provides multi-account load balancing, more models (including Claude via Antigravity), and active maintenance. See [Installation > Google Gemini (Antigravity OAuth)](../guide/installation.md#google-gemini-antigravity-oauth).

## Cache Strategy

`cache_strategy` provides cache-first controls without changing default behavior:

- `observability`: cache metrics logging controls.
- `provider_policy`: `off` / `observe` / `enforce` policy with per-provider overrides.
  - `provider_policy.capabilities`: provider capability overrides as data (`supports_cache_policy`, `preferred_option_key`, `option_aliases`) to avoid hardcoded-only mapping.
  - `provider_policy.rollout`: staged enforce rollout (Phase 6) with fixed order:
    `openai -> anthropic -> google -> minimax -> zai -> moonshot`.
  - `provider_policy.rollout.stage` controls how many providers in that fixed order are eligible for enforce.
  - `provider_policy.rollout.require_thresholds=true` requires per-provider threshold gates (`providers.<id>.threshold` + `observed`) before enforce.
  - Fast rollback: set `provider_policy.providers.<id>.mode` to `observe` (provider-level one-click fallback).
- `prefix_stability`: destructive recovery budget and hard-limit bypass guardrail.
- `ledger`: append-only context ledger side writes.
- `compiler`: ledger-first prefix compilation for context injection.

Execution/wiring contract:

- `provider_policy` is applied by the `cache-policy` hook (`chat.params` surface). If `cache-policy` is disabled, provider policy config is inert.
- `prefix_stability` is consumed by `context-window-governor` recovery arbitration. If `context-window-governor` is disabled, prefix stability config is inert.
- `ledger` and `compiler` are integrated through context collection/injection paths and are designed to be rollout-safe (`enabled=false` by default).

### Cache Strategy Defaults

| Key | Default | Description |
|-----|---------|-------------|
| `observability.enabled` | `true` | Enables cache usage probes and related telemetry fields |
| `observability.emit_log` | `true` | Emits structured cache-policy decisions to logger |
| `provider_policy.mode` | `observe` | Global mode: observe-only by default (no request mutation) |
| `provider_policy.inject_when_missing` | `false` | In enforce mode, do not inject unknown provider key by default |
| `provider_policy.rollout.enabled` | `false` | Staged enforce rollout disabled by default |
| `provider_policy.rollout.stage` | `0` | Stage gate: `0=none`, `1=openai` ... `6=moonshot` |
| `provider_policy.rollout.require_thresholds` | `true` | Require per-provider threshold gate when rollout is enabled |
| `prefix_stability.mode` | `off` | No destructive-recovery budget guard by default |
| `prefix_stability.max_destructive_recoveries` | `2` | Max destructive recoveries per sliding window |
| `prefix_stability.window_ms` | `600000` | Sliding window length for destructive recovery budget |
| `prefix_stability.cooldown_ms` | `120000` | Cooldown applied when destructive budget is exhausted |
| `prefix_stability.hard_limit_bypass_ratio` | `1` | Bypass guard when `current/max >= ratio` |
| `ledger.enabled` | `false` | Append-only context ledger side writes disabled by default |
| `compiler.enabled` | `false` | Ledger-first prefix compiler read path disabled by default |
| `compiler.max_prefix_segments` | `64` | Max immutable ledger segments in compiled prefix |
| `compiler.max_prefix_chars` | `32000` | Stable prefix character budget |
| `compiler.separator` | `\\n\\n---\\n\\n` | Segment separator used by compiler output |

### Provider Policy Contract

- Global mode resolution: `provider_policy.mode` + optional `provider_policy.providers.<id>.mode`.
- Per-provider mode values:
  - `inherit`: use global mode.
  - `off`: force disabled for this provider.
  - `observe`: force observe-only for this provider.
  - `enforce`: request enforce for this provider (still subject to capability + rollout gates).
- Capability registry defaults:
  - OpenAI: supported (`prompt_cache` family).
  - Anthropic: supported (`cache` family).
  - Google: supported (`cachedContent` family).
  - Minimax / ZAI / Moonshot: default unsupported until overridden.
- Override capability as data via `provider_policy.capabilities.<id>` using:
  - `supports_cache_policy`
  - `preferred_option_key`
  - `option_aliases`

### Rollout Gate Contract (Enforce Mode)

Enforce mode proceeds only when all applicable checks pass:

1. Provider is within rollout stage fixed order.
2. If `require_thresholds=true`, `rollout.providers.<id>` MUST exist.
3. If `threshold.enabled=true`, observed metrics MUST satisfy threshold constraints:
   - `samples >= min_samples`
   - `cache_hit_ratio >= min_cache_hit_ratio`
   - `error_rate <= max_error_rate`
   - `p95_latency_ms <= max_p95_latency_ms`
4. `approved` MUST NOT be `false` (set `approved=false` for instant provider-level rollback).

If any check fails, enforce is downgraded to observe with reason logging.

### Prefix Stability Modes

- `off`: no destructive-recovery budget guard.
- `balanced`: blocks destructive recovery after budget exhaustion, then allows recovery again after cooldown.
- `strict`: blocks destructive recovery after budget exhaustion for the remainder of the budget window.
- `hard_limit_bypass_ratio` applies to both balanced/strict and allows destructive recovery when hard limit pressure is high enough.

### Minimal Rollout Example

```jsonc
{
  "cache_strategy": {
    "observability": { "enabled": true, "emit_log": true },
    "provider_policy": {
      "mode": "enforce",
      "inject_when_missing": false,
      "rollout": {
        "enabled": true,
        "stage": 2,
        "require_thresholds": true,
        "providers": {
          "openai": {
            "approved": true,
            "threshold": {
              "enabled": true,
              "min_cache_hit_ratio": 0.25,
              "max_error_rate": 0.02,
              "max_p95_latency_ms": 4500,
              "min_samples": 200
            },
            "observed": {
              "cache_hit_ratio": 0.32,
              "error_rate": 0.01,
              "p95_latency_ms": 3800,
              "samples": 260
            }
          },
          "anthropic": {
            "approved": false
          }
        }
      }
    },
    "prefix_stability": {
      "mode": "balanced",
      "max_destructive_recoveries": 2,
      "window_ms": 600000,
      "cooldown_ms": 120000,
      "hard_limit_bypass_ratio": 1
    },
    "ledger": { "enabled": true },
    "compiler": { "enabled": true }
  }
}
```

## Agents

Override built-in agent settings:

```json
{
  "agents": {
    "explore": {
      "model": "anthropic/claude-haiku-4-5",
      "temperature": 0.5
    },
    "multimodal-looker": {
      "disable": true
    }
  }
}
```

Each agent supports: `model`, `variant`, `category`, `skills`, `temperature`, `top_p`, `prompt`, `prompt_append`, `tools`, `permission`, `disable`, `description`, `mode`, `color`.

**Note**: The `agents` override keys are limited to `AgentOverridesSchema` in `src/config/schema.ts` (unknown agent keys are ignored). Some built-in agents (e.g., `hephaestus`) can be disabled via `disabled_agents` but are not currently overrideable via the `agents` block.

Use `prompt_append` to add extra instructions without replacing the default system prompt:

```json
{
  "agents": {
    "librarian": {
      "prompt_append": "Always use the elisp-dev-mcp for Emacs Lisp documentation lookups."
    }
  }
}
```

You can also override settings for `sisyphus` (the main orchestrator) and `build` (the default agent) using the same options.

### Permission Options

Fine-grained control over what agents can do:

```json
{
  "agents": {
    "explore": {
      "permission": {
        "edit": "deny",
        "bash": "ask",
        "webfetch": "allow"
      }
    }
  }
}
```

| Permission           | Description                            | Values                                                                      |
| -------------------- | -------------------------------------- | --------------------------------------------------------------------------- |
| `edit`               | File editing permission                | `ask` / `allow` / `deny`                                                    |
| `bash`               | Bash command execution                 | `ask` / `allow` / `deny` or per-command: `{ "git": "allow", "rm": "deny" }` |
| `webfetch`           | Web request permission                 | `ask` / `allow` / `deny`                                                    |
| `doom_loop`          | Allow infinite loop detection override | `ask` / `allow` / `deny`                                                    |
| `external_directory` | Access files outside project root      | `ask` / `allow` / `deny`                                                    |

Or disable via `disabled_agents` in `~/.config/opencode/oh-my-opencode.json` or `.opencode/oh-my-opencode.json`:

```json
{
  "disabled_agents": ["oracle", "multimodal-looker"]
}
```

Available built-in agents: `sisyphus`, `atlas`, `oracle`, `librarian`, `explore`, `multimodal-looker`, `metis`, `momus`, `hephaestus`

## Built-in Skills

Oh My OpenCode includes built-in skills that provide additional capabilities:

- **playwright**: Browser automation via Playwright MCP. Default browser provider.
- **agent-browser**: Browser automation via agent-browser CLI. Alternate provider (selected only when explicitly configured by an integration point).
- **frontend-ui-ux**: UI/UX execution guidance (designer-turned-developer persona).
- **git-master**: Git expert for atomic commits, rebase/squash, and history search (blame, bisect, log -S).
- **parallel-agents**: Worktree + tmux orchestration for parallel agent workflows (spawn/monitor/rescue/merge/cleanup).
- **dev-browser**: Stateful browser automation (requires separate local server setup).
- **spec-compliance-review**: Strict acceptance-criteria verification with PASS/FAIL verdict and file:line evidence.
- **code-quality-review**: Post-spec code quality review (type safety, error handling, tests, maintainability, safety risks).
- **writing-plans**: Structured implementation planning with dependencies, risks, and verification steps.
- **systematic-debugging**: Hypothesis-driven debugging workflow (experiments, minimal fixes, verification).
- **code-simplifier**: Behavior-preserving simplification pass to reduce complexity and improve readability.

Disable schema-recognized built-in skills via `disabled_skills` in `~/.config/opencode/oh-my-opencode.json` or `.opencode/oh-my-opencode.json`:

```json
{
  "disabled_skills": ["playwright"]
}
```

You can also disable any skill (including built-ins) via the `skills` map:

```jsonc
{
  "skills": {
    "parallel-agents": false,
    "dev-browser": false
  }
}
```

Available built-in skills include: `playwright` (or `agent-browser` when explicitly selected), `frontend-ui-ux`, `git-master`, `parallel-agents`, `dev-browser`, `spec-compliance-review`, `code-quality-review`, `writing-plans`, `systematic-debugging`, `code-simplifier`.

## Git Master

Configure git-master skill behavior:

```json
{
  "git_master": {
    "commit_footer": true,
    "include_co_authored_by": true
  }
}
```

| Option                   | Default | Description                                                                      |
| ------------------------ | ------- | -------------------------------------------------------------------------------- |
| `commit_footer`          | `true`  | `true` adds the default footer, `false` disables it, or a **string** sets custom footer text. |
| `include_co_authored_by` | `true`  | Adds `Co-authored-by: Sisyphus <clio-agent@sisyphuslabs.ai>` trailer to commits. |

Custom footer example:

```json
{
  "git_master": {
    "commit_footer": "Reviewed and signed by DevOps",
    "include_co_authored_by": false
  }
}
```

## Sisyphus Agent

When enabled (default), Sisyphus provides a powerful orchestrator with optional specialized agents:

- **Sisyphus**: Primary orchestrator agent (Claude Opus 4.6)
- **OpenCode-Builder**: OpenCode's default build agent, renamed due to SDK limitations (disabled by default)
- **Prometheus**: OpenCode's default plan agent with work-planner methodology (enabled by default)
- **Metis**: Pre-planning consultant that analyzes requests for hidden intentions, ambiguities, and AI failure points
- **Momus**: Plan reviewer that verifies plan executability and catches blocking issues
- **Sisyphus-Junior**: Focused executor; cannot delegate implementation

**Configuration Options:**

```jsonc
{
  "sisyphus_agent": {
    "disabled": false,
    "default_builder_enabled": false,
    "planner_enabled": true,
    "replace_plan": true
  }
}
```

**Example: Enable OpenCode-Builder:**

```jsonc
{
  "sisyphus_agent": {
    "default_builder_enabled": true
  }
}
```

This enables OpenCode-Builder agent alongside Sisyphus. The default build agent is always demoted to subagent mode when Sisyphus is enabled.

**Example: Disable all Sisyphus orchestration:**

```jsonc
{
  "sisyphus_agent": {
    "disabled": true
  }
}
```

You can also customize Sisyphus agents like other agents:

```jsonc
{
  "agents": {
    "sisyphus": {
      "model": "anthropic/claude-sonnet-4",
      "temperature": 0.3
    },
    "OpenCode-Builder": {
      "model": "anthropic/claude-opus-4"
    },
    "prometheus": {
      "model": "openai/gpt-5.2"
    },
    "metis": {
      "model": "anthropic/claude-opus-4-6"
    },
    "momus": {
      "model": "openai/gpt-5.2"
    },
    "sisyphus-junior": {
      "model": "anthropic/claude-sonnet-4-5"
    }
  }
}
```

| Option                    | Default | Description                                                                                                                            |
| ------------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `disabled`                | `false` | When `true`, disables all Sisyphus orchestration and restores original build/plan as primary.                                          |
| `default_builder_enabled` | `false` | When `true`, enables OpenCode-Builder agent (same as OpenCode build, renamed due to SDK limitations). Disabled by default.             |
| `planner_enabled`         | `true`  | When `true`, enables Prometheus agent with work-planner methodology. Enabled by default.                                               |
| `replace_plan`            | `true`  | When `true`, demotes default plan agent to subagent mode. Set to `false` to keep both Prometheus and default plan available.          |

## Background Tasks

Configure concurrency limits for background agent tasks. This controls how many parallel background agents can run simultaneously.

```json
{
  "background_task": {
    "defaultConcurrency": 5,
    "providerConcurrency": {
      "anthropic": 3,
      "openai": 5,
      "google": 10
    },
    "modelConcurrency": {
      "anthropic/claude-opus-4-6": 2,
      "google/gemini-3-flash": 10
    }
  }
}
```

| Option                | Default | Description                                                                                                             |
| --------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------- |
| `defaultConcurrency`  | -       | Default maximum concurrent background tasks for all providers/models                                                    |
| `providerConcurrency` | -       | Per-provider concurrency limits. Keys are provider names (e.g., `anthropic`, `openai`, `google`)                        |
| `modelConcurrency`    | -       | Per-model concurrency limits. Keys are full model names (e.g., `anthropic/claude-opus-4-6`). Overrides provider limits. |

**Priority Order**: `modelConcurrency` > `providerConcurrency` > `defaultConcurrency`

**Use Cases**:
- Limit expensive models (e.g., Opus) to prevent cost spikes
- Allow more concurrent tasks for fast/cheap models (e.g., Gemini Flash)
- Respect provider rate limits by setting provider-level caps

## Parallel Runtime

Configure global concurrency admission shared by Background and Swarm execution paths.

```json
{
  "parallel_runtime": {
    "enabled": true,
    "mode": "shadow",
    "global_slots": 6,
    "lease_ttl_ms": 120000,
    "heartbeat_ms": 10000,
    "acquire_timeout_ms": 15000,
    "lock_timeout_ms": 2000
  }
}
```

| Option | Default | Description |
| --- | --- | --- |
| `enabled` | `true` | Enable shared runtime admission control and slot tracking |
| `mode` | `shadow` | `shadow`: observe and log pressure without blocking, `enforce`: hard cap |
| `global_slots` | `6` | Global slot budget shared across subsystems |
| `lease_ttl_ms` | `120000` | Lease expiry window used for crash/stale recovery |
| `heartbeat_ms` | `10000` | Recommended renewal cadence for long-running runs |
| `acquire_timeout_ms` | `15000` | Max wait for slot acquisition in enforce mode |
| `lock_timeout_ms` | `2000` | Timeout for runtime state lock acquisition |

**Effective behavior**:
- `background_task` local limits still apply.
- Global admission is evaluated in addition to local limits (both must pass in enforce mode).
- `acquire_timeout_ms` applies to blocking admissions (Background); Swarm admission is non-blocking in `enforce` and simply stops new assignments when at capacity.

## Work Orchestrator

`work_orchestrator` is the unified control plane for planning + continuation arbitration + execution.

- Configuration key: `work_orchestrator` (schema: `WorkOrchestratorConfigSchema` in `src/config/schema.ts`)
- Wiring entrypoint: `src/hooks/work-orchestrator/index.ts`
- Runtime integration: `src/index.ts` (deep-merged with defaults)

### Continuation Arbitration (`work_orchestrator.continuation_control`)

Continuation arbitration is a single-writer mechanism for continuation prompts around `session.idle`.

- Implementation: `src/hooks/work-orchestrator/continuation.ts`
- Contract:
  - For a given idle round, at most one continuation prompt SHOULD be emitted.
  - If multiple sources report intents for the same round, the arbiter MUST select the highest priority and reject others with `lower_priority`.
  - When the session was compacted recently, intents MUST be rejected during `post_compaction_grace_ms`.

Configuration example:

```jsonc
{
  "work_orchestrator": {
    "continuation_control": {
      "post_compaction_grace_ms": 1500,
      "priority": {
        "work-orchestrator": 400,
        "ralph-loop": 300,
        "task-auto-continuation": 200,
        "unstable-agent-watchdog": 50
      }
    }
  }
}
```

Sources (current implementation):

- `work-orchestrator`
- `ralph-loop`
- `task-auto-continuation`
- `unstable-agent-watchdog`

## Ralph Loop

`ralph_loop` configures the `ralph-loop` hook and the `/ralph-loop` and `/ulw-loop` workflows.

- Hook implementation: `src/hooks/ralph-loop/`
- Schema: `RalphLoopConfigSchema` in `src/config/schema.ts`
- State file (default): `.sisyphus/ralph-loop.local.md`

Enablement contract:

- The `ralph-loop` hook MUST be enabled (not present in `disabled_hooks`), and
- `ralph_loop.enabled` MUST be `true`.

Notes:

- `ralph_loop.default_max_iterations` sets the default max iteration count when the command does not pass `--max-iterations=...`.
- `ralph_loop.state_dir` is treated as a **state file path** relative to project root in the current implementation (despite the name). If set, it overrides the default state file location.

Example:

```json
{
  "ralph_loop": {
    "enabled": true,
    "default_max_iterations": 100
  }
}
```

## Planning with Files

`work_orchestrator.planning_with_files` enables the persistent, file-backed planning protocol under `.sisyphus/`. For the end-to-end lifecycle and prompts, see `docs/journeys/planning-with-files.md`.

Enablement contract:

- The `work-orchestrator` hook MUST be enabled (not present in `disabled_hooks`), and
- `work_orchestrator.planning_with_files.enabled` MUST be `true`.

Artifacts (canonical layout):

- `.sisyphus/work.yaml`: single active plan + protocol state
- `.sisyphus/plans/<plan_id>/plan.md`
- `.sisyphus/plans/<plan_id>/ledger.yaml`
- `.sisyphus/plans/<plan_id>/findings.md`
- `.sisyphus/plans/<plan_id>/progress.md`

Directory note:

- `work_orchestrator.planning_with_files.directory` is **deprecated and ignored** in the current implementation; the directory is fixed to `.sisyphus/plans` (`src/hooks/work-orchestrator/planning.ts`, `src/features/planning-with-files/types.ts`).

Minimal config:

```jsonc
{
  "work_orchestrator": {
    "planning_with_files": {
      "enabled": true
    }
  }
}
```

`work_orchestrator.planning_with_files.bdd_alignment` controls task-to-scenario alignment checks:

- `off`: disable checks.
- `warn` (default): inject warning context when tasks miss `Scenario Ref`.
- `required`: block non-plan tool execution until missing `Scenario Ref` values are fixed.

## Tmux Parallel Agents

`tmux_parallel_agents` configures tmux/worktree orchestration for background tasks and Swarm.

- Hook: `tmux-parallel-agents` (`src/hooks/tmux-parallel-agents/`)
- Schema: `TmuxParallelAgentsConfigSchema` in `src/config/schema.ts`
- See journeys:
  - `docs/journeys/parallel-agents.md`
  - `docs/journeys/swarm-coordination.md`

Enablement contract:

- The `tmux-parallel-agents` hook MUST be enabled (not present in `disabled_hooks`), and
- `tmux_parallel_agents.enabled` MUST be `true`.

Runtime behavior notes (aligned with the current implementation):

- After window creation, lifecycle operations use stable tmux identifiers (`window_id` / `pane_id`) instead of relying only on window index, reducing mis-targeting when `renumber-windows` is enabled.
- The hook persists window metadata: `@workmux_status`, `@omo_task_id`, `@omo_session_id`, `@omo_branch` (and optional `@omo_worktree`) for status updates and recovery.
- In `delegate_task(run_in_background=true)`, an internal correlation key `__tmux_task_id` is injected. `BackgroundManager` persists this key and returns it on `session.created` for precise tmux mapping.
- If precise mapping is unavailable, the hook falls back to parent-session queue + title matching + FIFO for backward compatibility.
- On `session.deleted`, if the in-memory mapping is missing, orphan windows are scanned and recovered by `@omo_session_id` (best effort).
- On plugin shutdown, `BackgroundManager.onShutdown` triggers tmux hook `cleanup()` to converge remaining windows and pending state.

Example:

```jsonc
{
  "tmux_parallel_agents": {
    "enabled": true,
    "layout": "main-vertical",
    "auto_rescue": false,
    "worktree": {
      "enabled": false
    }
  }
}
```

## Sisyphus

The `sisyphus` block configures **Sisyphus Tasks** and **Sisyphus Swarm** subsystems.
This is separate from `sisyphus_agent` (which controls whether Sisyphus replaces OpenCode build/plan slots).

Schema: `SisyphusConfigSchema` in `src/config/schema.ts`.

### Tasks

- `sisyphus.tasks.enabled` (default: `false`): Enables TaskGraph V2.
- `sisyphus.tasks.storage_path` (default: `.sisyphus/tasks`): Root storage directory. Runtime layout is `<root>/<scope>/<container_id>/task_*.json`.

### Swarm

- `sisyphus.swarm.enabled` (default: `false`): Enables Swarm.
- `sisyphus.swarm.storage_path` (default: `.sisyphus/teams`): Storage directory.
- `sisyphus.swarm.ui_mode` (default: `toast`): `toast` / `tmux` / `both`
- `sisyphus.swarm.swarm_first` (default: `false`): Auto-start Swarm from `/start-work`.
- `sisyphus.swarm.worker_count` (default: `3`): Target worker count when Swarm-first is enabled.
- `sisyphus.swarm.watch_fallback_poll_ms` (default: `5000`): Low-frequency polling fallback period for watch mode.
- `sisyphus.swarm.enforce_sender_validation` (default: `true`): Reject privileged controls from invalid senders.
- `sisyphus.swarm.enforce_signature` (default: `true`): Require Ed25519 signature verification for privileged controls.
- `sisyphus.swarm.coordinator_lease_ttl_ms` (default: `15000`): Lease TTL for coordinator ownership.
- `sisyphus.swarm.coordinator_lease_renew_ms` (default: `5000`): Coordinator lease renewal cadence.
- `sisyphus.swarm.auto_rescue_policy` (default: `disabled`): Prompt auto-confirm policy (`disabled | allowlist`).
- `sisyphus.swarm.auto_rescue_allowlist` (default: `[]`): Regex patterns allowed for auto-confirm when policy is `allowlist`.

Swarm mailbox semantics are latest-only queue directories (`pending/processing/done`). Legacy mailbox read-state toggling paths are not supported.

## Categories

Categories enable domain-specific task delegation via the `delegate_task` tool. Each category applies runtime presets (model, temperature, prompt additions) when calling the `sisyphus-junior` agent.

**Built-in Categories (defaults):**

| Category | Model | Description |
|---|---|---|
| `visual-engineering` | `google/gemini-3-pro` | Frontend, UI/UX, design, styling, animation |
| `ultrabrain` | `openai/gpt-5.3-codex` (xhigh) | Deep logical reasoning and complex architecture |
| `deep` | `openai/gpt-5.3-codex` (medium) | Goal-oriented autonomous problem-solving |
| `artistry` | `google/gemini-3-pro` (high) | Highly creative/artistic tasks |
| `quick` | `anthropic/claude-haiku-4-5` | Trivial tasks (small changes) |
| `unspecified-low` | `anthropic/claude-sonnet-4-5` | Moderate-effort tasks that don't fit other categories |
| `unspecified-high` | `anthropic/claude-opus-4-6` (max) | High-effort tasks that don't fit other categories |
| `writing` | `google/gemini-3-flash` | Documentation, prose, technical writing |

**Usage:**

```typescript
// Via delegate_task tool
delegate_task({
  category: "visual-engineering",
  load_skills: ["frontend-ui-ux"],
  description: "dashboard UI",
  prompt: "Create a responsive dashboard component",
  run_in_background: false,
})

// Or target a specific agent directly
delegate_task({
  subagent_type: "oracle",
  load_skills: [],
  description: "architecture review",
  prompt: "Review this architecture",
  run_in_background: false,
})
```

**Custom Categories:**

Add custom categories in `oh-my-opencode.json`:

```json
{
  "categories": {
    "data-science": {
      "model": "anthropic/claude-sonnet-4-5",
      "temperature": 0.2,
      "prompt_append": "Focus on data analysis, ML pipelines, and statistical methods."
    },
    "visual": {
      "model": "google/gemini-3-pro-preview",
      "prompt_append": "Use shadcn/ui components and Tailwind CSS."
    }
  }
}
```

Each category supports: `model`, `variant`, `temperature`, `top_p`, `maxTokens`, `thinking`, `reasoningEffort`, `textVerbosity`, `tools`, `prompt_append`, `is_unstable_agent`, `description`, `disable`.

`disable: true` removes the category from delegation-facing category surfaces and prevents routing by that category name.

Example (disable a built-in category):

```json
{
  "categories": {
    "quick": {
      "disable": true
    }
  }
}
```

## Model Selection System

Model selection has two layers:

1. **Installer bootstrap** (`src/cli/model-fallback.ts`): writes initial `agents` / `categories` model defaults into `oh-my-opencode.json`.
2. **Runtime resolution** (`src/shared/model-requirements.ts`, `src/shared/model-resolution-pipeline.ts`): resolves final model by availability + fallback chain at runtime.

### Runtime Fallback Chains (source of truth)

#### Agent chains

| Agent | Runtime fallback chain |
|---|---|
| `sisyphus` | `anthropic/github-copilot/opencode:claude-opus-4-6(max)` → `kimi-for-coding:k2p5` → `opencode:kimi-k2.5-free` → `zai-coding-plan:glm-4.7` → `opencode:glm-4.7-free` |
| `atlas` | `anthropic/github-copilot/opencode:claude-opus-4-6(max)` → `openai/github-copilot/opencode:gpt-5.2(high)` → `google/github-copilot/opencode:gemini-3-pro(high)` |
| `hephaestus` | `openai/github-copilot/opencode:gpt-5.3-codex(medium)` |
| `oracle` | `openai/github-copilot/opencode:gpt-5.2(high)` → `google/github-copilot/opencode:gemini-3-pro(high)` → `anthropic/github-copilot/opencode:claude-opus-4-6(max)` |
| `librarian` | `zai-coding-plan:glm-4.7` → `opencode:glm-4.7-free` → `anthropic/github-copilot/opencode:claude-sonnet-4-5` |
| `explore` | `github-copilot:grok-code-fast-1` → `anthropic/opencode:claude-haiku-4-5` → `opencode:gpt-5-nano` |
| `multimodal-looker` | `google/github-copilot/opencode:gemini-3-flash` → `openai/github-copilot/opencode:gpt-5.2` → `zai-coding-plan:glm-4.6v` → `kimi-for-coding:k2p5` → `opencode:kimi-k2.5-free` → `anthropic/github-copilot/opencode:claude-haiku-4-5` → `opencode:gpt-5-nano` |
| `prometheus` | `anthropic/github-copilot/opencode:claude-opus-4-6(max)` → `kimi-for-coding:k2p5` → `opencode:kimi-k2.5-free` → `openai/github-copilot/opencode:gpt-5.2(high)` → `google/github-copilot/opencode:gemini-3-pro` |
| `metis` | `anthropic/github-copilot/opencode:claude-opus-4-6(max)` → `kimi-for-coding:k2p5` → `opencode:kimi-k2.5-free` → `openai/github-copilot/opencode:gpt-5.2(high)` → `google/github-copilot/opencode:gemini-3-pro(high)` |
| `momus` | `openai/github-copilot/opencode:gpt-5.2(medium)` → `anthropic/github-copilot/opencode:claude-opus-4-6(max)` → `google/github-copilot/opencode:gemini-3-pro(high)` |

Runtime constraints:
- `sisyphus` has `requiresAnyModel=true`, so if none of its chain providers/models are available it is not materialized.
- `atlas` has `requiresAnyModel=true`, so if none of its chain providers/models are available it is not materialized.
- `hephaestus` requires provider connectivity: `openai` or `github-copilot` or `opencode`.

#### Category chains

| Category | Runtime fallback chain |
|---|---|
| `visual-engineering` | `google/github-copilot/opencode:gemini-3-pro` → `anthropic/github-copilot/opencode:claude-opus-4-6(max)` → `zai-coding-plan:glm-4.7` |
| `ultrabrain` | `openai/github-copilot/opencode:gpt-5.3-codex(xhigh)` → `google/github-copilot/opencode:gemini-3-pro(high)` → `anthropic/github-copilot/opencode:claude-opus-4-6(max)` |
| `deep` | `openai/github-copilot/opencode:gpt-5.3-codex(medium)` → `anthropic/github-copilot/opencode:claude-opus-4-6(max)` → `google/github-copilot/opencode:gemini-3-pro(high)` |
| `artistry` | `google/github-copilot/opencode:gemini-3-pro(high)` → `anthropic/github-copilot/opencode:claude-opus-4-6(max)` → `openai/github-copilot/opencode:gpt-5.2` |
| `quick` | `anthropic/github-copilot/opencode:claude-haiku-4-5` → `google/github-copilot/opencode:gemini-3-flash` → `opencode:gpt-5-nano` |
| `unspecified-low` | `anthropic/github-copilot/opencode:claude-sonnet-4-5` → `openai/github-copilot/opencode:gpt-5.3-codex(medium)` → `google/github-copilot/opencode:gemini-3-flash` |
| `unspecified-high` | `anthropic/github-copilot/opencode:claude-opus-4-6(max)` → `openai/github-copilot/opencode:gpt-5.2(high)` → `google/github-copilot/opencode:gemini-3-pro` |
| `writing` | `google/github-copilot/opencode:gemini-3-flash` → `anthropic/github-copilot/opencode:claude-sonnet-4-5` → `zai-coding-plan:glm-4.7` → `openai/github-copilot/opencode:gpt-5.2` |

Runtime constraints:
- `deep` requires `gpt-5.3-codex` availability.
- `artistry` requires `gemini-3-pro` availability.

### Installer Bootstrap Behavior

`bunx oh-my-opencode install` uses `generateModelConfig(...)` to prefill config from subscription flags.

Important details:
- If no providers are selected, installer writes `opencode/glm-4.7-free` for agents/categories as ultimate fallback.
- `sisyphus` is omitted when none of its fallback-chain providers are available (for example OpenAI-only).
- `explore` has installer-specific shortcuts:
  - Claude available: `anthropic/claude-haiku-4-5`
  - Else OpenCode Zen: `opencode/claude-haiku-4-5`
  - Else Copilot: `github-copilot/gpt-5-mini`
  - Else: `opencode/gpt-5-nano`
- `librarian` is pinned to `zai-coding-plan/glm-4.7` when Z.ai is available.

### `isMax20` Impact (current implementation)

In installer bootstrap logic, `isMax20` affects category downgrade behavior:
- `isMax20=true`: keep `unspecified-high` chain.
- `isMax20=false`: `unspecified-high` category uses `unspecified-low` chain during generation.

The runtime fallback chain definitions themselves are in `src/shared/model-requirements.ts`.

### Manual Override

You can always override automatic selection in `oh-my-opencode.json`:

```json
{
  "agents": {
    "sisyphus": {
      "model": "anthropic/claude-sonnet-4-5"  // Force specific model
    },
    "oracle": {
      "model": "openai/o3"  // Use different model
    }
  },
  "categories": {
    "visual-engineering": {
      "model": "anthropic/claude-opus-4-6"  // Override category default
    }
  }
}
```

## Context Budget

All model-visible context injection/append hooks share a unified token budget governed by a single `ContextBudgetArbiter` singleton (`src/features/context-budget/`). This prevents any one hook from starving others.

```json
{
  "context_budget": {
    "total_budget": 2000,
    "reserved_budget": 400,
    "overflow_strategy": "drop-low-priority",
    "source_limits": {
      "codemap-injector": 600,
      "rules-injector": 500
    },
    "channel_limits": {
      "tool-output": 1200,
      "synthetic-message": 400
    }
  }
}
```

| Key | Default | Description |
|-----|---------|-------------|
| `total_budget` | `2000` | Total tokens per turn across all injection sources |
| `reserved_budget` | `400` | Tokens reserved for `critical`/`high` priority injections. Normal/low priority sources can only use `total_budget - reserved_budget`. |
| `overflow_strategy` | `"drop-low-priority"` | `"drop-low-priority"` drops normal/low entries that exceed budget; `"truncate"` truncates content to fit |
| `source_limits` | — | Per-source token caps (e.g., `"codemap-injector": 600`) |
| `channel_limits` | — | Per-channel token caps. Channels: `messages-transform`, `tool-output`, `chat-message`, `delegate-prompt`, `synthetic-message`, `session-prompt` |

**Injection channels** route through the arbiter via three paths:

1. **`ContextCollector.register()`** → `arbiter.decide()` — used by `work-orchestrator(planning)`, `claude-code-hooks`
2. **`appendBudgetedOutput()` / `pushBudgetedContext()` / `injectBudgetedPrompt()`** — used by tool-output guidance/instruction hooks, compaction-context writers, and delegate-prompt injectors such as `anti-slop-enforcer`, `comment-checker`, `runtime-tracker`, `edit/delegation failure guidance`, `context-window-governor`, `task-resume-info`, `work-orchestrator(execution)`, `prometheus-md-only`, `sisyphus-junior-notepad`, `claude-code-hooks(PreCompact)`
3. **Direct `arbiter.decide()`** — used by hooks with custom composition flows such as `rules-injector`, `directory-agents/readme`, `repo-overview`, `codemap-injector`, `keyword-detector`, `context-manifest-injector`, `conditional-rules`, `hook-message-injector`, `delegation-nudge-category-skill`

Budget counters reset at the start of each user turn via `beginTurn()`.

## Hooks

Disable specific built-in hooks via `disabled_hooks` in `~/.config/opencode/oh-my-opencode.json` or `.opencode/oh-my-opencode.json`:

```json
{
  "disabled_hooks": ["comment-checker", "delegation-nudge-agent-usage"]
}
```

Hook names MUST come from `HookNameSchema` in `src/config/schema.ts`. For full hook surface and runtime ordering, see `docs/reference/hooks.md`.

**Note on `claude-code-hooks` enablement**:

- `disabled_hooks` supports `"claude-code-hooks"`.
- `claude_code.hooks=false` is treated as a compatibility alias that disables the same bridge.
- If both are set and conflict, **disabled wins**.

**Note on `directory-agents-injector`**: This hook is **automatically disabled** when running on OpenCode 1.1.37+ because OpenCode now has native support for dynamically resolving AGENTS.md files from subdirectories (PR #10678). This prevents duplicate AGENTS.md injection. For older OpenCode versions, the hook remains active to provide the same functionality.

**Note on `context-window-governor`**: This hook is wired in `src/index.ts` under the `experimental.session.compacting` lifecycle surface. When OpenCode emits that event during compaction, the plugin can run Claude Code compat `PreCompact` hooks and/or inject extra compaction-time context via `context-window-governor` (best-effort; depends on runtime support and hook enablement).

**Note on `auto-update-checker` and `startup-toast`**: The `startup-toast` hook is a sub-feature of `auto-update-checker`. To disable only the startup toast notification while keeping update checking enabled, add `"startup-toast"` to `disabled_hooks`. To disable all update checking features (including the toast), add `"auto-update-checker"` to `disabled_hooks`.

## Comment Checker

`comment_checker` configures the `comment-checker` hook.

- Hook implementation: `src/hooks/comment-checker/`
- Schema: `CommentCheckerConfigSchema` in `src/config/schema.ts`

Behavior (current implementation):

- When `comment-checker` is enabled and the comment-checker CLI is available, it MAY append a warning message to `Write` / `Edit` / `MultiEdit` tool output when source comments are detected.
- If the CLI is unavailable, the hook SHOULD fail open (silently skip comment checking).

### `comment_checker.custom_prompt`

- When set, replaces the default warning message.
- Use `{{comments}}` as a placeholder for the detected comments XML payload.

Example:

```jsonc
{
  "comment_checker": {
    "custom_prompt": "Comments are not allowed in this repo. Remove them before continuing.\n\n{{comments}}"
  }
}
```

## Auto Update

`auto_update` controls whether the `auto-update-checker` hook performs automatic install or notification-only behavior.

- Hook implementation: `src/hooks/auto-update-checker/`
- Wiring: `src/index.ts` passes `autoUpdate: pluginConfig.auto_update ?? true`

Contract:

- When `auto-update-checker` is enabled and `auto_update=true` (default), the plugin MAY update the pinned plugin version and run `bun install` (best-effort).
- When `auto-update-checker` is enabled and `auto_update=false`, the plugin MUST NOT attempt to install updates automatically (toast/notification only).
- Disabling the `auto-update-checker` hook via `disabled_hooks` MUST disable all update-check behavior regardless of `auto_update`.

Example (notification-only mode):

```json
{
  "auto_update": false
}
```

## Notifications

`notification` configures runtime behavior for the `session-notification` hook.

- Hook implementation: `src/hooks/session-notification.ts`
- Schema: `NotificationConfigSchema` in `src/config/schema.ts`

### `notification.force_enable`

This repo detects external notification plugins and disables `session-notification` by default to avoid double-notifications.

- When `true`, forces `session-notification` to run even if an external notifier is detected.
- When `false`/unset (default), `session-notification` is skipped when a conflict is detected.

Example:

```json
{
  "notification": {
    "force_enable": true
  }
}
```

## Context Window Governor

`context-window-governor` is the single source of truth for context window warnings, preemptive compaction, hard-limit recovery, and compaction-time context injection (best-effort via `experimental.session.compacting`).

Recovery chain (current implementation):

1. Optional dynamic pruning (`dynamic_pruning`) to remove duplicate/stale historical tool outputs.
2. Optional aggressive output truncation (`recovery.aggressive_output_truncation`) to trim large tool outputs toward a target ratio.
3. Fallback summarize (`session.summarize(auto=true)`) with bounded retries/backoff.

Configure it via the top-level `context_window_governor` block:

```jsonc
{
  "context_window_governor": {
    "warning_ratio": 0.7,
    "preemptive_ratio": 0.78,
    "limit_ratio": 1.0,
    "warning_reset_ratio": 0.65,
    "preemptive_reset_ratio": 0.73,
    "recovery": {
      "max_attempts": 2,
      "initial_delay_ms": 2000,
      "max_delay_ms": 30000,
      "toast_cooldown_ms": 30000,
      "aggressive_output_truncation": {
        "enabled": true,
        "target_ratio": 0.8,
        "chars_per_token": 4,
        "max_outputs": 20,
        "min_output_chars": 500,
        "keep_recent_turns": 2,
        "protected_tools": [
          "task",
          "task_update",
          "task_get",
          "lsp_rename",
          "session_read",
          "session_write",
          "session_search"
        ]
      }
    },
    "dynamic_pruning": {
      "enabled": true,
      "notification": "minimal",
      "recovery_target_ratio": 0.9,
      "chars_per_token": 4,
      "skip_summarize_if_recovered": true,
      "turn_protection": {
        "enabled": true,
        "turns": 3
      },
      "protected_tools": [
        "task",
        "task_update",
        "task_get",
        "lsp_rename",
        "session_read",
        "session_write",
        "session_search"
      ],
      "strategies": {
        "deduplication": { "enabled": true },
        "stale_tool_outputs": {
          "enabled": true,
          "keep_recent_turns": 6,
          "min_output_chars": 1200,
          "max_outputs": 6
        }
      }
    }
  }
}
```

| Key | Default | Description |
|-----|---------|-------------|
| `warning_ratio` | `0.7` | Emit a warning reminder when usage crosses this ratio (edge-triggered) |
| `preemptive_ratio` | `0.78` | Trigger preemptive `session.summarize(auto=true)` when usage crosses this ratio (edge-triggered) |
| `limit_ratio` | `1.0` | Trigger recovery compaction when usage reaches this ratio or token-limit errors are observed |
| `warning_reset_ratio` | `0.65` | Re-arm warning once usage falls below this ratio |
| `preemptive_reset_ratio` | `0.73` | Re-arm preemptive compaction once usage falls below this ratio |
| `recovery.max_attempts` | `2` | Maximum recovery attempts before the governor enters `failed` until reset thresholds re-arm |
| `recovery.initial_delay_ms` | `2000` | Initial retry backoff after a failed recovery attempt |
| `recovery.max_delay_ms` | `30000` | Maximum retry backoff for recovery attempts |
| `recovery.toast_cooldown_ms` | `30000` | Minimum time between recovery toasts for the same session |
| `recovery.aggressive_output_truncation.enabled` | `true` | Enables aggressive output truncation before summarize fallback |
| `recovery.aggressive_output_truncation.target_ratio` | `0.8` | Recovery target usage ratio for aggressive truncation |
| `recovery.aggressive_output_truncation.chars_per_token` | `4` | Estimator used to convert chars removed to token savings |
| `recovery.aggressive_output_truncation.max_outputs` | `20` | Max number of tool outputs to truncate per recovery attempt |
| `recovery.aggressive_output_truncation.min_output_chars` | `500` | Ignore tool outputs smaller than this threshold |
| `recovery.aggressive_output_truncation.keep_recent_turns` | `2` | Protect most recent turns from aggressive truncation |
| `recovery.aggressive_output_truncation.protected_tools` | task/LSP/session tools | Tool allowlist that must not be truncated |
| `dynamic_pruning.enabled` | `false` | Enables dynamic context pruning in recovery path |
| `dynamic_pruning.notification` | `minimal` | Toast verbosity: `off` / `minimal` / `detailed` |
| `dynamic_pruning.recovery_target_ratio` | `0.9` | If projected usage drops below this ratio, summarize can be skipped |
| `dynamic_pruning.chars_per_token` | `4` | Estimator used for projected token savings |
| `dynamic_pruning.skip_summarize_if_recovered` | `true` | Skip summarize when pruning projection reaches target |
| `dynamic_pruning.turn_protection.enabled` | `true` | Enable recent-turn protection for pruning |
| `dynamic_pruning.turn_protection.turns` | `3` | Number of latest turns to protect |
| `dynamic_pruning.protected_tools` | task/LSP/session tools | Tool allowlist that must not be pruned |
| `dynamic_pruning.strategies.deduplication.enabled` | `true` | Enables duplicate-tool-output pruning |
| `dynamic_pruning.strategies.stale_tool_outputs.enabled` | `true` | Enables stale large-output pruning |
| `dynamic_pruning.strategies.stale_tool_outputs.keep_recent_turns` | `6` | Additional recent-turn protection for stale pruning |
| `dynamic_pruning.strategies.stale_tool_outputs.min_output_chars` | `1200` | Minimum output size to consider stale-pruning |
| `dynamic_pruning.strategies.stale_tool_outputs.max_outputs` | `6` | Maximum stale outputs pruned per recovery pass |

## MCPs

Exa, Context7 and grep.app MCP enabled by default.

- **websearch**: Real-time web search powered by [Exa AI](https://exa.ai) - searches the web and returns relevant content
- **context7**: Fetches up-to-date official documentation for libraries
- **grep_app**: Ultra-fast code search across millions of public GitHub repositories via [grep.app](https://grep.app)

Don't want them? Disable via `disabled_mcps` in `~/.config/opencode/oh-my-opencode.json` or `.opencode/oh-my-opencode.json`:

```json
{
  "disabled_mcps": ["websearch", "context7", "grep_app"]
}
```

## LSP

OpenCode provides LSP tools for analysis.
Oh My OpenCode adds refactoring tools (rename, code actions).
All OpenCode LSP configs and custom settings (from opencode.json) are supported, plus additional Oh My OpenCode-specific settings.

Add LSP servers via the `lsp` option in `~/.config/opencode/oh-my-opencode.json` or `.opencode/oh-my-opencode.json`:

```json
{
  "lsp": {
    "typescript-language-server": {
      "command": ["typescript-language-server", "--stdio"],
      "extensions": [".ts", ".tsx"],
      "priority": 10
    },
    "pylsp": {
      "disabled": true
    }
  }
}
```

Each server supports: `command`, `extensions`, `priority`, `env`, `initialization`, `disabled`.

## Session State Repair

`session_state_repair` configures the `session-state-repair` hook behavior.

```jsonc
{
  "session_state_repair": {
    "auto_resume": true
  }
}
```

| Option | Default | Description |
| ------ | ------- | ----------- |
| `auto_resume` | `false` | Automatically resumes after successful thinking-related recovery (thinking order / thinking disabled). |

Note:
- `assistant_prefill_unsupported` recovery sends a best-effort `continue` for the main session (independent of `auto_resume`).

## Tool Output Truncator

`tool_output_truncator` configures `tool-output-truncator` behavior.

```jsonc
{
  "tool_output_truncator": {
    "truncate_all_tool_outputs": true
  }
}
```

| Option | Default | Description |
| ------ | ------- | ----------- |
| `truncate_all_tool_outputs` | `false` | Truncates all tool outputs instead of only the built-in high-risk tool allowlist. |

## Session Handoff

Session handoff enables knowledge transfer between sessions by extracting and injecting structured context (decisions, anti-patterns, domain knowledge).

```json
{
  "session_handoff": {
    "enabled": true,
    "auto_extract": true,
    "auto_inject": true,
    "min_messages_for_extract": 5,
    "min_file_changes_for_extract": 1,
    "max_inject_count": 3,
    "expiry_days": 7,
    "async_extraction": true,
    "extractor": {
      "model": "haiku",
      "max_decisions": 10,
      "max_artifacts": 20,
      "generate_embeddings": true
    },
    "reference": {
      "enabled": true,
      "strip_from_prompt": false,
      "resolve_options": {
        "max_results": 5,
        "min_relevance": 0.3
      }
    }
  }
}
```

| Option | Default | Description |
|--------|---------|-------------|
| `enabled` | `true` | Enable session handoff feature |
| `auto_extract` | `true` | Automatically extract handoff when session ends |
| `auto_inject` | `true` | Automatically inject relevant handoffs on session start |
| `min_messages_for_extract` | `5` | Minimum messages required for auto-extraction |
| `min_file_changes_for_extract` | `1` | Minimum file modifications required (prevents chat-only sessions from generating handoffs) |
| `max_inject_count` | `3` | Maximum handoffs to inject into new sessions |
| `expiry_days` | `7` | Days until handoffs expire |
| `async_extraction` | `true` | Run extraction in background (non-blocking) |

### Extractor Configuration

| Option | Default | Description |
|--------|---------|-------------|
| `extractor.model` | `haiku` | Model for extraction (`haiku`, `sonnet`, `opus`) |
| `extractor.max_decisions` | `10` | Maximum decisions to extract per session |
| `extractor.max_artifacts` | `20` | Maximum artifacts to track |
| `extractor.generate_embeddings` | `true` | Generate embedding index for semantic search |

### Session Reference Syntax

Use `@session:id` syntax in prompts to reference previous sessions:

```
# Reference by session ID
@session:abc123

# Reference most recent session
@session:latest
@session:~1

# Relative references (1 = most recent)
@session:~2

# Direct handoff reference
@session:handoff:ho_xxx

# Section queries
@session:abc123:decisions
@session:abc123:artifacts
@session:abc123:antiPatterns
@session:abc123:context

# Semantic queries (quoted)
@session:abc123:"authentication flow"
```

| Option | Default | Description |
|--------|---------|-------------|
| `reference.enabled` | `true` | Enable `@session:id` reference syntax |
| `reference.strip_from_prompt` | `false` | Remove references from prompt after resolution |
| `reference.resolve_options.max_results` | `5` | Maximum results for semantic search |
| `reference.resolve_options.min_relevance` | `0.3` | Minimum relevance score (0-1) for semantic results |

### Goal-Oriented Handoff

Use `/handoff <goal>` to create a focused handoff and start a new session:

```
# Active handoff with goal
/handoff execute phase one of the plan
/handoff check if this bug exists elsewhere
/handoff build admin panel for this

# Management commands
/handoff              # List handoffs
/handoff list         # List handoffs
/handoff show <id>    # Show specific handoff
/handoff delete <id>  # Delete handoff
/handoff cleanup      # Remove expired handoffs
```

Goal-oriented handoff filters the extracted context based on the specified goal, transferring only relevant decisions, anti-patterns, and domain knowledge to the new session.

### Session Reference Config

Use `session_handoff.reference` for `@session:` behavior:

```jsonc
{
  "session_handoff": {
    "reference": { "enabled": true }
  }
}
```

## Latest-only Removed Keys

These keys are intentionally removed and rejected by schema validation:

- Top-level `session_reference`
- Top-level `multi_plan_pipeline`
- `sisyphus.tasks.claude_code_compat`
- `sisyphus.swarm.mailbox_consume_mode`
- `governance.budget_monitor.gc_threshold`

## Environment Variables

| Variable              | Description                                                                                                                                     |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `OPENCODE_CONFIG_DIR` | Override the OpenCode configuration directory. Useful for profile isolation with tools like [OCX](https://github.com/kdcokenny/ocx) ghost mode. |
