import { z } from "zod"
import { AnyMcpNameSchema, McpNameSchema } from "../mcp/types"
import { CURRENT_CONFIG_VERSION } from "./version"

const PermissionValue = z.enum(["ask", "allow", "deny"])

const BashPermission = z.union([
  PermissionValue,
  z.record(z.string(), PermissionValue),
])

const AgentPermissionSchema = z.object({
  edit: PermissionValue.optional(),
  bash: BashPermission.optional(),
  webfetch: PermissionValue.optional(),
  doom_loop: PermissionValue.optional(),
  external_directory: PermissionValue.optional(),
}).strict()

export const BuiltinAgentNameSchema = z.enum([
  "sisyphus",
  "atlas",
  "oracle",
  "librarian",
  "explore",
  "multimodal-looker",
  "hephaestus",
  "metis",
  "momus",
])

export const BuiltinSkillNameSchema = z.enum([
  "playwright",
  "agent-browser",
  "frontend-ui-ux",
  "git-master",
  "parallel-agents",
  "dev-browser",
  "cartography",
  "spec-compliance-review",
  "code-quality-review",
  "writing-plans",
  "systematic-debugging",
  "code-simplifier",
])

export const BrowserAutomationProviderSchema = z.enum(["playwright", "agent-browser", "dev-browser"])

export const OverridableAgentNameSchema = z.enum([
  "build",
  "plan",
  "sisyphus",
  "atlas",
  "sisyphus-junior",
  "OpenCode-Builder",
  "prometheus",
  "oracle",
  "librarian",
  "explore",
  "multimodal-looker",
  "hephaestus",
  "metis",
  "momus",
])

export const AgentNameSchema = BuiltinAgentNameSchema

export const HookNameSchema = z.enum([
  "task-auto-continuation",
  "unstable-agent-watchdog",
  "session-state-repair",
  "session-notification",
  "comment-checker",
  "directory-agents-injector",
  "directory-readme-injector",
  "empty-task-response-detector",
  "rules-injector",
  "background-notification",
  "auto-update-checker",
  "startup-toast",
  "keyword-detector",
  "delegation-nudge-agent-usage",
  "non-interactive-env",
  "interactive-bash-session",

  "thinking-block-validator",
  "ralph-loop",

  "claude-code-hooks",
  "auto-slash-command",
  "edit-failure-guidance",
  "delegation-failure-guidance",
  "start-work",
  "swarm-from-plan",
  "work-orchestrator",
  "silent-tool-output",
  "context-manifest-injector",
  "repo-overview-injector",
  "codemap-injector",
  "runtime-tracker",
  "anti-slop-enforcer",
  "pre-completion-verification",
  "sisyphus-contextual-injector",
  "delegation-validate-decision",
  "conditional-rules",
  "session-handoff",
  "question-label-truncator",
  "delegation-nudge-category-skill",
  "sisyphus-junior-notepad",
  "tmux-parallel-agents",
  "swarm-agent",
  "anthropic-effort",
  "cache-policy",
])

export const HookPointSchema = z.enum([
  "chat.params",
  "chat.message",
  "tool.execute.before",
  "tool.execute.after",
  "experimental.chat.messages.transform",
  "experimental.session.compacting",
])

export const ContractClauseSchema = z.object({
  id: z.string(),
  description: z.string(),
  hook_points: z.array(HookPointSchema),
  enforcement: z.enum(["hard", "soft", "audit"]),
  selector: z.object({
    tool_name: z.union([z.string(), z.array(z.string())]).optional(),
    agent: z.string().optional(),
    session_tags: z.array(z.string()).optional(),
  }).default({}),
  condition: z.record(z.string(), z.unknown()),
  action: z.record(z.string(), z.unknown()),
  priority: z.number().int().default(100),
  conflict_resolution: z.enum(["first-match", "most-restrictive", "merge"]).default("most-restrictive"),
  enabled: z.boolean().default(true),
  version: z.number().int().default(1),
  provenance: z.object({
    author: z.string(),
    source: z.string(),
    created_at: z.number().int(),
  }),
  reason_code: z.string(),
}).strict()

export const ContractConfigSchema = z.object({
  clauses: z.array(ContractClauseSchema).default([]),
  conflict_resolution: z.enum(["first-match", "most-restrictive"]).default("most-restrictive"),
}).strict()

export const BudgetProfileSchema = z.object({
  context_tokens_target: z.number().int().positive(),
  context_tokens_hard_limit: z.number().int().positive(),
  reasoning_budget: z.enum(["low", "medium", "high"]),
  max_tool_calls: z.number().int().positive(),
  wall_clock_ms: z.number().int().positive(),
}).strict()

export const EvaluatorConfigSchema = z.object({
  enabled: z.boolean().default(true),
  async: z.boolean().default(true),
  metrics: z.array(z.string()).default(["task_success", "groundedness", "cost", "latency"]),
}).strict()

export const ModelPolicySchema = z.object({
  primary: z.literal("openai/gpt-5.3-codex"),
  provider_priority: z.array(z.enum(["openai", "google", "anthropic"])).min(1),
  allow_fallback: z.literal(true),
}).strict()

export const BuiltinCommandNameSchema = z.enum([
  "brainstorm",
  "init-deep",
  "ralph-loop",
  "ulw-loop",
  "cancel-ralph",
  "cartography",
  "refactor",
  "start-work",
  "stop-continuation",
])

export const AgentOverrideConfigSchema = z.object({
  /** Model specification - single model string */
  model: z.string().optional(),
  variant: z.string().optional(),
  /** Category name to inherit model and other settings from CategoryConfig */
  category: z.string().optional(),
  /** Skill names to inject into agent prompt */
  skills: z.array(z.string()).optional(),
  temperature: z.number().min(0).max(2).optional(),
  top_p: z.number().min(0).max(1).optional(),
  prompt: z.string().optional(),
  prompt_append: z.string().optional(),
  tools: z.record(z.string(), z.boolean()).optional(),
  disable: z.boolean().optional(),
  description: z.string().optional(),
  mode: z.enum(["subagent", "primary", "all"]).optional(),
  color: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/)
    .optional(),
  permission: AgentPermissionSchema.optional(),
}).strict()

export const AgentOverridesSchema = z.object({
  build: AgentOverrideConfigSchema.optional(),
  plan: AgentOverrideConfigSchema.optional(),
  sisyphus: AgentOverrideConfigSchema.optional(),
  atlas: AgentOverrideConfigSchema.optional(),
  "sisyphus-junior": AgentOverrideConfigSchema.optional(),
  "OpenCode-Builder": AgentOverrideConfigSchema.optional(),
  prometheus: AgentOverrideConfigSchema.optional(),
  oracle: AgentOverrideConfigSchema.optional(),
  librarian: AgentOverrideConfigSchema.optional(),
  explore: AgentOverrideConfigSchema.optional(),
  "multimodal-looker": AgentOverrideConfigSchema.optional(),
  metis: AgentOverrideConfigSchema.optional(),
  momus: AgentOverrideConfigSchema.optional(),
}).strict()

export const ClaudeCodeConfigSchema = z.object({
  mcp: z.boolean().optional(),
  commands: z.boolean().optional(),
  skills: z.boolean().optional(),
  agents: z.boolean().optional(),
  hooks: z.boolean().optional(),
  plugins: z.boolean().optional(),
  plugins_override: z.record(z.string(), z.boolean()).optional(),
}).strict()

export const SisyphusAgentConfigSchema = z.object({
  disabled: z.boolean().optional(),
  default_builder_enabled: z.boolean().optional(),
  planner_enabled: z.boolean().optional(),
  replace_plan: z.boolean().optional(),
}).strict()

export const CategoryConfigSchema = z.object({
  model: z.string().optional(),
  variant: z.string().optional(),
  temperature: z.number().min(0).max(2).optional(),
  top_p: z.number().min(0).max(1).optional(),
  maxTokens: z.number().optional(),
  thinking: z.object({
    type: z.enum(["enabled", "disabled"]),
    budgetTokens: z.number().optional(),
  }).strict().optional(),
  reasoningEffort: z.enum(["low", "medium", "high", "xhigh"]).optional(),
  textVerbosity: z.enum(["low", "medium", "high"]).optional(),
  tools: z.record(z.string(), z.boolean()).optional(),
  prompt_append: z.string().optional(),
  /** Mark agent as unstable - forces background mode for monitoring. Auto-enabled for gemini models. */
  is_unstable_agent: z.boolean().optional(),
  /** Human-readable description for this category */
  description: z.string().optional(),
  /** Disable this category from prompts and delegate_task routing */
  disable: z.boolean().optional(),
}).strict()

export const BuiltinCategoryNameSchema = z.enum([
  "visual-engineering",
  "ultrabrain",
  "deep",
  "artistry",
  "quick",
  "unspecified-low",
  "unspecified-high",
  "writing",
])

export const CategoriesConfigSchema = z.record(z.string(), CategoryConfigSchema)

export const CommentCheckerConfigSchema = z.object({
  /** Custom prompt to replace the default warning message. Use {{comments}} placeholder for detected comments XML. */
  custom_prompt: z.string().optional(),
}).strict()

export const SessionStateRepairConfigSchema = z.object({
  /** Automatically resumes session after successful thinking-related recovery. */
  auto_resume: z.boolean().optional(),
}).strict()

export const CacheStrategyProviderPolicyModeSchema = z.enum(["off", "observe", "enforce"])
export const CacheStrategyProviderOverrideModeSchema = z.enum([
  "inherit",
  "off",
  "observe",
  "enforce",
])
export const CacheStrategyRolloutProviderSchema = z.enum([
  "openai",
  "anthropic",
  "google",
  "minimax",
  "zai",
  "moonshot",
])

export const CacheStrategyObservabilityConfigSchema = z.object({
  /** Enable cache usage observability probes and logs */
  enabled: z.boolean().default(true),
  /** Emit structured cache-policy decisions to logger */
  emit_log: z.boolean().default(true),
}).strict()

export const CacheStrategyProviderPolicyConfigSchema = z.object({
  /** Global provider cache policy mode */
  mode: CacheStrategyProviderPolicyModeSchema.default("observe"),
  /**
   * When true, enforce mode may inject provider-specific cache keys
   * if the option key is missing in output.options.
   */
  inject_when_missing: z.boolean().default(false),
  /** Per-provider mode overrides */
  providers: z.record(
    z.string(),
    z.object({
      mode: CacheStrategyProviderOverrideModeSchema.default("inherit"),
    }).strict()
  ).optional(),
  /** Provider cache capability overrides (policy-as-data) */
  capabilities: z.record(
    z.string(),
    z.object({
      supports_cache_policy: z.boolean().optional(),
      preferred_option_key: z.string().optional(),
      option_aliases: z.array(z.string()).optional(),
    }).strict()
  ).optional(),
  rollout: z.object({
    /** Enable staged provider rollout for enforce mode */
    enabled: z.boolean().default(false),
    /**
     * Enforce stage (fixed order):
     * 0=none, 1=openai, 2=anthropic, 3=google, 4=minimax, 5=zai, 6=moonshot
     */
    stage: z.number().min(0).max(6).default(0),
    /** Require per-provider threshold gates before enforce in the current stage */
    require_thresholds: z.boolean().default(true),
    /** Provider-specific threshold gates and observed metrics */
    providers: z.partialRecord(
      CacheStrategyRolloutProviderSchema,
      z.object({
        /** Manual approval switch for rapid rollback/rollforward */
        approved: z.boolean().default(false),
        threshold: z.object({
          enabled: z.boolean().default(false),
          min_cache_hit_ratio: z.number().min(0).max(1).default(0),
          max_error_rate: z.number().min(0).max(1).default(1),
          max_p95_latency_ms: z.number().min(1).max(600_000).default(600_000),
          min_samples: z.number().min(0).max(1_000_000).default(0),
        }).strict().default({
          enabled: false,
          min_cache_hit_ratio: 0,
          max_error_rate: 1,
          max_p95_latency_ms: 600_000,
          min_samples: 0,
        }),
        observed: z.object({
          cache_hit_ratio: z.number().min(0).max(1).optional(),
          error_rate: z.number().min(0).max(1).optional(),
          p95_latency_ms: z.number().min(0).max(600_000).optional(),
          samples: z.number().min(0).max(1_000_000).optional(),
        }).strict().optional(),
      }).strict()
    ).optional(),
  }).strict().default({
    enabled: false,
    stage: 0,
    require_thresholds: true,
  }),
}).strict()

export const CacheStrategyLedgerConfigSchema = z.object({
  /** Enable append-only context ledger side writes */
  enabled: z.boolean().default(false),
  /** Optional ledger base directory override */
  base_dir: z.string().optional(),
}).strict()

export const CacheStrategyCompilerConfigSchema = z.object({
  /** Enable ledger-first prefix compiler read path */
  enabled: z.boolean().default(false),
  /** Max immutable segments used for prefix compilation */
  max_prefix_segments: z.number().min(1).max(1000).default(64),
  /** Max chars allocated to stable prefix */
  max_prefix_chars: z.number().min(256).max(200_000).default(32_000),
  /** Segment separator used by compiler */
  separator: z.string().default("\n\n---\n\n"),
}).strict()

export const CacheStrategyConfigSchema = z.object({
  observability: CacheStrategyObservabilityConfigSchema.default({
    enabled: true,
    emit_log: true,
  }),
  provider_policy: CacheStrategyProviderPolicyConfigSchema.default({
    mode: "observe",
    inject_when_missing: false,
    rollout: {
      enabled: false,
      stage: 0,
      require_thresholds: true,
    },
  }),
  ledger: CacheStrategyLedgerConfigSchema.default({
    enabled: false,
  }),
  compiler: CacheStrategyCompilerConfigSchema.default({
    enabled: false,
    max_prefix_segments: 64,
    max_prefix_chars: 32_000,
    separator: "\n\n---\n\n",
  }),
}).strict()

export const SkillSourceSchema = z.union([
  z.string(),
  z.object({
    path: z.string(),
    recursive: z.boolean().optional(),
    glob: z.string().optional(),
  }).strict(),
])

export const SkillDefinitionSchema = z.object({
  description: z.string().optional(),
  template: z.string().optional(),
  from: z.string().optional(),
  model: z.string().optional(),
  agent: z.string().optional(),
  subtask: z.boolean().optional(),
  "argument-hint": z.string().optional(),
  license: z.string().optional(),
  compatibility: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  "allowed-tools": z.array(z.string()).optional(),
  disable: z.boolean().optional(),
}).strict()

export const SkillEntrySchema = z.union([
  z.boolean(),
  SkillDefinitionSchema,
])

export const SkillsConfigSchema = z.union([
  z.array(z.string()),
  z.record(z.string(), SkillEntrySchema).and(z.object({
    sources: z.array(SkillSourceSchema).optional(),
    enable: z.array(z.string()).optional(),
    disable: z.array(z.string()).optional(),
  }).partial()),
])

export const RalphLoopConfigSchema = z.object({
  /** Enable ralph loop functionality (default: false - opt-in feature) */
  enabled: z.boolean().default(false),
  /** Default max iterations if not specified in command (default: 100) */
  default_max_iterations: z.number().min(1).max(1000).default(100),
  /** Custom state file path relative to project root (default: .sisyphus/ralph-loop.local.md) */
  state_dir: z.string().optional(),
}).strict()

export const UnstableAgentWatchdogConfigSchema = z.object({
  /** Enable unstable-agent watchdog reminders (default: true) */
  enabled: z.boolean().default(true),
  /** Idle timeout in milliseconds before triggering reminder (default: 120000 = 2 minutes) */
  timeout_ms: z.number().min(10_000).default(120_000),
  /** Cooldown per task between reminder injections (default: 300000 = 5 minutes) */
  cooldown_ms: z.number().min(10_000).default(300_000),
  /** Maximum chars to include from background thinking/reasoning summary (default: 500) */
  thinking_summary_max_chars: z.number().min(100).max(4000).default(500),
}).strict()

export const BackgroundTaskConfigSchema = z.object({
  defaultConcurrency: z.number().min(1).optional(),
  providerConcurrency: z.record(z.string(), z.number().min(0)).optional(),
  modelConcurrency: z.record(z.string(), z.number().min(0)).optional(),
  /** Stale timeout in milliseconds - interrupt tasks with no activity for this duration (default: 180000 = 3 minutes, minimum: 60000 = 1 minute) */
  staleTimeoutMs: z.number().min(60000).optional(),
  /** Watchdog for unstable-model background tasks (Gemini/Minimax/custom unstable categories) */
  unstable_watchdog: UnstableAgentWatchdogConfigSchema.optional(),
}).strict()

export const ParallelRuntimeModeSchema = z.enum(["shadow", "enforce"])

export const ParallelRuntimeConfigSchema = z.object({
  /** Enable global parallel runtime arbitration (default: true) */
  enabled: z.boolean().default(true),
  /** Admission mode: shadow=observe only, enforce=hard cap (default: shadow) */
  mode: ParallelRuntimeModeSchema.default("shadow"),
  /** Global slot count shared by background/swarm (default: 6) */
  global_slots: z.number().min(1).max(1000).default(6),
  /** Lease TTL in milliseconds (default: 120000) */
  lease_ttl_ms: z.number().min(1000).default(120000),
  /** Heartbeat/renew interval hint in milliseconds (default: 10000) */
  heartbeat_ms: z.number().min(1000).default(10000),
  /** Max wait to acquire slot in enforce mode (default: 15000) */
  acquire_timeout_ms: z.number().min(100).default(15000),
  /** Lock wait timeout for runtime state operations (default: 2000) */
  lock_timeout_ms: z.number().min(100).default(2000),
}).strict()

/** Tmux Parallel Agents Configuration - auto-create tmux windows and git worktrees for background tasks */
// ============================================================================
// Sisyphus Tasks & Swarm Configuration
// ============================================================================

export const TmuxLayoutSchema = z.enum([
  "main-horizontal",
  "main-vertical",
  "tiled",
  "even-horizontal",
  "even-vertical",
])

export const SisyphusTasksConfigSchema = z.object({
  /** Enable Sisyphus Tasks system (default: false) */
  enabled: z.boolean().default(false),
  /** Storage path for tasks (default: .sisyphus/tasks) */
  storage_path: z.string().default(".sisyphus/tasks"),
}).strict()

export const SisyphusSwarmConfigSchema = z.object({
  /** Enable Sisyphus Swarm system (default: false) */
  enabled: z.boolean().default(false),
  /** Storage path for teams (default: .sisyphus/teams) */
  storage_path: z.string().default(".sisyphus/teams"),
  /** UI mode: toast notifications, tmux panes, or both */
  ui_mode: z.enum(["toast", "tmux", "both"]).default("toast"),
  /** Swarm-first orchestration: auto-start Swarm from /start-work (default: false) */
  swarm_first: z.boolean().default(false),
  /** Target worker count when swarm_first=true (default: 3) */
  worker_count: z.number().min(0).max(10).default(3),
  /** Fallback polling interval for fs.watch mode (default: 5000ms) */
  watch_fallback_poll_ms: z.number().min(500).default(5000),
  /** Reject privileged messages from invalid senders (default: true) */
  enforce_sender_validation: z.boolean().default(true),
  /** Require signature verification for privileged control messages (default: true) */
  enforce_signature: z.boolean().default(true),
  /** Coordinator lease TTL in milliseconds (default: 15000ms) */
  coordinator_lease_ttl_ms: z.number().min(1000).default(15000),
  /** Coordinator lease renew interval in milliseconds (default: 5000ms) */
  coordinator_lease_renew_ms: z.number().min(500).default(5000),
  /** Auto-rescue policy for y/n prompts (default: disabled) */
  auto_rescue_policy: z.enum(["disabled", "allowlist"]).default("disabled"),
  /** Allowlist prompt patterns used when auto_rescue_policy=allowlist */
  auto_rescue_allowlist: z.array(z.string()).default([]),
}).strict()

export const SisyphusConfigSchema = z.object({
  tasks: SisyphusTasksConfigSchema.optional(),
  swarm: SisyphusSwarmConfigSchema.optional(),
}).strict()

export const TmuxParallelAgentsConfigSchema = z.object({
  /** Enable tmux window auto-creation for background tasks (default: false) */
  enabled: z.boolean().default(false),
  /** Tmux layout for agent windows (default: main-vertical) */
  layout: TmuxLayoutSchema.default("main-vertical"),
  /** Auto-rescue stuck agents by sending 'y' when (y/n) prompt detected (default: false) */
  auto_rescue: z.boolean().default(false),
  /** Rescue check interval in milliseconds (default: 10000) */
  rescue_interval_ms: z.number().min(1000).default(10000),
  /** Status icons shown in tmux window names */
  status_icons: z.object({
    waiting: z.string().default("..."),
    working: z.string().default(">>>"),
    done: z.string().default("OK"),
    error: z.string().default("ERR"),
    idle: z.string().default(""),
  }).strict().optional(),
  /** Git worktree configuration for file system isolation */
  worktree: z.object({
    /** Enable git worktree creation for each background task (default: false) */
    enabled: z.boolean().default(false),
    /** Directory pattern for worktrees, {project} replaced with project name (default: ../{project}__worktrees) */
    dir_pattern: z.string().default("../{project}__worktrees"),
    /** Files to copy to worktree (default: [".env", ".env.local"]) */
    copy_files: z.array(z.string()).default([".env", ".env.local"]),
    /** Files/dirs to symlink to worktree (default: ["node_modules"]) */
    symlink: z.array(z.string()).default(["node_modules"]),
    /** Auto-cleanup worktree and branch on session end (default: false - keep for manual merge) */
    auto_cleanup: z.boolean().default(false),
  }).strict().optional(),
}).strict()

export const NotificationConfigSchema = z.object({
  /** Force enable session-notification even if external notification plugins are detected (default: false) */
  force_enable: z.boolean().optional(),
}).strict()

export const GitMasterConfigSchema = z.object({
  /** Add "Ultraworked with Sisyphus" footer to commit messages (default: true). Can be boolean or custom string. */
  commit_footer: z.union([z.boolean(), z.string()]).default(true),
  /** Add "Co-authored-by: Sisyphus" trailer to commit messages (default: true) */
  include_co_authored_by: z.boolean().default(true),
}).strict()

/** Planning with Files Configuration (Manus-style persistent planning) */
export const PlanningWithFilesConfigSchema = z.object({
  /** Enable the planning-with-files pattern (default: false) */
  enabled: z.boolean().default(false),
  /** BDD alignment gate for task Scenario Ref coverage (default: "warn") */
  bdd_alignment: z.enum(["off", "warn", "required"]).default("warn"),
  /** Enable 2-action rule for findings updates (default: true) */
  two_action_rule: z.boolean().default(true),
  /** Enable 3-strike error protocol (default: true) */
  three_strike_protocol: z.boolean().default(true),
  /** Enable auto re-read of execution plan before tool use (default: true) */
  auto_reread: z.boolean().default(true),
  /** Enable stop hook verification (default: true) */
  stop_verification: z.boolean().default(true),
  /** Tools that trigger plan re-read */
  reread_trigger_tools: z.array(z.string()).optional(),
  /** Tools that count toward the 2-action rule */
  action_count_tools: z.array(z.string()).optional(),
}).strict()

/** Default planning-with-files configuration */
export const DEFAULT_PLANNING_WITH_FILES_CONFIG = PlanningWithFilesConfigSchema.parse({})

/** Continuation control configuration - single-writer arbitration for idle continuation prompts */
export const ContinuationControlPrioritySchema = z.object({
  /** Highest priority: unified work orchestrator continuation */
  "work-orchestrator": z.number().min(0).max(1000).default(400),
  /** Ralph loop continuation */
  "ralph-loop": z.number().min(0).max(1000).default(300),
  /** Task continuation */
  "task-auto-continuation": z.number().min(0).max(1000).default(200),
  /** Lowest priority: unstable background watchdog reminder */
  "unstable-agent-watchdog": z.number().min(0).max(1000).default(50),
}).strict()

export const ContinuationControlConfigSchema = z.object({
  /** Grace period after session compaction before allowing continuation (default: 1500ms) */
  post_compaction_grace_ms: z.number().min(0).max(60_000).default(1500),
  /** Per-source priority for single-writer arbitration */
  priority: ContinuationControlPrioritySchema.default({
    "work-orchestrator": 400,
    "ralph-loop": 300,
    "task-auto-continuation": 200,
    "unstable-agent-watchdog": 50,
  }),
}).strict()

/** Default continuation-control configuration */
export const DEFAULT_CONTINUATION_CONTROL_CONFIG = ContinuationControlConfigSchema.parse({})

/** Verifier Gate configuration - hard completion gate for task_transition(completed) */
export const VerifierGateConfigSchema = z.object({
  /** Enable verifier gate enforcement (default: true) */
  enabled: z.boolean().default(true),
  /** Evidence time-to-live in milliseconds (default: 15 minutes) */
  evidence_ttl_ms: z.number().min(10_000).max(86_400_000).default(900_000),
  /** Require clean LSP diagnostics evidence for changed files (default: true) */
  require_lsp_clean: z.boolean().default(true),
  /** Require at least one successful test/build/typecheck command when code changed (default: true) */
  require_test_or_build: z.boolean().default(true),
  /** Allow completion without verifier evidence if no code changes detected (default: true) */
  allow_no_code_change: z.boolean().default(true),
}).strict()

/** Discovery marker parsing mode */
export const DiscoveryMarkerModeSchema = z.enum(["xml", "prefix", "hybrid"])

/** Discovery Channel configuration - captures deferred findings to persistent ledger */
export const DiscoveryChannelConfigSchema = z.object({
  /** Enable discovery capture and persistence (default: true) */
  enabled: z.boolean().default(true),
  /** Parse delegate_task outputs for discovery markers (default: true) */
  capture_delegate_output: z.boolean().default(true),
  /** Parse assistant message updates for discovery markers (default: true) */
  capture_assistant_updates: z.boolean().default(true),
  /** Marker parser mode (default: hybrid) */
  marker_mode: DiscoveryMarkerModeSchema.default("hybrid"),
  /** Deduplication time window in milliseconds (default: 30 minutes) */
  dedupe_window_ms: z.number().min(60_000).max(86_400_000).default(1_800_000),
  /** Maximum unresolved discovery entries to keep per plan (default: 200) */
  max_open_items: z.number().min(10).max(5000).default(200),
  /** Auto-create TaskGraph items from discovery entries (default: false) */
  auto_task_create: z.boolean().default(false),
}).strict()

/** Unified Work Orchestrator Configuration */
export const WorkOrchestratorConfigSchema = z.object({
  /** Enable unified planning + execution orchestration (default: true) */
  enabled: z.boolean().default(true),
  /** Embedded planning protocol configuration */
  planning_with_files: PlanningWithFilesConfigSchema.default(DEFAULT_PLANNING_WITH_FILES_CONFIG),
  /** Embedded continuation arbitration configuration */
  continuation_control: ContinuationControlConfigSchema.default(DEFAULT_CONTINUATION_CONTROL_CONFIG),
  /** Hard completion verifier gate configuration */
  verifier_gate: VerifierGateConfigSchema.default({
    enabled: true,
    evidence_ttl_ms: 900_000,
    require_lsp_clean: true,
    require_test_or_build: true,
    allow_no_code_change: true,
  }),
  /** Deferred discovery capture configuration */
  discovery_channel: DiscoveryChannelConfigSchema.default({
    enabled: true,
    capture_delegate_output: true,
    capture_assistant_updates: true,
    marker_mode: "hybrid",
    dedupe_window_ms: 1_800_000,
    max_open_items: 200,
    auto_task_create: false,
  }),
}).strict()

/** Default work-orchestrator configuration */
export const DEFAULT_WORK_ORCHESTRATOR_CONFIG = WorkOrchestratorConfigSchema.parse({})

/** Silent Tool Output Configuration - reduces context by optimizing tool outputs */
export const SilentToolOutputConfigSchema = z.object({
  /** Enable silent write output - returns metadata only (default: true) */
  silent_write: z.boolean().default(true),
  /** Enable optimized read for planning files (default: true) */
  optimize_planning_reads: z.boolean().default(true),
  /** Enable search result truncation (default: true) */
  optimize_search: z.boolean().default(true),
  /** Max lines to show in search results (default: 20) */
  search_max_lines: z.number().default(20),
  /** Max characters for content preview (default: 200) */
  preview_max_chars: z.number().default(200),
}).strict()

/** Repository Overview Configuration - bootstraps session with project context */
export const RepoOverviewConfigSchema = z.object({
  /** Enable repository overview injection (default: true) */
  enabled: z.boolean().default(true),
  /** Auto-generate overview on first tool use (default: true) */
  auto_generate: z.boolean().default(true),
  /** Max lines for directory tree (default: 50) */
  max_tree_depth: z.number().min(10).max(200).default(50),
  /** Cache duration in ms (default: 1 hour = 3600000) */
  cache_duration_ms: z.number().default(3600000),
  /**
   * Minimum tool calls before injecting overview (default: 1 = first tool use)
   * Set to 2+ to skip injection for trivial one-shot interactions.
   */
  min_tool_calls: z.number().min(1).max(100).default(1),
}).strict()

/** Cartography Configuration - codemap generation controls */
export const CartographyConfigSchema = z.object({
  /** Enable cartography tool execution (default: true) */
  enabled: z.boolean().default(true),
  /** Maximum directory depth to scan (default: 4) */
  max_depth: z.number().min(1).max(12).default(4),
  /** Minimum files required for non-root codemap generation (default: 3) */
  min_files: z.number().min(1).max(200).default(3),
  /** Maximum parallel explorers budget (default: 5) */
  max_parallel_explorers: z.number().min(1).max(20).default(5),
  /** Include glob patterns for source discovery */
  include_patterns: z.array(z.string()).default([
    "**/*.ts",
    "**/*.tsx",
    "**/*.py",
    "**/*.go",
    "**/*.rs",
    "**/*.js",
    "**/*.jsx",
  ]),
  /** Exclude glob patterns for discovery */
  exclude_patterns: z.array(z.string()).default([
    "**/node_modules/**",
    "**/.git/**",
    "**/dist/**",
    "**/build/**",
    "**/*.test.ts",
    "**/*.spec.ts",
    "**/tests/**",
    "**/__tests__/**",
    "**/.venv/**",
    "**/venv/**",
    "**/target/**",
    "**/__pycache__/**",
  ]),
}).strict()

/** Codemap Injector Configuration - contextual codemap injection on reads */
export const CodemapInjectorConfigSchema = z.object({
  /** Enable codemap injector hook (default: false) */
  enabled: z.boolean().default(false),
  /** Token budget for codemap-injector output chunks (default: 600) */
  budget: z.number().min(100).max(4000).default(600),
  /** Max summary tokens for a single codemap snippet (default: 400) */
  max_per_codemap: z.number().min(100).max(2000).default(400),
  /** Suggest generating codemaps for hot directories (default: true) */
  suggest_cartography: z.boolean().default(true),
  /** Reserved flag for semantic retrieval strategy (default: false) */
  semantic_search: z.boolean().default(false),
  /**
   * Inject root project-map for architecture/refactor prompts.
   * Default false to avoid overlap with repo-overview-injector.
   */
  inject_root_project_map: z.boolean().default(false),
}).strict()

/** Runtime Tracker Configuration - tracks tool execution times */
export const RuntimeTrackerConfigSchema = z.object({
  /** Enable runtime tracking (default: true) */
  enabled: z.boolean().default(true),
  /** Threshold in ms to trigger warning (default: 3000) */
  threshold_ms: z.number().min(500).max(60000).default(3000),
  /** Max recent durations to track for average (default: 10) */
  max_recent: z.number().min(3).max(50).default(10),
  /** Inject runtime hints into tool output (default: true) */
  inject_hints: z.boolean().default(true),
  /** Cooldown in ms between hints for the same tool (default: 60000) */
  hint_cooldown_ms: z.number().min(0).default(60000),
}).strict()

const UserMemoryEntityTypeSchema = z.enum([
  "person",
  "project",
  "technology",
  "organization",
  "concept",
])

const UserMemoryDisclosureLevelSchema = z.enum(["minimal", "standard", "full"])

/** Hierarchical Memory override configuration */
export const HierarchicalMemoryConfigOverrideSchema = z.object({
  enabled: z.boolean(),
  weekly_summaries_limit: z.number().min(0).max(520),
  monthly_summaries_limit: z.number().min(0).max(120),
  long_term_knowledge_limit: z.number().min(0).max(5000),
  aggregation_model: z.enum(["haiku", "sonnet", "opus"]),
  auto_aggregate: z.boolean(),
}).partial().strict()

/** Entity Memory override configuration */
export const EntityMemoryConfigOverrideSchema = z.object({
  enabled: z.boolean(),
  max_entities: z.number().min(0).max(20000),
  max_relationships: z.number().min(0).max(100000),
  min_mentions: z.number().min(1).max(1000),
  injection_confidence_threshold: z.number().min(0).max(1),
  extract_types: z.array(UserMemoryEntityTypeSchema),
}).partial().strict()

/** Temporal Validity override configuration */
export const TemporalValidityConfigOverrideSchema = z.object({
  enabled: z.boolean(),
  staleness_threshold: z.number().min(0).max(1),
  decay_factor: z.number().min(0).max(1),
  include_expired: z.boolean(),
}).partial().strict()

/** Size-based consolidation override configuration */
export const ConsolidationConfigOverrideSchema = z.object({
  enabled: z.boolean(),
  work_history_threshold: z.number().min(0).max(100000),
  weekly_summaries_threshold: z.number().min(0).max(100000),
  monthly_summaries_threshold: z.number().min(0).max(100000),
}).partial().strict()

/** Semantic clustering override configuration */
export const SemanticClusteringConfigOverrideSchema = z.object({
  enabled: z.boolean(),
  high_confidence_threshold: z.number().min(0).max(1),
  candidate_threshold: z.number().min(0).max(1),
  max_llm_calls: z.number().min(0).max(1000),
  use_synonyms: z.boolean(),
  use_stemming: z.boolean(),
}).partial().strict()

/** Hybrid search weights configuration */
const HybridWeightsObjectSchema = z.object({
  /** Weight for vector (semantic) similarity (default: 0.5) */
  vector: z.number().min(0).max(1).default(0.5),
  /** Weight for BM25 (keyword) similarity (default: 0.3) */
  bm25: z.number().min(0).max(1).default(0.3),
  /** Weight for Jaccard (n-gram/synonym) similarity (default: 0.2) */
  jaccard: z.number().min(0).max(1).default(0.2),
}).strict()

function hybridWeightsSumToOne(weights: {
  vector: number
  bm25: number
  jaccard: number
}): boolean {
  return Math.abs(weights.vector + weights.bm25 + weights.jaccard - 1) < 0.01
}

function hasCompleteHybridWeights(weights: {
  vector?: number
  bm25?: number
  jaccard?: number
}): weights is {
  vector: number
  bm25: number
  jaccard: number
} {
  return (
    weights.vector !== undefined &&
    weights.bm25 !== undefined &&
    weights.jaccard !== undefined
  )
}

/** Full hybrid weights config - requires weights to sum to 1.0 */
export const HybridWeightsConfigSchema = HybridWeightsObjectSchema.refine(
  (w) => hybridWeightsSumToOne(w),
  { message: "Hybrid weights must sum to 1.0" }
)

/**
 * Partial hybrid weights override.
 * If all three weights are provided, enforce the sum constraint.
 */
export const HybridWeightsOverrideSchema = z.object({
  vector: z.number().min(0).max(1).optional(),
  bm25: z.number().min(0).max(1).optional(),
  jaccard: z.number().min(0).max(1).optional(),
}).strict().refine(
  (w) => !hasCompleteHybridWeights(w) || hybridWeightsSumToOne(w),
  { message: "Hybrid weights must sum to 1.0" }
)

/** Embedding/Vector Search configuration */
export const EmbeddingConfigOverrideSchema = z.object({
  /** Enable vector search (default: false - opt-in) */
  enabled: z.boolean(),
  /** Embedding provider: 'local' for offline, 'openai' for cloud (default: 'local') */
  provider: z.enum(["local", "openai"]),
  /** OpenAI model when using openai provider */
  openai_model: z.enum([
    "text-embedding-ada-002",
    "text-embedding-3-small",
    "text-embedding-3-large",
  ]),
  /** Local model name (default: 'Xenova/all-MiniLM-L6-v2') */
  local_model: z.string(),
  /** Three-way hybrid search weights */
  hybrid_weights: HybridWeightsOverrideSchema,
  /** Enable embedding cache (default: true) */
  cache_enabled: z.boolean(),
  /** Batch size for embedding API calls (default: 20) */
  batch_size: z.number().min(1).max(100),
}).partial().strict()

/** User Memory Configuration - persistent memory across sessions */
export const UserMemoryConfigSchema = z.object({
  /** Enable user memory persistence (default: true) */
  enabled: z.boolean().default(true),
  /** Persist user preferences (default: true) */
  persist_preferences: z.boolean().default(true),
  /** Persist work history (default: true) */
  persist_work_history: z.boolean().default(true),
  /** Max work history entries to keep (default: 50) */
  max_history_entries: z.number().min(10).max(200).default(50),
  /** Auto-inject memory context on session start (default: true) */
  auto_inject: z.boolean().default(true),
  hierarchical_memory: HierarchicalMemoryConfigOverrideSchema.optional(),
  entity_memory: EntityMemoryConfigOverrideSchema.optional(),
  temporal_validity: TemporalValidityConfigOverrideSchema.optional(),
  consolidation: ConsolidationConfigOverrideSchema.optional(),
  semantic_clustering: SemanticClusteringConfigOverrideSchema.optional(),
  disclosure_level: UserMemoryDisclosureLevelSchema.optional(),
  /** Vector search / embedding configuration */
  embeddings: EmbeddingConfigOverrideSchema.optional(),
}).strict()

/** Org Memory Configuration - project/team memory shared via repo */
export const OrgMemoryConfigSchema = z.object({
  /** Enable org memory (default: true) */
  enabled: z.boolean().default(true),
  /** Auto-inject org memory into sessions (default: true) */
  auto_inject: z.boolean().default(true),
  /** Max conventions to include in context (default: 10) */
  max_conventions: z.number().min(0).max(50).default(10),
  /** Max architectural decisions to include (default: 5) */
  max_decisions: z.number().min(0).max(50).default(5),
  /** Max patterns to include (default: 5) */
  max_patterns: z.number().min(0).max(50).default(5),
  /** Max terminology entries to include (default: 10) */
  max_terminology: z.number().min(0).max(50).default(10),
  /** Max custom rules to include (default: 20) */
  max_custom_rules: z.number().min(0).max(200).default(20),
}).strict()

/** Governance Tool Criticality Configuration */
export const GovernanceToolCriticalitySchema = z.object({
  /** Tool name or pattern */
  tool: z.string(),
  /** Criticality level */
  level: z.enum(["low", "medium", "high", "critical"]),
  /** Reason for criticality */
  reason: z.string().optional(),
  /** Categories this applies to */
  categories: z.array(z.string()).optional(),
}).strict()

/** Governance Configuration - approval, tracing, budget, checkpoints */
const GovernanceBudgetMonitorConfigSchema = z.object({
  /** Enable budget monitoring (default: true when governance enabled) */
  enabled: z.boolean().default(true),
  /** Warn threshold - triggers GC/convergence hints (default: 0.7) */
  warn_threshold: z.number().min(0.3).max(0.95).default(0.7),
  /** Refactor threshold - triggers fork suggestion (default: 0.85) */
  refactor_threshold: z.number().min(0.5).max(0.95).default(0.85),
  /** Hard limit threshold - triggers budget exhausted guardrail (default: 0.95) */
  hard_limit: z.number().min(0.7).max(0.99).default(0.95),
  /** Context window size estimate (default: 200000) */
  context_window_size: z.number().min(50000).max(1000000).default(200000),
}).partial().strict()

export const GovernanceConfigSchema = z.object({
  /** Enable governance module (default: false - opt-in) */
  enabled: z.boolean().default(false),

  /** Approval Gate Configuration */
  approval_gate: z.object({
    /** Enable approval gate for critical tools (default: true when governance enabled) */
    enabled: z.boolean().default(true),
    /** Tools that always skip approval (glob patterns) */
    skip_patterns: z.array(z.string()).default([
      "Read", "Glob", "Grep", "LSP", "task_get", "task_list",
    ]),
    /** Token expiry time in minutes (default: 30) */
    token_expiry_minutes: z.number().min(1).max(1440).default(30),
    /** Custom tool criticality overrides */
    tool_criticality: z.array(GovernanceToolCriticalitySchema).optional(),
  }).partial().strict().optional(),

  /** Execution Tracer Configuration */
  tracer: z.object({
    /** Enable execution tracing (default: true when governance enabled) */
    enabled: z.boolean().default(true),
    /** Maximum nodes to keep in memory (default: 1000) */
    max_nodes: z.number().min(100).max(10000).default(1000),
    /** Auto-compress threshold (default: 500) */
    auto_compress_threshold: z.number().min(50).max(5000).default(500),
    /** Sanitize sensitive data in inputs/outputs (default: true) */
    sanitize_sensitive_data: z.boolean().default(true),
  }).partial().strict().optional(),

  /** Budget Monitor Configuration */
  budget_monitor: GovernanceBudgetMonitorConfigSchema.optional(),

  /** Semantic Checkpoint Configuration */
  checkpoint: z.object({
    /** Enable semantic checkpoints (default: false - disabled until stable) */
    enabled: z.boolean().default(false),
    /** Auto-checkpoint interval in tool calls (default: 10) */
    auto_checkpoint_interval: z.number().min(1).max(100).default(10),
    /** Maximum checkpoints to keep (default: 5) */
    max_checkpoints: z.number().min(1).max(20).default(5),
    /** Recovery strategy preference */
    recovery_preference: z.enum(["conservative", "balanced", "aggressive"]).default("balanced"),
  }).partial().strict().optional(),

  /** Ledger Configuration */
  ledger: z.object({
    /** Enable governance ledger for audit logging (default: true when governance enabled) */
    enabled: z.boolean().default(true),
    /** Base directory for ledger files (default: ~/.sisyphus/ledger) */
    base_dir: z.string().optional(),
    /** Retention days for ledger entries (default: 30) */
    retention_days: z.number().min(1).max(365).default(30),
  }).partial().strict().optional(),
}).strict()

// ============================================================================
// Conditional Rules Configuration
// ============================================================================

/** AGENTS.md Discovery Configuration */
export const AgentsMdConfigSchema = z.object({
  /** Enable AGENTS.md discovery (default: true) */
  enabled: z.boolean().default(true),
  /** File names to search for (default: ["AGENTS.md", "AGENTS.local.md"]) */
  file_names: z.array(z.string()).default(["AGENTS.md", "AGENTS.local.md"]),
  /** Directories to ignore during discovery */
  ignore: z.array(z.string()).default([
    "node_modules",
    ".git",
    "dist",
    "build",
    "coverage",
    ".next",
    ".turbo",
    "__pycache__",
    ".venv",
    "venv",
    "target",
  ]),
  /** Maximum directory depth to search (default: 10) */
  max_depth: z.number().min(1).max(20).default(10),
}).strict()

/** Glob condition - matches file paths against glob pattern */
export const GlobConditionSchema = z.object({
  type: z.literal("glob"),
  /** Glob pattern (e.g., "**\/*.ts", "src/components/**") */
  pattern: z.string(),
  /** If true (default), rule matches if ANY file matches. If false, ALL files must match. */
  matchAny: z.boolean().optional(),
}).strict()

/** Directory condition - matches files within a directory */
export const DirectoryConditionSchema = z.object({
  type: z.literal("directory"),
  /** Directory path relative to project root */
  path: z.string(),
  /** If true (default), includes subdirectories */
  recursive: z.boolean().optional(),
}).strict()

/** Content condition - matches files containing specific patterns */
export const ContentConditionSchema = z.object({
  type: z.literal("content"),
  /** Regex pattern to search in file content */
  pattern: z.string(),
  /** Only check files already matched by other conditions (default: true) */
  relevantFilesOnly: z.boolean().optional(),
}).strict()

/** Context matcher for context conditions */
export const ContextMatcherSchema = z.union([
  z.object({ agent: z.string() }).strict(),
  z.object({ category: z.string() }).strict(),
  z.object({ task: z.enum(["planning", "implementation", "review", "debugging"]) }).strict(),
  z.object({ skill: z.string() }).strict(),
])

/** Context condition - matches execution context */
export const ContextConditionSchema = z.object({
  type: z.literal("context"),
  /** Context to match */
  match: ContextMatcherSchema,
}).strict()

/** Union of all condition types */
export const RuleConditionSchema = z.discriminatedUnion("type", [
  GlobConditionSchema,
  DirectoryConditionSchema,
  ContentConditionSchema,
  ContextConditionSchema,
])

/** Rule content can be inline string or file reference */
export const RuleContentSchema = z.union([
  z.string(),
  z.object({
    /** Path to file containing rule content */
    file: z.string(),
  }).strict(),
])

/** Config-defined conditional rule */
export const ConfigRuleSchema = z.object({
  /** Unique identifier for the rule */
  id: z.string(),
  /** Human-readable name */
  name: z.string(),
  /** Conditions that must all match (AND logic) */
  conditions: z.array(RuleConditionSchema).min(1),
  /** Rule content (instructions to inject) */
  content: RuleContentSchema,
  /** Priority (higher = matched first, default: 0) */
  priority: z.number().optional(),
  /** Enable/disable the rule (default: true) */
  enabled: z.boolean().optional(),
}).strict()

/** Conditional Rules Configuration */
export const ConditionalRulesConfigSchema = z.object({
  /** AGENTS.md discovery settings */
  agents_md: AgentsMdConfigSchema.partial().default({}),
  /** Config-defined conditional rules */
  conditional_rules: z.array(ConfigRuleSchema).optional(),
}).strict()

// ============================================================================
// Session Reference Configuration (defined before Session Handoff to allow nesting)
// ============================================================================

/** Resolution options for session references */
export const SessionReferenceResolveOptionsSchema = z.object({
  /** Prefer handoff over raw session data (default: true) */
  prefer_handoff: z.boolean().default(true),
  /** Fall back to session if handoff missing (default: true) */
  allow_session_fallback: z.boolean().default(true),
  /** Create handoff on-demand if missing (default: false) */
  create_handoff_if_missing: z.boolean().default(false),
  /** Maximum results for semantic search (default: 5) */
  max_results: z.number().min(1).max(20).default(5),
  /** Minimum relevance score for semantic results (default: 0.3) */
  min_relevance: z.number().min(0).max(1).default(0.3),
}).strict()

/** Session Reference Configuration - @session:id syntax for referencing previous sessions */
export const SessionReferenceConfigSchema = z.object({
  /** Enable @session reference syntax (default: true) */
  enabled: z.boolean().default(true),
  /** Strip @session references from prompt after resolution (default: false - keep for context) */
  strip_from_prompt: z.boolean().default(false),
  /** Resolution options */
  resolve_options: SessionReferenceResolveOptionsSchema.default({
    prefer_handoff: true,
    allow_session_fallback: true,
    create_handoff_if_missing: false,
    max_results: 5,
    min_relevance: 0.3,
  }),
}).strict()

// ============================================================================
// Session Handoff Configuration
// ============================================================================

/** Extractor configuration for session handoff */
export const HandoffExtractorConfigSchema = z.object({
  /** Model for extraction (haiku is cost-effective) */
  model: z.enum(["haiku", "sonnet", "opus"]).default("haiku"),
  /** Maximum decisions to extract */
  max_decisions: z.number().min(1).max(20).default(10),
  /** Maximum artifacts to track */
  max_artifacts: z.number().min(1).max(50).default(20),
  /** Generate embedding index for semantic search */
  generate_embeddings: z.boolean().default(true),
}).strict()

/** Session Handoff Configuration - knowledge transfer between sessions */
export const SessionAutoHandoffConfigSchema = z.object({
  /** Enable automatic handoff trigger from orchestrator signals (default: true) */
  enabled: z.boolean().default(true),
  /** Trigger threshold: consecutive verifier denials (default: 2) */
  trigger_verifier_denials: z.number().min(1).max(20).default(2),
  /** Trigger threshold: consecutive context pressure hits (default: 2) */
  trigger_context_pressure_hits: z.number().min(1).max(20).default(2),
  /** Trigger threshold: consecutive continuation prompt failures (default: 2) */
  trigger_prompt_failures: z.number().min(1).max(20).default(2),
  /** Cooldown between auto handoff triggers in milliseconds (default: 10 minutes) */
  cooldown_ms: z.number().min(60_000).max(86_400_000).default(600_000),
  /** Auto handoff launch mode */
  launch_mode: z.enum(["auto", "preview"]).default("auto"),
  /** Stop continuation loop when auto handoff is launched (default: true) */
  stop_continuation_on_launch: z.boolean().default(true),
}).strict()

/** Session Handoff Configuration - knowledge transfer between sessions */
export const SessionHandoffConfigSchema = z.object({
  /** Enable session handoff feature (default: true) */
  enabled: z.boolean().default(true),
  /** Automatically extract handoff on session end (default: true) */
  auto_extract: z.boolean().default(true),
  /** Automatically inject relevant handoffs on session start (default: true) */
  auto_inject: z.boolean().default(true),
  /** Minimum messages for auto-extraction (default: 5) */
  min_messages_for_extract: z.number().min(1).max(50).default(5),
  /** Minimum file modifications for auto-extraction - prevents chat-only sessions from generating handoffs (default: 1) */
  min_file_changes_for_extract: z.number().min(0).max(20).default(1),
  /** Maximum handoffs to inject (default: 3) */
  max_inject_count: z.number().min(1).max(10).default(3),
  /** Handoff expiration in days (default: 7) */
  expiry_days: z.number().min(1).max(90).default(7),
  /** Run extraction asynchronously in background - non-blocking (default: true) */
  async_extraction: z.boolean().default(true),
  /** Extractor configuration - use .default() on full schema to ensure nested defaults apply */
  extractor: HandoffExtractorConfigSchema.default({
    model: "haiku",
    max_decisions: 10,
    max_artifacts: 20,
    generate_embeddings: true,
  }),
  /** Auto handoff trigger policy */
  auto_handoff: SessionAutoHandoffConfigSchema.default({
    enabled: true,
    trigger_verifier_denials: 2,
    trigger_context_pressure_hits: 2,
    trigger_prompt_failures: 2,
    cooldown_ms: 600_000,
    launch_mode: "auto",
    stop_continuation_on_launch: true,
  }),
  /** Session reference configuration (@session:id syntax). */
  reference: SessionReferenceConfigSchema.optional(),
}).strict()

/** Default session handoff configuration - parsed from schema to ensure consistency */
export const DEFAULT_SESSION_HANDOFF_CONFIG = SessionHandoffConfigSchema.parse({})

/** Default session reference configuration - parsed from schema to ensure nested defaults apply */
export const DEFAULT_SESSION_REFERENCE_CONFIG = SessionReferenceConfigSchema.parse({})

export const OhMyOpenCodeConfigSchema = z.object({
  /** Required config schema/runtime version. Must equal CURRENT_CONFIG_VERSION. */
  config_version: z.literal(CURRENT_CONFIG_VERSION),
  /** Hook-first policy architecture generation. */
  architecture_version: z.literal(2),
  $schema: z.string().optional(),
  /** Default agent name for `oh-my-opencode run` (env: OPENCODE_DEFAULT_AGENT) */
  default_run_agent: z.string().optional(),
  disabled_mcps: z.array(AnyMcpNameSchema).optional(),
  disabled_agents: z.array(BuiltinAgentNameSchema).optional(),
  disabled_skills: z.array(BuiltinSkillNameSchema).optional(),
  /** Tool names to hide from runtime tool registry (exact-match). */
  disabled_tools: z.array(z.string()).optional(),
  disabled_hooks: z.array(HookNameSchema).optional(),
  disabled_commands: z.array(BuiltinCommandNameSchema).optional(),
  agents: AgentOverridesSchema.optional(),
  categories: CategoriesConfigSchema.optional(),
  claude_code: ClaudeCodeConfigSchema.optional(),
  sisyphus_agent: SisyphusAgentConfigSchema.optional(),
  cache_strategy: CacheStrategyConfigSchema.optional(),
  session_state_repair: SessionStateRepairConfigSchema.optional(),
  comment_checker: CommentCheckerConfigSchema.optional(),
  auto_update: z.boolean().optional(),
  skills: SkillsConfigSchema.optional(),
  ralph_loop: RalphLoopConfigSchema.optional(),
  background_task: BackgroundTaskConfigSchema.optional(),
  parallel_runtime: ParallelRuntimeConfigSchema.optional(),
  work_orchestrator: WorkOrchestratorConfigSchema.optional(),
  notification: NotificationConfigSchema.optional(),
  git_master: GitMasterConfigSchema.optional(),
  silent_tool_output: SilentToolOutputConfigSchema.optional(),
  cartography: CartographyConfigSchema.optional(),
  codemap_injector: CodemapInjectorConfigSchema.optional(),
  repo_overview: RepoOverviewConfigSchema.optional(),
  runtime_tracker: RuntimeTrackerConfigSchema.optional(),
  user_memory: UserMemoryConfigSchema.optional(),
  org_memory: OrgMemoryConfigSchema.optional(),
  contracts: ContractConfigSchema.optional(),
  model_policy: ModelPolicySchema.optional(),
  budget_profiles: z.record(z.string(), BudgetProfileSchema).optional(),
  evaluator: EvaluatorConfigSchema.optional(),
  governance: GovernanceConfigSchema.optional(),
  /** Conditional rules configuration for path-sensitive rule injection */
  conditional_rules: ConditionalRulesConfigSchema.optional(),
  /** Session handoff configuration for cross-session knowledge transfer */
  session_handoff: SessionHandoffConfigSchema.optional(),
  /** Tmux parallel agents configuration for auto-creating tmux windows */
  tmux_parallel_agents: TmuxParallelAgentsConfigSchema.optional(),
  /** Sisyphus Tasks & Swarm configuration */
  sisyphus: SisyphusConfigSchema.optional(),
  /** Timeout in ms for loadAllPluginComponents during config handler init (default: 10000, min: 1000) */
  plugin_load_timeout_ms: z.number().min(1000).optional(),
  /** Wrap hook creation in try/catch to prevent one failing hook from crashing the plugin (default: true) */
  safe_hook_creation: z.boolean().optional(),
}).strict()

export type OhMyOpenCodeConfig = z.infer<typeof OhMyOpenCodeConfigSchema>
export type AgentOverrideConfig = z.infer<typeof AgentOverrideConfigSchema>
export type AgentOverrides = z.infer<typeof AgentOverridesSchema>
export type BackgroundTaskConfig = z.infer<typeof BackgroundTaskConfigSchema>
export type ParallelRuntimeMode = z.infer<typeof ParallelRuntimeModeSchema>
export type ParallelRuntimeConfig = z.infer<typeof ParallelRuntimeConfigSchema>
export type ContinuationControlPriority = z.infer<typeof ContinuationControlPrioritySchema>
export type ContinuationControlConfig = z.infer<typeof ContinuationControlConfigSchema>
export type VerifierGateConfig = z.infer<typeof VerifierGateConfigSchema>
export type DiscoveryMarkerMode = z.infer<typeof DiscoveryMarkerModeSchema>
export type DiscoveryChannelConfig = z.infer<typeof DiscoveryChannelConfigSchema>
export type WorkOrchestratorConfig = z.infer<typeof WorkOrchestratorConfigSchema>
export type TmuxLayout = z.infer<typeof TmuxLayoutSchema>
export type TmuxParallelAgentsConfig = z.infer<typeof TmuxParallelAgentsConfigSchema>
export type AgentName = z.infer<typeof AgentNameSchema>
export type HookName = z.infer<typeof HookNameSchema>
export type BuiltinCommandName = z.infer<typeof BuiltinCommandNameSchema>
export type BuiltinSkillName = z.infer<typeof BuiltinSkillNameSchema>
export type SisyphusAgentConfig = z.infer<typeof SisyphusAgentConfigSchema>
export type CommentCheckerConfig = z.infer<typeof CommentCheckerConfigSchema>
export type SessionStateRepairConfig = z.infer<typeof SessionStateRepairConfigSchema>
export type CacheStrategyConfig = z.infer<typeof CacheStrategyConfigSchema>
export type CacheStrategyProviderPolicyMode = z.infer<typeof CacheStrategyProviderPolicyModeSchema>
export type HookPoint = z.infer<typeof HookPointSchema>
export type ContractClause = z.infer<typeof ContractClauseSchema>
export type ContractConfig = z.infer<typeof ContractConfigSchema>
export type BudgetProfile = z.infer<typeof BudgetProfileSchema>
export type EvaluatorConfig = z.infer<typeof EvaluatorConfigSchema>
export type ModelPolicy = z.infer<typeof ModelPolicySchema>
export type SkillsConfig = z.infer<typeof SkillsConfigSchema>
export type SkillDefinition = z.infer<typeof SkillDefinitionSchema>
export type RalphLoopConfig = z.infer<typeof RalphLoopConfigSchema>
export type NotificationConfig = z.infer<typeof NotificationConfigSchema>
export type CategoryConfig = z.infer<typeof CategoryConfigSchema>
export type CategoriesConfig = z.infer<typeof CategoriesConfigSchema>
export type BuiltinCategoryName = z.infer<typeof BuiltinCategoryNameSchema>
export type GitMasterConfig = z.infer<typeof GitMasterConfigSchema>
export type PlanningWithFilesConfig = z.infer<typeof PlanningWithFilesConfigSchema>
export type SilentToolOutputConfig = z.infer<typeof SilentToolOutputConfigSchema>
export type CartographyConfig = z.infer<typeof CartographyConfigSchema>
export type CodemapInjectorConfig = z.infer<typeof CodemapInjectorConfigSchema>
export type RepoOverviewConfig = z.infer<typeof RepoOverviewConfigSchema>
export type RuntimeTrackerConfig = z.infer<typeof RuntimeTrackerConfigSchema>
export type UserMemoryConfig = z.infer<typeof UserMemoryConfigSchema>
export type OrgMemoryConfig = z.infer<typeof OrgMemoryConfigSchema>
export type HybridWeightsConfig = z.infer<typeof HybridWeightsConfigSchema>
export type EmbeddingConfigOverride = z.infer<typeof EmbeddingConfigOverrideSchema>
export type GovernanceConfig = z.infer<typeof GovernanceConfigSchema>
export type GovernanceToolCriticality = z.infer<typeof GovernanceToolCriticalitySchema>
export type AgentsMdConfig = z.infer<typeof AgentsMdConfigSchema>
export type GlobCondition = z.infer<typeof GlobConditionSchema>
export type DirectoryCondition = z.infer<typeof DirectoryConditionSchema>
export type ContentCondition = z.infer<typeof ContentConditionSchema>
export type ContextCondition = z.infer<typeof ContextConditionSchema>
export type RuleCondition = z.infer<typeof RuleConditionSchema>
export type ConfigRule = z.infer<typeof ConfigRuleSchema>
export type ConditionalRulesConfig = z.infer<typeof ConditionalRulesConfigSchema>
export type SessionHandoffConfig = z.infer<typeof SessionHandoffConfigSchema>
export type HandoffExtractorConfig = z.infer<typeof HandoffExtractorConfigSchema>
export type SessionAutoHandoffConfig = z.infer<typeof SessionAutoHandoffConfigSchema>
export type SessionReferenceConfig = z.infer<typeof SessionReferenceConfigSchema>
export type SessionReferenceResolveOptions = z.infer<typeof SessionReferenceResolveOptionsSchema>
export type SisyphusTasksConfig = z.infer<typeof SisyphusTasksConfigSchema>
export type SisyphusSwarmConfig = z.infer<typeof SisyphusSwarmConfigSchema>
export type SisyphusConfig = z.infer<typeof SisyphusConfigSchema>
export type BrowserAutomationProvider = z.infer<typeof BrowserAutomationProviderSchema>

export { AnyMcpNameSchema, type AnyMcpName, McpNameSchema, type McpName } from "../mcp/types"
