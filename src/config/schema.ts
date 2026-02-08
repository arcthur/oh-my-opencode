import { z } from "zod"
import { AnyMcpNameSchema, McpNameSchema } from "../mcp/types"

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
})

export const BuiltinAgentNameSchema = z.enum([
  "sisyphus",
  "oracle",
  "librarian",
  "explore",
  "multimodal-looker",
  "plan-synthesizer",
  "hephaestus",
])

export const BuiltinSkillNameSchema = z.enum([
  "playwright",
  "agent-browser",
  "frontend-ui-ux",
  "git-master",
  "parallel-agents",
  "dev-browser",
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
  "sisyphus-junior",
  "OpenCode-Builder",
  "prometheus",
  "oracle",
  "librarian",
  "explore",
  "multimodal-looker",
  "plan-synthesizer",
  "hephaestus",
])

export const AgentNameSchema = BuiltinAgentNameSchema

export const HookNameSchema = z.enum([
  "task-auto-continuation",
  "context-window-governor",
  "session-state-repair",
  "session-notification",
  "comment-checker",
  "tool-output-truncator",
  "directory-agents-injector",
  "directory-readme-injector",
  "empty-task-response-detector",
  "think-mode",
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
  "prometheus-md-only",
  "start-work",
  "swarm-from-plan",
  "execution-orchestrator",
  "multi-plan-trigger",
  "planning-with-files",
  "silent-tool-output",
  "context-manifest-injector",
  "repo-overview-injector",
  "runtime-tracker",
  "anti-slop-enforcer",
  "pre-completion-verification",
  "delegation-validate-decision",
  "conditional-rules",
  "session-handoff",
  "question-label-truncator",
  "delegation-block-subagent-question",
  "write-existing-file-guard",
  "continuation-stop-guard",
  "delegation-nudge-category-skill",
  "sisyphus-junior-notepad",
  "tmux-parallel-agents",
  "swarm-agent",
  "anthropic-effort",
])

export const BuiltinCommandNameSchema = z.enum([
  "init-deep",
  "ralph-loop",
  "ulw-loop",
  "cancel-ralph",
  "refactor",
  "start-work",
  "stop-continuation",
])

export const AgentOverrideConfigSchema = z.object({
  /** Model specification - single model string (arrays are only supported for Prometheus multi-plan) */
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
})

/** Prometheus override supports multi-model `model` arrays for multi-plan */
export const PrometheusOverrideConfigSchema = AgentOverrideConfigSchema.extend({
  model: z.union([z.string(), z.array(z.string()).max(5)]).optional(),
})

/** Multi-Plan Pipeline Configuration
 * Controls the unified planning pipeline that integrates:
 * - Intent classification (migrated from Metis)
 * - Deep verification (migrated from Momus)
 * - Complexity-based routing
 * - Smart interview skipping
 */
export const MultiPlanPipelineConfigSchema = z.object({
  /** Enable automatic complexity detection for single vs multi-model routing (default: true) */
  auto_complexity_detection: z.boolean().default(true),
  /** Enable smart interview skipping based on request clarity (default: true) */
  smart_skip_interview: z.boolean().default(true),
  /** Enable deep file verification in Plan Synthesizer (default: true) */
  deep_verification: z.boolean().default(true),
  /** Enable ADHD-omission detection in Plan Synthesizer (default: true) */
  adhd_detection: z.boolean().default(true),
})

export const AgentOverridesSchema = z.object({
  build: AgentOverrideConfigSchema.optional(),
  plan: AgentOverrideConfigSchema.optional(),
  sisyphus: AgentOverrideConfigSchema.optional(),
  "sisyphus-junior": AgentOverrideConfigSchema.optional(),
  "OpenCode-Builder": AgentOverrideConfigSchema.optional(),
  prometheus: PrometheusOverrideConfigSchema.optional(),
  oracle: AgentOverrideConfigSchema.optional(),
  librarian: AgentOverrideConfigSchema.optional(),
  explore: AgentOverrideConfigSchema.optional(),
  "multimodal-looker": AgentOverrideConfigSchema.optional(),
  "plan-synthesizer": AgentOverrideConfigSchema.optional(),
})

export const ClaudeCodeConfigSchema = z.object({
  mcp: z.boolean().optional(),
  commands: z.boolean().optional(),
  skills: z.boolean().optional(),
  agents: z.boolean().optional(),
  hooks: z.boolean().optional(),
  plugins: z.boolean().optional(),
  plugins_override: z.record(z.string(), z.boolean()).optional(),
})

export const SisyphusAgentConfigSchema = z.object({
  disabled: z.boolean().optional(),
  default_builder_enabled: z.boolean().optional(),
  planner_enabled: z.boolean().optional(),
  replace_plan: z.boolean().optional(),
})

export const CategoryConfigSchema = z.object({
  model: z.string().optional(),
  variant: z.string().optional(),
  temperature: z.number().min(0).max(2).optional(),
  top_p: z.number().min(0).max(1).optional(),
  maxTokens: z.number().optional(),
  thinking: z.object({
    type: z.enum(["enabled", "disabled"]),
    budgetTokens: z.number().optional(),
  }).optional(),
  reasoningEffort: z.enum(["low", "medium", "high", "xhigh"]).optional(),
  textVerbosity: z.enum(["low", "medium", "high"]).optional(),
  tools: z.record(z.string(), z.boolean()).optional(),
  prompt_append: z.string().optional(),
  /** Mark agent as unstable - forces background mode for monitoring. Auto-enabled for gemini models. */
  is_unstable_agent: z.boolean().optional(),
  /** Human-readable description for this category */
  description: z.string().optional(),
})

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
})

export const ExperimentalConfigSchema = z.object({
  aggressive_truncation: z.boolean().optional(),
  auto_resume: z.boolean().optional(),
  /** Truncate all tool outputs, not just whitelisted tools (default: false). Tool output truncator is enabled by default - disable via disabled_hooks. */
  truncate_all_tool_outputs: z.boolean().optional(),
})

export const ContextWindowGovernorRecoveryConfigSchema = z.object({
  max_attempts: z.number().min(1).max(10).default(2),
  initial_delay_ms: z.number().min(0).max(60_000).default(2000),
  max_delay_ms: z.number().min(0).max(300_000).default(30_000),
  toast_cooldown_ms: z.number().min(0).max(300_000).default(30_000),
})

export const ContextWindowGovernorConfigSchema = z.object({
  warning_ratio: z.number().min(0.1).max(0.95).default(0.7),
  preemptive_ratio: z.number().min(0.1).max(0.99).default(0.78),
  limit_ratio: z.number().min(0.5).max(1.5).default(1.0),
  warning_reset_ratio: z.number().min(0.05).max(0.9).default(0.65),
  preemptive_reset_ratio: z.number().min(0.05).max(0.95).default(0.73),
  recovery: ContextWindowGovernorRecoveryConfigSchema.default({
    max_attempts: 2,
    initial_delay_ms: 2000,
    max_delay_ms: 30000,
    toast_cooldown_ms: 30000,
  }),
})

export const SkillSourceSchema = z.union([
  z.string(),
  z.object({
    path: z.string(),
    recursive: z.boolean().optional(),
    glob: z.string().optional(),
  }),
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
})

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
})

export const BackgroundTaskConfigSchema = z.object({
  defaultConcurrency: z.number().min(1).optional(),
  providerConcurrency: z.record(z.string(), z.number().min(0)).optional(),
  modelConcurrency: z.record(z.string(), z.number().min(0)).optional(),
  /** Stale timeout in milliseconds - interrupt tasks with no activity for this duration (default: 180000 = 3 minutes, minimum: 60000 = 1 minute) */
  staleTimeoutMs: z.number().min(60000).optional(),
})

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
})

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
  /** Removed in latest-only mode: use storage_path only */
  claude_code_compat: z.never().optional(),
})

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
})

export const SisyphusConfigSchema = z.object({
  tasks: SisyphusTasksConfigSchema.optional(),
  swarm: SisyphusSwarmConfigSchema.optional(),
})

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
  }).optional(),
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
  }).optional(),
})

export const NotificationConfigSchema = z.object({
  /** Force enable session-notification even if external notification plugins are detected (default: false) */
  force_enable: z.boolean().optional(),
})

export const GitMasterConfigSchema = z.object({
  /** Add "Ultraworked with Sisyphus" footer to commit messages (default: true) */
  commit_footer: z.boolean().default(true),
  /** Add "Co-authored-by: Sisyphus" trailer to commit messages (default: true) */
  include_co_authored_by: z.boolean().default(true),
})

/** Planning with Files Configuration (Manus-style persistent planning) */
export const PlanningWithFilesConfigSchema = z.object({
  /** Enable the planning-with-files pattern (default: false) */
  enabled: z.boolean().default(false),
  /** Directory for planning files relative to .sisyphus/ (default: "plans") */
  directory: z.string().default("plans"),
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
  /** Auto-create planning files from multi-plan results (default: true) */
  auto_from_multi_plan: z.boolean().default(true),
})

/** Continuation control configuration - single-writer arbitration for idle continuation prompts */
export const ContinuationControlPrioritySchema = z.object({
  /** Highest priority: execution orchestrator continuation */
  "execution-orchestrator": z.number().min(0).max(1000).default(400),
  /** Ralph loop continuation */
  "ralph-loop": z.number().min(0).max(1000).default(300),
  /** Task continuation */
  "task-auto-continuation": z.number().min(0).max(1000).default(200),
  /** Planning stop-verification continuation */
  "planning-with-files": z.number().min(0).max(1000).default(100),
})

export const ContinuationControlConfigSchema = z.object({
  /** Grace period after session compaction before allowing continuation (default: 1500ms) */
  post_compaction_grace_ms: z.number().min(0).max(60_000).default(1500),
  /** Per-source priority for single-writer arbitration */
  priority: ContinuationControlPrioritySchema.default({
    "execution-orchestrator": 400,
    "ralph-loop": 300,
    "task-auto-continuation": 200,
    "planning-with-files": 100,
  }),
})

/** Default continuation-control configuration */
export const DEFAULT_CONTINUATION_CONTROL_CONFIG = ContinuationControlConfigSchema.parse({})

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
})

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
})

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
})

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
}).partial()

/** Entity Memory override configuration */
export const EntityMemoryConfigOverrideSchema = z.object({
  enabled: z.boolean(),
  max_entities: z.number().min(0).max(20000),
  max_relationships: z.number().min(0).max(100000),
  min_mentions: z.number().min(1).max(1000),
  injection_confidence_threshold: z.number().min(0).max(1),
  extract_types: z.array(UserMemoryEntityTypeSchema),
}).partial()

/** Temporal Validity override configuration */
export const TemporalValidityConfigOverrideSchema = z.object({
  enabled: z.boolean(),
  staleness_threshold: z.number().min(0).max(1),
  decay_factor: z.number().min(0).max(1),
  include_expired: z.boolean(),
}).partial()

/** Size-based consolidation override configuration */
export const ConsolidationConfigOverrideSchema = z.object({
  enabled: z.boolean(),
  work_history_threshold: z.number().min(0).max(100000),
  weekly_summaries_threshold: z.number().min(0).max(100000),
  monthly_summaries_threshold: z.number().min(0).max(100000),
}).partial()

/** Semantic clustering override configuration */
export const SemanticClusteringConfigOverrideSchema = z.object({
  enabled: z.boolean(),
  high_confidence_threshold: z.number().min(0).max(1),
  candidate_threshold: z.number().min(0).max(1),
  max_llm_calls: z.number().min(0).max(1000),
  use_synonyms: z.boolean(),
  use_stemming: z.boolean(),
}).partial()

/** Hybrid search weights configuration */
const HybridWeightsObjectSchema = z.object({
  /** Weight for vector (semantic) similarity (default: 0.5) */
  vector: z.number().min(0).max(1).default(0.5),
  /** Weight for BM25 (keyword) similarity (default: 0.3) */
  bm25: z.number().min(0).max(1).default(0.3),
  /** Weight for Jaccard (n-gram/synonym) similarity (default: 0.2) */
  jaccard: z.number().min(0).max(1).default(0.2),
})

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
}).refine(
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
}).partial()

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
})

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
})

/**
 * Context budget configuration for controlling token allocation across context sources
 */
export const ContextBudgetConfigSchema = z.object({
  /** Total token budget for all injected context (default: 2000) */
  total_budget: z.number().min(500).max(10000).default(2000),
  /** Reserved token budget for high/critical injections (default: 400) */
  reserved_budget: z.number().min(0).max(10000).default(400),
  /** Per-source token limits */
  source_limits: z.record(z.string(), z.number().min(1)).optional(),
  /** Per-channel token limits */
  channel_limits: z.object({
    "messages-transform": z.number().optional(),
    "tool-output": z.number().optional(),
    "chat-message": z.number().optional(),
    "delegate-prompt": z.number().optional(),
    "synthetic-message": z.number().optional(),
    "session-prompt": z.number().optional(),
  }).partial().optional(),
  /** Overflow strategy (default: drop-low-priority) */
  overflow_strategy: z.enum(["truncate", "drop-low-priority"]).default("drop-low-priority"),
})

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
})

/** Governance Configuration - approval, tracing, budget, checkpoints */
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
  }).partial().optional(),

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
  }).partial().optional(),

  /** Budget Monitor Configuration */
  budget_monitor: z.object({
    /** Enable budget monitoring (default: true when governance enabled) */
    enabled: z.boolean().default(true),
    /** Warn threshold - triggers GC/convergence hints (default: 0.7) */
    warn_threshold: z.number().min(0.3).max(0.95).default(0.7),
    /** Refactor threshold - triggers fork suggestion (default: 0.85) */
    refactor_threshold: z.number().min(0.5).max(0.95).default(0.85),
    /** Removed in latest-only mode: use refactor_threshold */
    gc_threshold: z.never().optional(),
    /** Hard limit threshold - triggers budget exhausted guardrail (default: 0.95) */
    hard_limit: z.number().min(0.7).max(0.99).default(0.95),
    /** Context window size estimate (default: 200000) */
    context_window_size: z.number().min(50000).max(1000000).default(200000),
  }).partial().optional(),

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
  }).partial().optional(),

  /** Ledger Configuration */
  ledger: z.object({
    /** Enable governance ledger for audit logging (default: true when governance enabled) */
    enabled: z.boolean().default(true),
    /** Base directory for ledger files (default: ~/.sisyphus/ledger) */
    base_dir: z.string().optional(),
    /** Retention days for ledger entries (default: 30) */
    retention_days: z.number().min(1).max(365).default(30),
  }).partial().optional(),
})

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
})

/** Glob condition - matches file paths against glob pattern */
export const GlobConditionSchema = z.object({
  type: z.literal("glob"),
  /** Glob pattern (e.g., "**\/*.ts", "src/components/**") */
  pattern: z.string(),
  /** If true (default), rule matches if ANY file matches. If false, ALL files must match. */
  matchAny: z.boolean().optional(),
})

/** Directory condition - matches files within a directory */
export const DirectoryConditionSchema = z.object({
  type: z.literal("directory"),
  /** Directory path relative to project root */
  path: z.string(),
  /** If true (default), includes subdirectories */
  recursive: z.boolean().optional(),
})

/** Content condition - matches files containing specific patterns */
export const ContentConditionSchema = z.object({
  type: z.literal("content"),
  /** Regex pattern to search in file content */
  pattern: z.string(),
  /** Only check files already matched by other conditions (default: true) */
  relevantFilesOnly: z.boolean().optional(),
})

/** Context matcher for context conditions */
export const ContextMatcherSchema = z.union([
  z.object({ agent: z.string() }),
  z.object({ category: z.string() }),
  z.object({ task: z.enum(["planning", "implementation", "review", "debugging"]) }),
  z.object({ skill: z.string() }),
])

/** Context condition - matches execution context */
export const ContextConditionSchema = z.object({
  type: z.literal("context"),
  /** Context to match */
  match: ContextMatcherSchema,
})

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
  }),
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
})

/** Conditional Rules Configuration */
export const ConditionalRulesConfigSchema = z.object({
  /** AGENTS.md discovery settings */
  agents_md: AgentsMdConfigSchema.partial().default({}),
  /** Config-defined conditional rules */
  conditional_rules: z.array(ConfigRuleSchema).optional(),
})

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
})

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
})

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
})

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
  /** Session reference configuration (@session:id syntax). */
  reference: SessionReferenceConfigSchema.optional(),
})

/** Default session handoff configuration - parsed from schema to ensure consistency */
export const DEFAULT_SESSION_HANDOFF_CONFIG = SessionHandoffConfigSchema.parse({})

/** Default session reference configuration - parsed from schema to ensure nested defaults apply */
export const DEFAULT_SESSION_REFERENCE_CONFIG = SessionReferenceConfigSchema.parse({})

export const OhMyOpenCodeConfigSchema = z.object({
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
  context_window_governor: ContextWindowGovernorConfigSchema.optional(),
  comment_checker: CommentCheckerConfigSchema.optional(),
  experimental: ExperimentalConfigSchema.optional(),
  auto_update: z.boolean().optional(),
  skills: SkillsConfigSchema.optional(),
  ralph_loop: RalphLoopConfigSchema.optional(),
  background_task: BackgroundTaskConfigSchema.optional(),
  parallel_runtime: ParallelRuntimeConfigSchema.optional(),
  continuation_control: ContinuationControlConfigSchema.optional(),
  notification: NotificationConfigSchema.optional(),
  git_master: GitMasterConfigSchema.optional(),
  planning_with_files: PlanningWithFilesConfigSchema.optional(),
  silent_tool_output: SilentToolOutputConfigSchema.optional(),
  repo_overview: RepoOverviewConfigSchema.optional(),
  runtime_tracker: RuntimeTrackerConfigSchema.optional(),
  user_memory: UserMemoryConfigSchema.optional(),
  org_memory: OrgMemoryConfigSchema.optional(),
  multi_plan_pipeline: MultiPlanPipelineConfigSchema.optional(),
  context_budget: ContextBudgetConfigSchema.optional(),
  governance: GovernanceConfigSchema.optional(),
  /** Conditional rules configuration for path-sensitive rule injection */
  conditional_rules: ConditionalRulesConfigSchema.optional(),
  /** Session handoff configuration for cross-session knowledge transfer */
  session_handoff: SessionHandoffConfigSchema.optional(),
  /** Tmux parallel agents configuration for auto-creating tmux windows */
  tmux_parallel_agents: TmuxParallelAgentsConfigSchema.optional(),
  /** Sisyphus Tasks & Swarm configuration */
  sisyphus: SisyphusConfigSchema.optional(),
})

export type OhMyOpenCodeConfig = z.infer<typeof OhMyOpenCodeConfigSchema>
export type AgentOverrideConfig = z.infer<typeof AgentOverrideConfigSchema>
export type AgentOverrides = z.infer<typeof AgentOverridesSchema>
export type BackgroundTaskConfig = z.infer<typeof BackgroundTaskConfigSchema>
export type ParallelRuntimeMode = z.infer<typeof ParallelRuntimeModeSchema>
export type ParallelRuntimeConfig = z.infer<typeof ParallelRuntimeConfigSchema>
export type ContinuationControlPriority = z.infer<typeof ContinuationControlPrioritySchema>
export type ContinuationControlConfig = z.infer<typeof ContinuationControlConfigSchema>
export type TmuxLayout = z.infer<typeof TmuxLayoutSchema>
export type TmuxParallelAgentsConfig = z.infer<typeof TmuxParallelAgentsConfigSchema>
export type AgentName = z.infer<typeof AgentNameSchema>
export type HookName = z.infer<typeof HookNameSchema>
export type BuiltinCommandName = z.infer<typeof BuiltinCommandNameSchema>
export type BuiltinSkillName = z.infer<typeof BuiltinSkillNameSchema>
export type SisyphusAgentConfig = z.infer<typeof SisyphusAgentConfigSchema>
export type CommentCheckerConfig = z.infer<typeof CommentCheckerConfigSchema>
export type ExperimentalConfig = z.infer<typeof ExperimentalConfigSchema>
export type ContextWindowGovernorConfig = z.infer<typeof ContextWindowGovernorConfigSchema>
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
export type RepoOverviewConfig = z.infer<typeof RepoOverviewConfigSchema>
export type RuntimeTrackerConfig = z.infer<typeof RuntimeTrackerConfigSchema>
export type UserMemoryConfig = z.infer<typeof UserMemoryConfigSchema>
export type OrgMemoryConfig = z.infer<typeof OrgMemoryConfigSchema>
export type MultiPlanPipelineConfig = z.infer<typeof MultiPlanPipelineConfigSchema>
export type ContextBudgetConfig = z.infer<typeof ContextBudgetConfigSchema>
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
export type SessionReferenceConfig = z.infer<typeof SessionReferenceConfigSchema>
export type SessionReferenceResolveOptions = z.infer<typeof SessionReferenceResolveOptionsSchema>
export type SisyphusTasksConfig = z.infer<typeof SisyphusTasksConfigSchema>
export type SisyphusSwarmConfig = z.infer<typeof SisyphusSwarmConfigSchema>
export type SisyphusConfig = z.infer<typeof SisyphusConfigSchema>
export type BrowserAutomationProvider = z.infer<typeof BrowserAutomationProviderSchema>

export { AnyMcpNameSchema, type AnyMcpName, McpNameSchema, type McpName } from "../mcp/types"
