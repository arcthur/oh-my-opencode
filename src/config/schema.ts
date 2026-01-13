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
  "frontend-ui-ux-engineer",
  "document-writer",
  "multimodal-looker",
  "Metis (Plan Consultant)",
  "Momus (Plan Reviewer)",
  "orchestrator-sisyphus",
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
  "Prometheus (Planner)",
  "Metis (Plan Consultant)",
  "Momus (Plan Reviewer)",
  "oracle",
  "librarian",
  "explore",
  "frontend-ui-ux-engineer",
  "document-writer",
  "multimodal-looker",
  "orchestrator-sisyphus",
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
  "anthropic-context-window-limit-recovery",
  "rules-injector",
  "background-notification",
  "auto-update-checker",
  "startup-toast",
  "keyword-detector",
  "agent-usage-reminder",
  "non-interactive-env",
  "interactive-bash-session",
  "empty-message-sanitizer",
  "thinking-block-validator",
  "ralph-loop",
  "preemptive-compaction",
  "compaction-context-injector",
  "claude-code-hooks",
  "auto-slash-command",
  "edit-error-recovery",
  "prometheus-md-only",
  "start-work",
  "sisyphus-orchestrator",
  "multi-plan-trigger",
  "planning-with-files",
  "silent-tool-output",
  "repo-overview-injector",
  "runtime-tracker",
  "anti-slop-enforcer",
  "pre-completion-verification",
])

export const BuiltinCommandNameSchema = z.enum([
  "init-deep",
  "start-work",
])

export const AgentOverrideConfigSchema = z.object({
  /** @deprecated Use `category` instead. Model is inherited from category defaults. */
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

/** Planning Agent Configuration
 * Consistent with other agent overrides: { model: "..." } or { model: ["...", "..."] }
 * - model: string → Single model for plan generation
 * - model: string[] → Multiple models for parallel generation + synthesis
 */
export const PlanningAgentConfigSchema = z.object({
  /** Model specification - string for single, array for multi-model planning */
  model: z.union([
    z.string(),
    z.array(z.string()).max(5),
  ]),
})

export const AgentOverridesSchema = z.object({
  build: AgentOverrideConfigSchema.optional(),
  plan: AgentOverrideConfigSchema.optional(),
  Sisyphus: AgentOverrideConfigSchema.optional(),
  "Sisyphus-Junior": AgentOverrideConfigSchema.optional(),
  "OpenCode-Builder": AgentOverrideConfigSchema.optional(),
  "Prometheus (Planner)": AgentOverrideConfigSchema.optional(),
  "Metis (Plan Consultant)": AgentOverrideConfigSchema.optional(),
  "Momus (Plan Reviewer)": AgentOverrideConfigSchema.optional(),
  oracle: AgentOverrideConfigSchema.optional(),
  librarian: AgentOverrideConfigSchema.optional(),
  explore: AgentOverrideConfigSchema.optional(),
  "frontend-ui-ux-engineer": AgentOverrideConfigSchema.optional(),
  "document-writer": AgentOverrideConfigSchema.optional(),
  "multimodal-looker": AgentOverrideConfigSchema.optional(),
  "orchestrator-sisyphus": AgentOverrideConfigSchema.optional(),
  "plan-synthesizer": AgentOverrideConfigSchema.optional(),
  /** Planning configuration: string (single model) or array (multi-model) */
  planning: PlanningAgentConfigSchema.optional(),
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
  model: z.string(),
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
})

export const BuiltinCategoryNameSchema = z.enum([
  "visual-engineering",
  "ultrabrain",
  "artistry",
  "quick",
  "most-capable",
  "writing",
  "general",
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
    "lsp_rename", "lsp_code_action_resolve",
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
  /** Enable DCP (Dynamic Context Pruning) for compaction - runs first when token limit exceeded (default: false) */
  dcp_for_compaction: z.boolean().optional(),
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
  google_auth: z.boolean().optional(),
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
export type PlanningAgentConfig = z.infer<typeof PlanningAgentConfigSchema>
export type PlanningWithFilesConfig = z.infer<typeof PlanningWithFilesConfigSchema>
export type SilentToolOutputConfig = z.infer<typeof SilentToolOutputConfigSchema>
export type RepoOverviewConfig = z.infer<typeof RepoOverviewConfigSchema>
export type RuntimeTrackerConfig = z.infer<typeof RuntimeTrackerConfigSchema>
export type UserMemoryConfig = z.infer<typeof UserMemoryConfigSchema>
export type OrgMemoryConfig = z.infer<typeof OrgMemoryConfigSchema>

export { AnyMcpNameSchema, type AnyMcpName, McpNameSchema, type McpName } from "../mcp/types"
