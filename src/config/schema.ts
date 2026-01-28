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
  "Sisyphus",
  "oracle",
  "librarian",
  "explore",
  "multimodal-looker",
  "Atlas",
  "plan-synthesizer",
])

export const BuiltinSkillNameSchema = z.enum([
  "playwright",
  "frontend-ui-ux",
  "git-master",
  "spec-compliance-review",
  "code-quality-review",
  "writing-plans",
  "systematic-debugging",
  "code-simplifier",
])

export const OverridableAgentNameSchema = z.enum([
  "build",
  "plan",
  "Sisyphus",
  "Sisyphus-Junior",
  "OpenCode-Builder",
  "Prometheus",
  "oracle",
  "librarian",
  "explore",
  "multimodal-looker",
  "Atlas",
  "plan-synthesizer",
])

export const AgentNameSchema = BuiltinAgentNameSchema

export const HookNameSchema = z.enum([
  "todo-continuation-enforcer",
  "context-window-monitor",
  "session-recovery",
  "session-notification",
  "comment-checker",
  "grep-output-truncator",
  "tool-output-truncator",
  "directory-agents-injector",
  "directory-readme-injector",
  "empty-task-response-detector",
  "think-mode",
  "context-window-limit-recovery",
  "rules-injector",
  "background-notification",
  "auto-update-checker",
  "startup-toast",
  "keyword-detector",
  "agent-usage-reminder",
  "non-interactive-env",
  "interactive-bash-session",

  "thinking-block-validator",
  "ralph-loop",

  "compaction-context-injector",
  "claude-code-hooks",
  "auto-slash-command",
  "edit-error-recovery",
  "delegate-task-retry",
  "prometheus-md-only",
  "start-work",
  "atlas",
  "multi-plan-trigger",
  "planning-with-files",
  "silent-tool-output",
  "repo-overview-injector",
  "runtime-tracker",
  "anti-slop-enforcer",
  "pre-completion-verification",
  "delegation-validator",
])

export const BuiltinCommandNameSchema = z.enum([
  "init-deep",
  "start-work",
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
  Sisyphus: AgentOverrideConfigSchema.optional(),
  "Sisyphus-Junior": AgentOverrideConfigSchema.optional(),
  "OpenCode-Builder": AgentOverrideConfigSchema.optional(),
  "Prometheus": PrometheusOverrideConfigSchema.optional(),
  oracle: AgentOverrideConfigSchema.optional(),
  librarian: AgentOverrideConfigSchema.optional(),
  explore: AgentOverrideConfigSchema.optional(),
  "multimodal-looker": AgentOverrideConfigSchema.optional(),
  Atlas: AgentOverrideConfigSchema.optional(),
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
  reasoningEffort: z.enum(["low", "medium", "high"]).optional(),
  textVerbosity: z.enum(["low", "medium", "high"]).optional(),
  tools: z.record(z.string(), z.boolean()).optional(),
  prompt_append: z.string().optional(),
  /** Mark agent as unstable - forces background mode for monitoring. Auto-enabled for gemini models. */
  is_unstable_agent: z.boolean().optional(),
})

export const BuiltinCategoryNameSchema = z.enum([
  "visual-engineering",
  "ultrabrain",
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

export const DynamicContextPruningConfigSchema = z.object({
  /** Enable dynamic context pruning (default: false) */
  enabled: z.boolean().default(false),
  /** Notification level: off, minimal, or detailed (default: detailed) */
  notification: z.enum(["off", "minimal", "detailed"]).default("detailed"),
  /** Turn protection - prevent pruning recent tool outputs */
  turn_protection: z.object({
    enabled: z.boolean().default(true),
    turns: z.number().min(1).max(10).default(3),
  }).optional(),
  /** Tools that should never be pruned */
  protected_tools: z.array(z.string()).default([
    "task", "todowrite", "todoread",
    "lsp_rename",
    "session_read", "session_write", "session_search",
  ]),
  /** Pruning strategies configuration */
  strategies: z.object({
    /** Remove duplicate tool calls (same tool + same args) */
    deduplication: z.object({
      enabled: z.boolean().default(true),
    }).optional(),
    /** Prune write inputs when file subsequently read */
    supersede_writes: z.object({
      enabled: z.boolean().default(true),
      /** Aggressive mode: prune any write if ANY subsequent read */
      aggressive: z.boolean().default(false),
    }).optional(),
    /** Prune errored tool inputs after N turns */
    purge_errors: z.object({
      enabled: z.boolean().default(true),
      turns: z.number().min(1).max(20).default(5),
    }).optional(),
    /** Clear tool results from older turns - safest form of compaction */
    clear_tool_results: z.object({
      enabled: z.boolean().default(true),
      /** Number of recent turns to keep full results (default: 5) */
      keep_recent_turns: z.number().min(1).max(20).default(5),
    }).optional(),
  }).optional(),
})

export const ExperimentalConfigSchema = z.object({
  aggressive_truncation: z.boolean().optional(),
  auto_resume: z.boolean().optional(),
  /** Enable preemptive compaction at threshold (default: true since v2.9.0) */
  preemptive_compaction: z.boolean().optional(),
  /** Threshold percentage to trigger preemptive compaction (default: 0.85) */
  preemptive_compaction_threshold: z.number().min(0.5).max(0.95).optional(),
  /** Truncate all tool outputs, not just whitelisted tools (default: false). Tool output truncator is enabled by default - disable via disabled_hooks. */
  truncate_all_tool_outputs: z.boolean().optional(),
  /** Dynamic context pruning configuration */
  dynamic_context_pruning: DynamicContextPruningConfigSchema.optional(),
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
  /** Custom state file directory relative to project root (default: .opencode/) */
  state_dir: z.string().optional(),
})

export const BackgroundTaskConfigSchema = z.object({
  defaultConcurrency: z.number().min(1).optional(),
  providerConcurrency: z.record(z.string(), z.number().min(1)).optional(),
  modelConcurrency: z.record(z.string(), z.number().min(1)).optional(),
  /** Stale timeout in milliseconds - interrupt tasks with no activity for this duration (default: 180000 = 3 minutes, minimum: 60000 = 1 minute) */
  staleTimeoutMs: z.number().min(60000).optional(),
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
  /** Enable auto re-read of task_plan before tool use (default: true) */
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

/** Hybrid search weights configuration - weights must sum to 1.0 */
export const HybridWeightsConfigSchema = z.object({
  /** Weight for vector (semantic) similarity (default: 0.5) */
  vector: z.number().min(0).max(1).default(0.5),
  /** Weight for BM25 (keyword) similarity (default: 0.3) */
  bm25: z.number().min(0).max(1).default(0.3),
  /** Weight for Jaccard (n-gram/synonym) similarity (default: 0.2) */
  jaccard: z.number().min(0).max(1).default(0.2),
}).refine(
  (w) => Math.abs(w.vector + w.bm25 + w.jaccard - 1) < 0.01,
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
  hybrid_weights: HybridWeightsConfigSchema.partial(),
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
  /** Per-source token limits */
  source_limits: z.object({
    "user-memory": z.number().optional(),
    "org-memory": z.number().optional(),
    "planning-with-files": z.number().optional(),
    "keyword-detector": z.number().optional(),
    "rules-injector": z.number().optional(),
    "directory-agents": z.number().optional(),
    "directory-readme": z.number().optional(),
  }).partial().optional(),
  /** Overflow strategy (default: drop-low-priority) */
  overflow_strategy: z.enum(["truncate", "drop-low-priority"]).default("drop-low-priority"),
})

export const OhMyOpenCodeConfigSchema = z.object({
  $schema: z.string().optional(),
  disabled_mcps: z.array(AnyMcpNameSchema).optional(),
  disabled_agents: z.array(BuiltinAgentNameSchema).optional(),
  disabled_skills: z.array(BuiltinSkillNameSchema).optional(),
  disabled_hooks: z.array(HookNameSchema).optional(),
  disabled_commands: z.array(BuiltinCommandNameSchema).optional(),
  agents: AgentOverridesSchema.optional(),
  categories: CategoriesConfigSchema.optional(),
  claude_code: ClaudeCodeConfigSchema.optional(),
  sisyphus_agent: SisyphusAgentConfigSchema.optional(),
  comment_checker: CommentCheckerConfigSchema.optional(),
  experimental: ExperimentalConfigSchema.optional(),
  auto_update: z.boolean().optional(),
  skills: SkillsConfigSchema.optional(),
  ralph_loop: RalphLoopConfigSchema.optional(),
  background_task: BackgroundTaskConfigSchema.optional(),
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
})

export type OhMyOpenCodeConfig = z.infer<typeof OhMyOpenCodeConfigSchema>
export type AgentOverrideConfig = z.infer<typeof AgentOverrideConfigSchema>
export type AgentOverrides = z.infer<typeof AgentOverridesSchema>
export type BackgroundTaskConfig = z.infer<typeof BackgroundTaskConfigSchema>
export type AgentName = z.infer<typeof AgentNameSchema>
export type HookName = z.infer<typeof HookNameSchema>
export type BuiltinCommandName = z.infer<typeof BuiltinCommandNameSchema>
export type BuiltinSkillName = z.infer<typeof BuiltinSkillNameSchema>
export type SisyphusAgentConfig = z.infer<typeof SisyphusAgentConfigSchema>
export type CommentCheckerConfig = z.infer<typeof CommentCheckerConfigSchema>
export type ExperimentalConfig = z.infer<typeof ExperimentalConfigSchema>
export type DynamicContextPruningConfig = z.infer<typeof DynamicContextPruningConfigSchema>
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

export { AnyMcpNameSchema, type AnyMcpName, McpNameSchema, type McpName } from "../mcp/types"
