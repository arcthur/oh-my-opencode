import type { Plugin } from "@opencode-ai/plugin";
import type { Message, Part } from "@opencode-ai/sdk";
import {
  createTaskAutoContinuationHook,
  createUnstableAgentWatchdogHook,
  createContextWindowGovernorHook,
  createSessionStateRepairHook,
  createSessionNotification,
  createCommentCheckerHooks,
  createToolOutputTruncatorHook,
  createDirectoryAgentsInjectorHook,
  createDirectoryReadmeInjectorHook,
  createEmptyTaskResponseDetectorHook,
  createThinkModeHook,
  createClaudeCodeHooksHook,
  createRulesInjectorHook,
  createBackgroundNotificationHook,
  createAutoUpdateCheckerHook,
  createKeywordDetectorHook,
  createDelegationNudgeAgentUsageHook,
  createNonInteractiveEnvHook,
  createInteractiveBashSessionHook,

  createThinkingBlockValidatorHook,
  createRalphLoopHook,
  createAutoSlashCommandHook,
  createEditFailureGuidanceHook,
  createDelegationFailureGuidanceHook,
  createQuestionLabelTruncatorHook,
  createDelegationBlockSubagentQuestionHook,
  createWriteExistingFileGuardHook,
  createTaskResumeInfoHook,
  createStartWorkHook,
  createPrometheusMdOnlyHook,
  createSilentToolOutputHook,
  createRepoOverviewInjectorHook,
  createRuntimeTrackerHook,
  createContextManifestInjectorHook,
  createSwarmFromPlanHook,
  createAntiSlopEnforcerHook,
  createPreCompletionVerificationHook,
  createSisyphusContextualInjectorHook,
  createDelegationValidateDecisionHook,
  createDelegationNudgeCategorySkillHook,
  createSisyphusJuniorNotepadHook,
  createTmuxParallelAgentsHook,
  createConditionalRulesHooks,
  createSessionHandoffHook,
  createSwarmAgentHook,
  createAnthropicEffortHook,
  createCachePolicyHook,
  createWorkOrchestratorHook,
  type ContinuationIntent,
} from "./hooks";
import {
  EVENT_TOTAL_ORDER,
  HookRuntimeDispatcher,
  buildChatMessageNodes,
  buildUserPromptSubmitNodes,
  buildToolExecuteBeforeNodes,
  buildToolExecuteAfterNodes,
  buildEventNodes,
  buildExperimentalChatTransformNodes,
  buildExperimentalSessionCompactingNodes,
  getRuntimeRegistryEntries,
  isClaudeCodeBridgeEnabled,
  isHookEnabled as isRuntimeHookEnabled,
  validateRuntimeRegistry,
  type HookEventType,
  type HookNodeId,
  type RuntimeAssemblyContext,
  type ToolExecuteBeforeOutput,
  type ToolExecuteAfterOutput,
  type ExperimentalChatTransformOutput,
  type ExperimentalSessionCompactingInput,
  type ExperimentalSessionCompactingOutput,
  type RuntimeExecutionNode,
} from "./hooks/runtime";
import { createHandoffSummarizer } from "./features/session-handoff";
import {
  contextCollector,
  createContextInjectorMessagesTransformHook,
  clearPrefixFingerprintForSession,
} from "./features/context-injector";
import { createDefaultUserMemorySummarizer, createUserMemoryHook } from "./features/user-memory";
import { createOrgMemoryHook } from "./features/org-memory";
import { applyAgentVariant, resolveAgentVariant } from "./shared/agent-variant";
import { createFirstMessageVariantGate } from "./shared/first-message-variant";
import {
  discoverUserClaudeSkills,
  discoverProjectClaudeSkills,
  discoverOpencodeGlobalSkills,
  discoverOpencodeProjectSkills,
  mergeSkills,
} from "./features/opencode-skill-loader";
import type { SkillScope } from "./features/opencode-skill-loader/types";
import { createBuiltinSkills } from "./features/builtin-skills";
import { getSystemMcpServerNames } from "./features/claude-code-mcp-loader";
import type { AvailableSkill } from "./agents/dynamic-agent-prompt-builder";
import {
  setMainSession,
  getMainSessionID,
  updateSessionAgent,
  getSessionAgent,
  isSubagentSession,
} from "./features/claude-code-session-state";
import { sessionStateCoordinator } from "./features/session-state-coordinator";
import {
  builtinTools,
  createBackgroundTools,
  createLookAt,
  createSkillTool,
  createSkillMcpTool,
  createSlashcommandTool,
  discoverCommandsSync,
  sessionExists,
  createDelegateTask,
  createSwarmTool,
  createTaskGraphTools,
  interactive_bash,
  startTmuxCheck,
  lspManager,
} from "./tools";
import { BackgroundManager } from "./features/background-agent";
import { SkillMcpManager } from "./features/skill-mcp-manager";
import { initTaskToastManager } from "./features/task-toast-manager";
import { createSwarmRuntimeService } from "./features/sisyphus-swarm/runtime";
import { HookNameSchema, type HookName } from "./config";
import {
  log,
  detectExternalNotificationPlugin,
  getNotificationConflictWarning,
  resetMessageCursor,
  deepMerge,
  getOpenCodeVersion,
  isOpenCodeVersionAtLeast,
  OPENCODE_NATIVE_AGENTS_INJECTION_VERSION,
  OPENCODE_COMMAND_EXECUTE_BEFORE_HOOK_VERSION,
  OPENCODE_CHAT_HEADERS_HOOK_VERSION,
  OPENCODE_SHELL_ENV_HOOK_VERSION,
  applyProviderEnvCompat,
} from "./shared";
import { filterDisabledTools } from "./shared/disabled-tools";
import { safeCreateHook } from "./shared/safe-create-hook";
import { DEFAULT_CONDITIONAL_RULES_CONFIG } from "./features/conditional-rules";
import { DEFAULT_HANDOFF_CONFIG } from "./features/session-handoff";
import { loadPluginConfig } from "./plugin-config";
import { createModelCacheState } from "./plugin-state";
import { createConfigHandler } from "./plugin-handlers";
import type { MessageInput } from "./shared/hook-types";
import {
  DEFAULT_WORK_ORCHESTRATOR_CONFIG,
  DEFAULT_SESSION_REFERENCE_CONFIG,
} from "./config/schema"
import {
  cleanupAllGovernanceSessions,
  cleanupGovernanceSession,
  hasGovernanceSession,
  persistGovernanceTraceSnapshot,
  recordWorkOrchestratorTransition,
} from "./features/governance";
import { CATEGORY_DESCRIPTIONS } from "./tools/delegate-task/constants";
import { mergeCategories } from "./shared/merge-categories";
import { NON_INTERACTIVE_ENV } from "./hooks/non-interactive-env/constants";

type PluginHooks = Awaited<ReturnType<Plugin>>

interface CommandExecuteBeforeInput {
  command: string
  sessionID: string
  arguments: string
}

interface CommandExecuteBeforeOutput {
  parts: Part[]
}

interface ChatHeadersInput {
  sessionID: string
  agent: string
  model: Record<string, unknown>
  provider: Record<string, unknown>
  message: Record<string, unknown>
}

interface ChatHeadersOutput {
  headers: Record<string, string>
}

interface ShellEnvInput {
  cwd: string
}

interface ShellEnvOutput {
  env: Record<string, string>
}

type ExtendedPluginHooks = PluginHooks &
  Record<string, unknown> & {
  "command.execute.before"?: (
    input: CommandExecuteBeforeInput,
    output: CommandExecuteBeforeOutput
  ) => Promise<void>
  "chat.headers"?: (input: ChatHeadersInput, output: ChatHeadersOutput) => Promise<void>
  "shell.env"?: (input: ShellEnvInput, output: ShellEnvOutput) => Promise<void>
}

const COPILOT_INTERLEAVED_THINKING_HEADER = "interleaved-thinking-2025-05-14"

function appendHeaderToken(existingValue: string | undefined, token: string): string {
  if (!existingValue) {
    return token
  }

  const normalized = existingValue
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)

  if (normalized.includes(token)) {
    return normalized.join(", ")
  }

  return [...normalized, token].join(", ")
}

const OhMyOpenCodePlugin: Plugin = async (ctx) => {
  log("[oh-my-opencode] Plugin loading", { directory: ctx.directory });
  applyProviderEnvCompat(process.env)
  // Start background tmux check immediately
  startTmuxCheck();

  const pluginConfig = loadPluginConfig(ctx.directory, ctx);
  const disabledHooks = new Set(pluginConfig.disabled_hooks ?? []);
  const firstMessageVariantGate = createFirstMessageVariantGate();
  const isHookEnabled = (hookName: HookName) =>
    isRuntimeHookEnabled(disabledHooks, hookName);
  const safeHookEnabled = pluginConfig.safe_hook_creation ?? true;
  const workOrchestratorConfig = deepMerge(
    DEFAULT_WORK_ORCHESTRATOR_CONFIG,
    pluginConfig.work_orchestrator ?? {}
  ) as typeof DEFAULT_WORK_ORCHESTRATOR_CONFIG;
  const supportsCommandExecuteBefore = isOpenCodeVersionAtLeast(
    OPENCODE_COMMAND_EXECUTE_BEFORE_HOOK_VERSION
  )
  const supportsChatHeaders = isOpenCodeVersionAtLeast(OPENCODE_CHAT_HEADERS_HOOK_VERSION)
  const supportsShellEnv = isOpenCodeVersionAtLeast(OPENCODE_SHELL_ENV_HOOK_VERSION)

  const modelCacheState = createModelCacheState();
  let workOrchestrator: ReturnType<typeof createWorkOrchestratorHook> | null = null;

  const isContinuationStopped = (sessionID: string): boolean =>
    workOrchestrator?.isContinuationStopped(sessionID) ?? false;
  const getContinuationRound = (sessionID: string): number | undefined =>
    workOrchestrator?.getContinuationRound(sessionID)
  const reportContinuationIntent = async (intent: ContinuationIntent): Promise<void> => {
    await workOrchestrator?.reportContinuationIntent(intent)
  }

  const contextWindowGovernor = isHookEnabled("context-window-governor")
    ? createContextWindowGovernorHook(ctx, {
        modelCacheState,
        taskConfig: pluginConfig.sisyphus ? { sisyphus: pluginConfig.sisyphus } : undefined,
        warningRatio: pluginConfig.context_window_governor?.warning_ratio,
        preemptiveRatio: pluginConfig.context_window_governor?.preemptive_ratio,
        limitRatio: pluginConfig.context_window_governor?.limit_ratio,
        warningResetRatio: pluginConfig.context_window_governor?.warning_reset_ratio,
        preemptiveResetRatio: pluginConfig.context_window_governor?.preemptive_reset_ratio,
        recovery: pluginConfig.context_window_governor?.recovery
          ? {
              maxAttempts: pluginConfig.context_window_governor.recovery.max_attempts,
              initialDelayMs:
                pluginConfig.context_window_governor.recovery.initial_delay_ms,
              maxDelayMs: pluginConfig.context_window_governor.recovery.max_delay_ms,
              toastCooldownMs:
                pluginConfig.context_window_governor.recovery.toast_cooldown_ms,
              aggressiveOutputTruncation: {
                enabled:
                  pluginConfig.context_window_governor.recovery
                    .aggressive_output_truncation?.enabled ?? true,
                targetRatio:
                  pluginConfig.context_window_governor.recovery
                    .aggressive_output_truncation?.target_ratio ?? 0.8,
                charsPerToken:
                  pluginConfig.context_window_governor.recovery
                    .aggressive_output_truncation?.chars_per_token ?? 4,
                maxOutputs:
                  pluginConfig.context_window_governor.recovery
                    .aggressive_output_truncation?.max_outputs ?? 20,
                minOutputChars:
                  pluginConfig.context_window_governor.recovery
                    .aggressive_output_truncation?.min_output_chars ?? 500,
                keepRecentTurns:
                  pluginConfig.context_window_governor.recovery
                    .aggressive_output_truncation?.keep_recent_turns ?? 2,
                protectedTools:
                  pluginConfig.context_window_governor.recovery
                    .aggressive_output_truncation?.protected_tools ?? [
                    "task",
                    "task_update",
                    "task_get",
                    "lsp_rename",
                    "session_read",
                    "session_write",
                    "session_search",
                  ],
              },
            }
          : undefined,
        dynamicPruning: pluginConfig.context_window_governor?.dynamic_pruning
          ? {
              enabled: pluginConfig.context_window_governor.dynamic_pruning.enabled,
              notification:
                pluginConfig.context_window_governor.dynamic_pruning.notification,
              recoveryTargetRatio:
                pluginConfig.context_window_governor.dynamic_pruning
                  .recovery_target_ratio,
              charsPerToken:
                pluginConfig.context_window_governor.dynamic_pruning.chars_per_token,
              skipSummarizeIfRecovered:
                pluginConfig.context_window_governor.dynamic_pruning
                  .skip_summarize_if_recovered,
              protectedTools:
                pluginConfig.context_window_governor.dynamic_pruning.protected_tools,
              turnProtection: {
                enabled:
                  pluginConfig.context_window_governor.dynamic_pruning
                    .turn_protection?.enabled ?? true,
                turns:
                  pluginConfig.context_window_governor.dynamic_pruning
                    .turn_protection?.turns ?? 3,
              },
              strategies: {
                deduplication: {
                  enabled:
                    pluginConfig.context_window_governor.dynamic_pruning
                      .strategies?.deduplication?.enabled ?? true,
                },
                staleToolOutputs: {
                  enabled:
                    pluginConfig.context_window_governor.dynamic_pruning
                      .strategies?.stale_tool_outputs?.enabled ?? true,
                  keepRecentTurns:
                    pluginConfig.context_window_governor.dynamic_pruning
                      .strategies?.stale_tool_outputs
                      ?.keep_recent_turns ?? 6,
                  minOutputChars:
                    pluginConfig.context_window_governor.dynamic_pruning
                      .strategies?.stale_tool_outputs
                      ?.min_output_chars ?? 1200,
                  maxOutputs:
                    pluginConfig.context_window_governor.dynamic_pruning
                      .strategies?.stale_tool_outputs
                      ?.max_outputs ?? 6,
                },
              },
            }
          : undefined,
        prefixStability: pluginConfig.cache_strategy?.prefix_stability
          ? {
              mode: pluginConfig.cache_strategy.prefix_stability.mode,
              maxDestructiveRecoveries:
                pluginConfig.cache_strategy.prefix_stability
                  .max_destructive_recoveries,
              windowMs:
                pluginConfig.cache_strategy.prefix_stability.window_ms,
              cooldownMs:
                pluginConfig.cache_strategy.prefix_stability.cooldown_ms,
              hardLimitBypassRatio:
                pluginConfig.cache_strategy.prefix_stability
                  .hard_limit_bypass_ratio,
            }
          : undefined,
      })
    : null;
  const sessionStateRepair = isHookEnabled("session-state-repair")
    ? createSessionStateRepairHook(ctx, { config: pluginConfig.session_state_repair })
    : null;
  
  // Check for conflicting notification plugins before creating session-notification
  let sessionNotification: ReturnType<typeof createSessionNotification> | null = null;
  if (isHookEnabled("session-notification")) {
    const forceEnable = pluginConfig.notification?.force_enable ?? false;
    const externalNotifier = detectExternalNotificationPlugin(ctx.directory);
    
    if (externalNotifier.detected && !forceEnable) {
      // External notification plugin detected - skip our notification to avoid conflicts
      console.warn(getNotificationConflictWarning(externalNotifier.pluginName!));
      log("session-notification disabled due to external notifier conflict", {
        detected: externalNotifier.pluginName,
        allPlugins: externalNotifier.allPlugins,
      });
    } else {
      sessionNotification = createSessionNotification(ctx, undefined, pluginConfig);
    }
  }

  const commentChecker = isHookEnabled("comment-checker")
    ? safeCreateHook("comment-checker", () => createCommentCheckerHooks(pluginConfig.comment_checker), { enabled: safeHookEnabled })
    : null;
  const toolOutputTruncator = isHookEnabled("tool-output-truncator")
    ? createToolOutputTruncatorHook(ctx, {
        config: pluginConfig.tool_output_truncator,
      })
    : null;
  const silentToolOutput = isHookEnabled("silent-tool-output") && pluginConfig.silent_tool_output
    ? createSilentToolOutputHook(ctx, pluginConfig.silent_tool_output)
    : null;
  const repoOverviewInjector = isHookEnabled("repo-overview-injector")
    ? createRepoOverviewInjectorHook(ctx, pluginConfig.repo_overview)
    : null;
  const runtimeTracker = isHookEnabled("runtime-tracker")
    ? createRuntimeTrackerHook(ctx, pluginConfig.runtime_tracker)
    : null;
  // Check for native OpenCode AGENTS.md injection support before creating hook
  let directoryAgentsInjector = null;
  if (isHookEnabled("directory-agents-injector")) {
    const currentVersion = getOpenCodeVersion();
    const hasNativeSupport = currentVersion !== null &&
      isOpenCodeVersionAtLeast(OPENCODE_NATIVE_AGENTS_INJECTION_VERSION);

    if (hasNativeSupport) {
      console.warn(
        `[oh-my-opencode] directory-agents-injector hook auto-disabled: ` +
        `OpenCode ${currentVersion} has native AGENTS.md support (>= ${OPENCODE_NATIVE_AGENTS_INJECTION_VERSION})`
      );
      log("directory-agents-injector auto-disabled due to native OpenCode support", {
        currentVersion,
        nativeVersion: OPENCODE_NATIVE_AGENTS_INJECTION_VERSION,
      });
    } else {
      directoryAgentsInjector = safeCreateHook("directory-agents-injector", () => createDirectoryAgentsInjectorHook(ctx), { enabled: safeHookEnabled });
    }
  }
  const directoryReadmeInjector = isHookEnabled("directory-readme-injector")
    ? safeCreateHook("directory-readme-injector", () => createDirectoryReadmeInjectorHook(ctx), { enabled: safeHookEnabled })
    : null;
  const emptyTaskResponseDetector = isHookEnabled("empty-task-response-detector")
    ? createEmptyTaskResponseDetectorHook(ctx)
    : null;
  const thinkMode = isHookEnabled("think-mode") ? createThinkModeHook() : null;
  const anthropicEffort = isHookEnabled("anthropic-effort")
    ? createAnthropicEffortHook()
    : null;
  const cachePolicy = isHookEnabled("cache-policy")
    ? createCachePolicyHook(pluginConfig.cache_strategy)
    : null;
  const claudeCodeBridgeEnabled = isClaudeCodeBridgeEnabled({
    disabledHooks,
    claudeCodeHooksEnabled: pluginConfig.claude_code?.hooks,
  });
  const claudeCodeHooks = createClaudeCodeHooksHook(
    ctx,
    {
      disabledHooks: claudeCodeBridgeEnabled ? undefined : true,
      keywordDetectorDisabled: !isHookEnabled("keyword-detector"),
    },
    contextCollector
  );

  // Governance integration
  const governanceConfig = pluginConfig.governance;
  const governanceEnabled = governanceConfig?.enabled ?? false;
  const GOVERNANCE_BLOCK_PREFIX = "Governance blocked:";
  const onWorkOrchestratorTransition = governanceEnabled
    ? (transition: {
        sessionID: string
        phase: "planning" | "continuation" | "execution" | "lifecycle"
        action: string
        outcome: "accepted" | "rejected" | "applied" | "observed"
        reason?: string
        metadata?: Record<string, unknown>
      }) => {
        recordWorkOrchestratorTransition({
          sessionId: transition.sessionID,
          cwd: ctx.directory,
          phase: transition.phase,
          action: transition.action,
          outcome: transition.outcome,
          reason: transition.reason,
          metadata: transition.metadata,
          config: governanceConfig,
        })
      }
    : undefined
  if (governanceEnabled) {
    log("[governance] Integration enabled", {
      tracer: governanceConfig?.tracer?.enabled,
      budget_monitor: governanceConfig?.budget_monitor?.enabled,
      checkpoint: governanceConfig?.checkpoint?.enabled,
      ledger: governanceConfig?.ledger?.enabled,
    });
  }
  const rulesInjector = isHookEnabled("rules-injector")
    ? safeCreateHook("rules-injector", () => createRulesInjectorHook(ctx), { enabled: safeHookEnabled })
    : null;
  const autoUpdateChecker = isHookEnabled("auto-update-checker")
    ? safeCreateHook("auto-update-checker", () => createAutoUpdateCheckerHook(ctx, {
        showStartupToast: isHookEnabled("startup-toast"),
        isSisyphusEnabled: pluginConfig.sisyphus_agent?.disabled !== true,
        autoUpdate: pluginConfig.auto_update ?? true,
      }), { enabled: safeHookEnabled })
    : null;
  const keywordDetector = isHookEnabled("keyword-detector")
    ? createKeywordDetectorHook(ctx, contextCollector)
    : null;
  const contextInjectorMessagesTransform =
    createContextInjectorMessagesTransformHook(contextCollector, {
      compiler: pluginConfig.cache_strategy?.compiler
        ? {
            enabled: pluginConfig.cache_strategy.compiler.enabled,
            maxPrefixSegments:
              pluginConfig.cache_strategy.compiler.max_prefix_segments,
            maxPrefixChars:
              pluginConfig.cache_strategy.compiler.max_prefix_chars,
            separator: pluginConfig.cache_strategy.compiler.separator,
          }
        : { enabled: false },
    });

  // Configure context budget
  if (pluginConfig.context_budget) {
    contextCollector.setBudgetConfig({
      total_budget: pluginConfig.context_budget.total_budget ?? 2000,
      reserved_budget: pluginConfig.context_budget.reserved_budget,
      source_limits: pluginConfig.context_budget.source_limits,
      channel_limits: pluginConfig.context_budget.channel_limits,
      overflow_strategy: pluginConfig.context_budget.overflow_strategy ?? "drop-low-priority",
    })
  }

  contextCollector.configureLedger({
    enabled: pluginConfig.cache_strategy?.ledger?.enabled ?? false,
    baseDir: pluginConfig.cache_strategy?.ledger?.base_dir,
  })

  // Register feature handlers with session coordinator
  sessionStateCoordinator.registerFeature("context-collector", {
    onSessionDeleted(sessionID) {
      contextCollector.clearSession(sessionID)
      clearPrefixFingerprintForSession(sessionID)
    },
    onSessionCompacted(sessionID) {
      contextCollector.resetOncePerSession(sessionID)
      clearPrefixFingerprintForSession(sessionID)
    },
  })

  if (governanceEnabled) {
    sessionStateCoordinator.registerFeature("governance", {
      onSessionDeleted(sessionID) {
        try {
          cleanupGovernanceSession(sessionID)
        } catch (err) {
          log("[governance] Session cleanup error (non-fatal)", {
            sessionID,
            error: err instanceof Error ? err.message : String(err),
          })
        }
      },
      contributeMetadata(sessionID) {
        return {
          governanceActive: hasGovernanceSession(sessionID),
        }
      },
    })
  } else {
    sessionStateCoordinator.unregisterFeature("governance")
  }

  const userMemory = createUserMemoryHook(ctx, pluginConfig.user_memory, {
    summarizer: createDefaultUserMemorySummarizer(ctx, pluginConfig.user_memory, {
      categories: pluginConfig.categories,
    }),
    collector: contextCollector,
  });
  const orgMemory = createOrgMemoryHook(ctx, pluginConfig.org_memory, {
    collector: contextCollector,
  });
  const delegationNudgeAgentUsage = isHookEnabled("delegation-nudge-agent-usage")
    ? createDelegationNudgeAgentUsageHook(ctx)
    : null;
  const nonInteractiveEnv = isHookEnabled("non-interactive-env")
    ? createNonInteractiveEnvHook(ctx)
    : null;
  const interactiveBashSession = isHookEnabled("interactive-bash-session")
    ? createInteractiveBashSessionHook(ctx)
    : null;

  const thinkingBlockValidator = isHookEnabled("thinking-block-validator")
    ? createThinkingBlockValidatorHook()
    : null;

  const ralphLoop = isHookEnabled("ralph-loop")
    ? createRalphLoopHook(ctx, {
        config: pluginConfig.ralph_loop,
        checkSessionExists: async (sessionId) => sessionExists(sessionId),
        isContinuationStopped,
        getContinuationRound,
        reportContinuationIntent,
      })
    : null;

  const editFailureGuidance = isHookEnabled("edit-failure-guidance")
    ? createEditFailureGuidanceHook(ctx)
    : null;

  const delegationFailureGuidance = isHookEnabled("delegation-failure-guidance")
    ? createDelegationFailureGuidanceHook(ctx)
    : null;

  const startWork = isHookEnabled("start-work")
    ? createStartWorkHook(ctx, pluginConfig)
    : null;

  const swarmRuntime = createSwarmRuntimeService();

  const swarmFromPlan = isHookEnabled("swarm-from-plan")
    ? createSwarmFromPlanHook(ctx, pluginConfig, swarmRuntime)
    : null;

  const prometheusMdOnly = isHookEnabled("prometheus-md-only")
    ? createPrometheusMdOnlyHook(ctx)
    : null;

  const taskResumeInfo = createTaskResumeInfoHook();

  let tmuxParallelAgents: ReturnType<typeof createTmuxParallelAgentsHook> | null = null;
  const backgroundManager = new BackgroundManager(ctx, pluginConfig.background_task, {
    onShutdown: () => {
      tmuxParallelAgents?.cleanup();
      if (governanceEnabled) {
        try {
          cleanupAllGovernanceSessions()
        } catch (err) {
          log("[governance] Global session cleanup error (non-fatal)", {
            error: err instanceof Error ? err.message : String(err),
          })
        }
      }
    },
    parallelRuntimeConfig: pluginConfig.parallel_runtime ?? { enabled: true },
    taskConfig: pluginConfig,
  });

  initTaskToastManager(ctx.client);

  const questionLabelTruncator = isHookEnabled("question-label-truncator")
    ? createQuestionLabelTruncatorHook()
    : null;
  const delegationBlockSubagentQuestion = isHookEnabled("delegation-block-subagent-question")
    ? createDelegationBlockSubagentQuestionHook()
    : null;
  const writeExistingFileGuard = isHookEnabled("write-existing-file-guard")
    ? createWriteExistingFileGuardHook(ctx)
    : null;

  const taskAutoContinuationEnabled = isHookEnabled("task-auto-continuation");

  workOrchestrator = isHookEnabled("work-orchestrator")
    ? createWorkOrchestratorHook(ctx, {
        config: workOrchestratorConfig,
        collector: contextCollector,
        backgroundManager,
        taskConfig: pluginConfig,
        taskContinuationEnabled: taskAutoContinuationEnabled,
        onTransition: onWorkOrchestratorTransition,
      })
    : null;

  const contextManifestInjector = isHookEnabled("context-manifest-injector")
    ? createContextManifestInjectorHook(ctx)
    : null;

  const taskAutoContinuation = taskAutoContinuationEnabled
    ? createTaskAutoContinuationHook(ctx, {
        backgroundManager,
        taskConfig: pluginConfig,
        isContinuationStopped,
        getContinuationRound,
        reportContinuationIntent,
      })
    : null;

  const unstableAgentWatchdog = isHookEnabled("unstable-agent-watchdog") &&
    pluginConfig.background_task?.unstable_watchdog?.enabled !== false
    ? createUnstableAgentWatchdogHook(ctx, {
        backgroundManager,
        reportContinuationIntent,
        getContinuationRound,
        isContinuationStopped,
        timeoutMs: pluginConfig.background_task?.unstable_watchdog?.timeout_ms,
        cooldownMs: pluginConfig.background_task?.unstable_watchdog?.cooldown_ms,
        thinkingSummaryMaxChars:
          pluginConfig.background_task?.unstable_watchdog?.thinking_summary_max_chars,
      })
    : null;

  const antiSlopEnforcer = isHookEnabled("anti-slop-enforcer")
    ? createAntiSlopEnforcerHook(ctx)
    : null;

  const preCompletionVerification = isHookEnabled("pre-completion-verification")
    ? createPreCompletionVerificationHook(ctx, undefined, pluginConfig)
    : null;

  const sisyphusContextualInjector = isHookEnabled("sisyphus-contextual-injector")
    ? createSisyphusContextualInjectorHook(ctx)
    : null;

  const delegationValidateDecision = isHookEnabled("delegation-validate-decision")
    ? createDelegationValidateDecisionHook(ctx)
    : null;

  // Category-skill reminder: post-action nudge for orchestrators
  // Complements delegation-validate-decision (pre-tool validation)
  let delegationNudgeCategorySkill: ReturnType<typeof createDelegationNudgeCategorySkillHook> | null = null;

  // Sisyphus-junior notepad: dynamic injection of notepad context
  // Saves tokens by only injecting when delegating to sisyphus-junior
  const sisyphusJuniorNotepad = isHookEnabled("sisyphus-junior-notepad")
    ? createSisyphusJuniorNotepadHook(ctx)
    : null;

  // Tmux parallel agents: auto-create tmux windows for background tasks
  // Integrates with BackgroundManager lifecycle for visual monitoring
  tmuxParallelAgents = isHookEnabled("tmux-parallel-agents") && pluginConfig.tmux_parallel_agents?.enabled
    ? createTmuxParallelAgentsHook(ctx, pluginConfig.tmux_parallel_agents, {
        resolveTaskIdBySessionID: (sessionID: string) =>
          backgroundManager.findBySession(sessionID)?.tmuxTaskId,
      })
    : null;

  // Swarm agent: auto-initialize worker when running with OPENCODE_SWARM_* env vars
  // Enables multi-agent coordination via Sisyphus Swarm
  const swarmAgent = isHookEnabled("swarm-agent")
    ? createSwarmAgentHook(ctx, { config: pluginConfig, runtime: swarmRuntime })
    : null;

  // Conditional rules for path-sensitive rule injection
  // Deep merge user config with defaults to ensure all required fields are present
  const conditionalRulesConfig = deepMerge(
    DEFAULT_CONDITIONAL_RULES_CONFIG,
    pluginConfig.conditional_rules ?? {}
  ) as import("./features/conditional-rules").ConditionalRulesConfig
  const conditionalRulesHooks = isHookEnabled("conditional-rules")
    ? createConditionalRulesHooks({ config: conditionalRulesConfig })
    : null;

  // Session handoff for cross-session knowledge transfer
  // Deep merge user config with defaults to ensure all required fields are present
  const sessionHandoffConfig = deepMerge(
    DEFAULT_HANDOFF_CONFIG,
    pluginConfig.session_handoff ?? {}
  ) as import("./features/session-handoff").SessionHandoffConfig

  const sessionReferenceConfig = deepMerge(
    DEFAULT_SESSION_REFERENCE_CONFIG,
    pluginConfig.session_handoff?.reference ?? {}
  )

  // Lazy embedding provider (reuses user-memory embedding provider selection)
  const embedForHandoff = (() => {
    let providerPromise: Promise<import("./features/user-memory/embeddings/types").EmbeddingProvider> | null = null
    return async (texts: string[]): Promise<number[][]> => {
      if (!providerPromise) {
        providerPromise = (async () => {
          const { DEFAULT_EMBEDDING_CONFIG, DEFAULT_HYBRID_WEIGHTS } = await import(
            "./features/user-memory/embeddings/types"
          )
          const { getProviderWithFallback } = await import(
            "./features/user-memory/embeddings/provider"
          )

          const base = pluginConfig.user_memory?.embeddings ?? {}
          const embeddingConfig: import("./features/user-memory/embeddings/types").EmbeddingConfig = {
            ...DEFAULT_EMBEDDING_CONFIG,
            ...base,
            enabled: true,
            hybrid_weights: {
              ...DEFAULT_HYBRID_WEIGHTS,
              ...(base.hybrid_weights ?? {}),
            },
          }

          const { provider, usedFallback } = await getProviderWithFallback(embeddingConfig)
          log("[session-handoff] embedding provider initialized", {
            provider: provider.name,
            dimension: provider.dimension,
            usedFallback,
          })
          return provider
        })()
      }

      const provider = await providerPromise
      return provider.embed(texts)
    }
  })()

  const handoffSummarizer = createHandoffSummarizer(ctx, sessionHandoffConfig, {
    categories: pluginConfig.categories,
  });
  const sessionHandoffHook = isHookEnabled("session-handoff")
    ? createSessionHandoffHook({
        config: sessionHandoffConfig,
        sessionReferenceConfig,
        cwd: ctx.directory,
        // LLM call for extraction - uses summarizer with circuit breaker
        callLLM: handoffSummarizer
          ? (prompt, systemPrompt, model) => handoffSummarizer.callLLM(prompt, systemPrompt, model)
          : async () => "{}", // Fallback to metadata extraction if summarizer unavailable
        embed: embedForHandoff,
        collector: contextCollector,
      })
    : null;

  if (sessionStateRepair && taskAutoContinuation) {
    sessionStateRepair.setOnAbortCallback(taskAutoContinuation.markRecovering);
    sessionStateRepair.setOnRecoveryCompleteCallback(
      taskAutoContinuation.markRecoveryComplete
    );
  }

  const backgroundNotificationHook = isHookEnabled("background-notification")
    ? createBackgroundNotificationHook(backgroundManager)
    : null;
  const backgroundTools = createBackgroundTools(backgroundManager, ctx.client);

  const lookAt = createLookAt(ctx);
  const disabledSkills = new Set(pluginConfig.disabled_skills ?? []);
  const systemMcpNames = getSystemMcpServerNames();
  const builtinSkills = createBuiltinSkills().filter((skill) => {
    if (disabledSkills.has(skill.name as never)) return false;
    if (skill.mcpConfig) {
      for (const mcpName of Object.keys(skill.mcpConfig)) {
        if (systemMcpNames.has(mcpName)) return false;
      }
    }
    return true;
  });
  const includeClaudeSkills = pluginConfig.claude_code?.skills !== false;
  const [userSkills, globalSkills, projectSkills, opencodeProjectSkills] = await Promise.all([
    includeClaudeSkills ? discoverUserClaudeSkills() : Promise.resolve([]),
    discoverOpencodeGlobalSkills(),
    includeClaudeSkills ? discoverProjectClaudeSkills() : Promise.resolve([]),
    discoverOpencodeProjectSkills(),
  ]);
  const mergedSkills = mergeSkills(
    builtinSkills,
    pluginConfig.skills,
    userSkills,
    globalSkills,
    projectSkills,
    opencodeProjectSkills
  );

  function mapScopeToLocation(scope: SkillScope): AvailableSkill["location"] {
    if (scope === "user" || scope === "opencode") return "user";
    if (scope === "project" || scope === "opencode-project") return "project";
    return "plugin";
  }

  const availableSkills: AvailableSkill[] = mergedSkills.map((skill) => ({
    name: skill.name,
    description: skill.definition.description ?? "",
    location: mapScopeToLocation(skill.scope),
  }));

  const mergedCategories = mergeCategories(pluginConfig.categories)

  const availableCategories = Object.entries(mergedCategories).map(([name, categoryConfig]) => ({
    name,
    description:
      pluginConfig.categories?.[name]?.description
      ?? CATEGORY_DESCRIPTIONS[name]
      ?? "General tasks",
    model: categoryConfig.model,
  }));

  const delegateTask = createDelegateTask({
    manager: backgroundManager,
    client: ctx.client,
    directory: ctx.directory,
    userCategories: pluginConfig.categories,
    gitMasterConfig: pluginConfig.git_master,
    disabledSkills,
    availableCategories,
    availableSkills,
  });

  delegationNudgeCategorySkill = isHookEnabled("delegation-nudge-category-skill")
    ? createDelegationNudgeCategorySkillHook(ctx, availableSkills)
    : null;

  const swarmTool = createSwarmTool({
    directory: ctx.directory,
    config: pluginConfig,
    runtime: swarmRuntime,
    getSessionId: () => getMainSessionID(),
  });

  const skillMcpManager = new SkillMcpManager();
  const getSessionIDForMcp = () => getMainSessionID() || "";
  const skillTool = createSkillTool({
    skills: mergedSkills,
    mcpManager: skillMcpManager,
    getSessionID: getSessionIDForMcp,
    gitMasterConfig: pluginConfig.git_master,
  });
  const skillMcpTool = createSkillMcpTool({
    manager: skillMcpManager,
    getLoadedSkills: () => mergedSkills,
    getSessionID: getSessionIDForMcp,
  });

  const commands = discoverCommandsSync(pluginConfig.disabled_commands);
  const slashcommandTool = createSlashcommandTool({
    commands,
  });

  const autoSlashCommand = isHookEnabled("auto-slash-command")
    ? createAutoSlashCommandHook({
      disabledBuiltinCommands: pluginConfig.disabled_commands,
    })
    : null;

  const configHandler = createConfigHandler({
    ctx,
    pluginConfig,
    modelCacheState,
  });

  const runtimeRegistryEntries = getRuntimeRegistryEntries();
  validateRuntimeRegistry({
    schemaHooks: [...HookNameSchema.options],
    registryEntries: runtimeRegistryEntries,
    order: EVENT_TOTAL_ORDER,
  });

  const hookRuntimeDispatcher = new HookRuntimeDispatcher({
    order: EVENT_TOTAL_ORDER,
    onError: ({ event, nodeId, error, policy }) => {
      log("[hook-runtime] node failure", {
        event,
        nodeId,
        policy,
        error: error instanceof Error ? error.message : String(error),
      });
    },
  });

  const executeRuntimePipeline = async (
    event: HookEventType,
    nodes: RuntimeExecutionNode[]
  ): Promise<void> => {
    if (nodes.length === 0) {
      return;
    }

    const runtimeOrder = hookRuntimeDispatcher.resolveNodeOrder(
      event,
      nodes.map((node) => node.id)
    );

    const nodeById = new Map<HookNodeId, RuntimeExecutionNode>();
    for (const node of nodes) {
      nodeById.set(node.id, node);
    }
    const orderedNodes = runtimeOrder
      .map((nodeId) => nodeById.get(nodeId))
      .filter((node): node is RuntimeExecutionNode => Boolean(node));
    await hookRuntimeDispatcher.dispatch(event, orderedNodes);
  };

  const optional = <T,>(value: T | null | undefined): T | undefined => value ?? undefined;

  const runtimeAssemblyContext = {
    pluginConfig,
    directory: ctx.directory,
    client: ctx.client,
    claudeCodeBridgeEnabled,
    governanceEnabled,
    governanceConfig,
    governanceBlockPrefix: GOVERNANCE_BLOCK_PREFIX,
    firstMessageVariantGate,
    resolveAgentVariant,
    applyAgentVariant,
    contextCollector,
    setMainSession,
    getMainSessionID,
    updateSessionAgent,
    getSessionAgent,
    sessionStateCoordinator,
    persistGovernanceTraceSnapshot: governanceEnabled ? persistGovernanceTraceSnapshot : undefined,
    resetMessageCursor,
    swarmRuntime,
    skillMcpManager,
    lspManager,
    thinkMode: optional(thinkMode),
    keywordDetector: optional(keywordDetector),
    claudeCodeHooks: optional(claudeCodeHooks),
    sessionHandoffHook: optional(sessionHandoffHook),
    autoSlashCommand: optional(autoSlashCommand),
    startWork: optional(startWork),
    swarmFromPlan: optional(swarmFromPlan),
    workOrchestrator: optional(workOrchestrator),
    preCompletionVerification: optional(preCompletionVerification),
    sisyphusContextualInjector: optional(sisyphusContextualInjector),
    ralphLoop: optional(ralphLoop),
    userMemory: optional(userMemory),
    orgMemory: optional(orgMemory),
    contextInjectorMessagesTransform: optional(contextInjectorMessagesTransform),
    thinkingBlockValidator: optional(thinkingBlockValidator),
    autoUpdateChecker: optional(autoUpdateChecker),
    backgroundNotificationHook: optional(backgroundNotificationHook),
    sessionNotification: optional(sessionNotification),
    taskAutoContinuation: optional(taskAutoContinuation),
    unstableAgentWatchdog: optional(unstableAgentWatchdog),
    runtimeTracker: optional(runtimeTracker),
    repoOverviewInjector: optional(repoOverviewInjector),
    contextWindowGovernor: optional(contextWindowGovernor),
    directoryAgentsInjector: optional(directoryAgentsInjector),
    directoryReadmeInjector: optional(directoryReadmeInjector),
    rulesInjector: optional(rulesInjector),
    delegationNudgeAgentUsage: optional(delegationNudgeAgentUsage),
    delegationNudgeCategorySkill: optional(delegationNudgeCategorySkill),
    interactiveBashSession: optional(interactiveBashSession),
    conditionalRulesHooks: optional(conditionalRulesHooks),
    tmuxParallelAgents: optional(tmuxParallelAgents),
    swarmAgent: optional(swarmAgent),
    sessionStateRepair: optional(sessionStateRepair),
    questionLabelTruncator: optional(questionLabelTruncator),
    delegationBlockSubagentQuestion: optional(delegationBlockSubagentQuestion),
    writeExistingFileGuard: optional(writeExistingFileGuard),
    nonInteractiveEnv: optional(nonInteractiveEnv),
    commentChecker: optional(commentChecker),
    prometheusMdOnly: optional(prometheusMdOnly),
    delegationValidateDecision: optional(delegationValidateDecision),
    sisyphusJuniorNotepad: optional(sisyphusJuniorNotepad),
    contextManifestInjector: optional(contextManifestInjector),
    silentToolOutput: optional(silentToolOutput),
    antiSlopEnforcer: optional(antiSlopEnforcer),
    toolOutputTruncator: optional(toolOutputTruncator),
    emptyTaskResponseDetector: optional(emptyTaskResponseDetector),
    editFailureGuidance: optional(editFailureGuidance),
    delegationFailureGuidance: optional(delegationFailureGuidance),
    taskResumeInfo: optional(taskResumeInfo),
  } as RuntimeAssemblyContext;

  const taskGraphTools = createTaskGraphTools(pluginConfig);

  const allTools = {
    ...builtinTools,
    ...backgroundTools,
    ...taskGraphTools,
    look_at: lookAt,
    delegate_task: delegateTask,
    swarm: swarmTool,
    skill: skillTool,
    skill_mcp: skillMcpTool,
    slashcommand: slashcommandTool,
    interactive_bash,
  };

  const filteredTools = filterDisabledTools(allTools, pluginConfig.disabled_tools);

  const pluginHooks: ExtendedPluginHooks = {
    tool: filteredTools,

    "chat.params": async (
      input: {
        sessionID: string
        agent: string
        model: Record<string, unknown>
        provider: Record<string, unknown>
        message: Record<string, unknown>
      },
      output: {
        temperature: number
        topP: number
        topK: number
        options: Record<string, unknown>
      },
    ) => {
      const model = input.model as { providerID?: string; modelID?: string }
      const message = input.message as { variant?: string }
      await anthropicEffort?.["chat.params"]?.(
        {
          ...input,
          agent: { name: input.agent },
          model,
          provider: input.provider as { id: string },
          message,
        },
        output,
      )
      await cachePolicy?.["chat.params"]?.(
        {
          ...input,
          agent: { name: input.agent },
          model,
          provider: input.provider as { id: string },
          message,
        },
        output,
      )
    },

    "chat.message": async (input, output) => {
      const nodes = buildChatMessageNodes(runtimeAssemblyContext, input, output);
      await executeRuntimePipeline("chat.message", nodes);
    },

    "user.prompt.submit": async (input: MessageInput) => {
      const nodes = buildUserPromptSubmitNodes(runtimeAssemblyContext, input);
      await executeRuntimePipeline("user.prompt.submit", nodes);
    },

    "experimental.chat.messages.transform": async (input, output) => {
      const nodes = buildExperimentalChatTransformNodes(
        runtimeAssemblyContext,
        input,
        output as ExperimentalChatTransformOutput
      );
      await executeRuntimePipeline("experimental.chat.messages.transform", nodes);
    },

    config: configHandler,

    event: async (input) => {
      workOrchestrator?.beginEvent(input as { event: { type: string; properties?: unknown } });
      const nodes = buildEventNodes(runtimeAssemblyContext, input);

      try {
        await executeRuntimePipeline("event", nodes);
      } finally {
        await workOrchestrator?.flushEvent(
          input as { event: { type: string; properties?: unknown } }
        );
      }
    },

    "tool.execute.before": async (input, output) => {
      const nodes = buildToolExecuteBeforeNodes(
        runtimeAssemblyContext,
        input,
        output as ToolExecuteBeforeOutput
      );
      await executeRuntimePipeline("tool.execute.before", nodes);
    },

    "tool.execute.after": async (input, output) => {
      // Guard against undefined output (e.g., from /review command - see issue #1035)
      if (!output) {
        return;
      }

      const nodes = buildToolExecuteAfterNodes(
        runtimeAssemblyContext,
        input,
        output as ToolExecuteAfterOutput
      );
      await executeRuntimePipeline("tool.execute.after", nodes);
    },

    "experimental.session.compacting": async (input, output) => {
      const nodes = buildExperimentalSessionCompactingNodes(
        runtimeAssemblyContext,
        input as ExperimentalSessionCompactingInput,
        output as ExperimentalSessionCompactingOutput | undefined
      );
      await executeRuntimePipeline("experimental.session.compacting", nodes);
    },
  };

  if (supportsCommandExecuteBefore) {
    pluginHooks["command.execute.before"] = async (input, output) => {
      const nodes: RuntimeExecutionNode[] = autoSlashCommand?.["command.execute.before"]
        ? [{
          id: "auto-slash-command:command.execute.before",
          invoke: async () => {
            await autoSlashCommand["command.execute.before"]?.(
              {
                command: input.command,
                sessionID: input.sessionID,
                arguments: input.arguments ?? "",
              },
              output as CommandExecuteBeforeOutput
            )
          },
        } as RuntimeExecutionNode]
        : []

      await executeRuntimePipeline("command.execute.before", nodes)
    }
  }

  if (supportsChatHeaders) {
    pluginHooks["chat.headers"] = async (input, output) => {
      const model = input.model as { providerID?: string; modelID?: string; id?: string; api?: { npm?: string } }
      const providerID = (model.providerID ?? "").toLowerCase()
      const modelID = (model.modelID ?? model.id ?? "").toLowerCase()
      const apiNpm = (model.api?.npm ?? "").toLowerCase()
      const isCopilotProvider = providerID.includes("github-copilot")
      const isAnthropicCopilotModel =
        apiNpm === "@ai-sdk/anthropic" ||
        (apiNpm === "@ai-sdk/github-copilot" && modelID.includes("claude"))

      const nodes: RuntimeExecutionNode[] = [
        ...(isCopilotProvider && isAnthropicCopilotModel ? [{
          id: "internal:copilot-anthropic-beta:chat.headers",
          invoke: async () => {
            const key = "anthropic-beta"
            output.headers[key] = appendHeaderToken(
              output.headers[key],
              COPILOT_INTERLEAVED_THINKING_HEADER
            )
          },
        } as RuntimeExecutionNode] : []),
        ...(isCopilotProvider && isSubagentSession(input.sessionID) ? [{
          id: "internal:copilot-subagent-initiator:chat.headers",
          invoke: async () => {
            output.headers["x-initiator"] = "agent"
          },
        } as RuntimeExecutionNode] : []),
      ]

      await executeRuntimePipeline("chat.headers", nodes)
    }
  }

  if (supportsShellEnv) {
    pluginHooks["shell.env"] = async (_input, output) => {
      const nodes: RuntimeExecutionNode[] = nonInteractiveEnv
        ? [{
          id: "internal:non-interactive-env:shell.env",
          invoke: async () => {
            Object.assign(output.env, NON_INTERACTIVE_ENV)
          },
        } as RuntimeExecutionNode]
        : []

      await executeRuntimePipeline("shell.env", nodes)
    }
  }

  return pluginHooks;
};

export default OhMyOpenCodePlugin;

export type {
  OhMyOpenCodeConfig,
  AgentName,
  AgentOverrideConfig,
  AgentOverrides,
  McpName,
  HookName,
  BuiltinCommandName,
} from "./config";

// NOTE: Do NOT export functions from main index.ts!
// OpenCode treats ALL exports as plugin instances and calls them.
// Config error utilities are available via "./shared/config-errors" for internal use only.
export type { ConfigLoadError } from "./shared/config-errors";
