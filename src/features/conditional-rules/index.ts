/**
 * Conditional Rules Module
 *
 * Path-sensitive rule injection based on working context.
 * Rules can be sourced from AGENTS.md files or configuration.
 *
 * Features:
 * - AGENTS.md discovery with conditional includes
 * - Config-driven rules with glob/directory/content/context conditions
 * - Automatic injection on file operations
 * - Rule appending to delegate_task prompts
 */

// Type exports
export type {
  ConditionalRule,
  RuleSource,
  RuleCondition,
  GlobCondition,
  DirectoryCondition,
  ContentCondition,
  ContextCondition,
  ContextMatcher,
  TaskPhase,
  RuleMatchContext,
  MatchedRule,
  ConditionMatchResult,
  ParsedAgentsMd,
  ConditionalBlock,
  AgentsMdConfig,
  ConfigRule,
  ConditionalRulesConfig,
} from "./types"

// Constant exports
export { DEFAULT_AGENTS_MD_CONFIG, DEFAULT_CONDITIONAL_RULES_CONFIG } from "./types"

// Parser exports
export { parseAgentsMd, discoverAgentsMdFiles, getAgentsMdDirectory, readAgentsMd } from "./agents-md-parser"

// Matcher exports
export { RuleMatcher, formatRulesForInjection, formatRulesForDelegation } from "./matcher"

// Loader exports
export { loadAllRules, extractFileMentions, shouldReloadRules } from "./loader"

// Hook exports
export {
  createFileToolsHook,
  createDelegateTaskHook,
  createConditionalRulesHooks,
  clearConditionalRulesCache,
  reloadRules,
  type ConditionalRulesHookContext,
} from "./hook"
