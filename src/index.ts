import type { Plugin } from "@opencode-ai/plugin";
import type { Message, Part } from "@opencode-ai/sdk";
import {
  createTodoAutoContinuationHook,
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
  createContinuationStopGuardHook,
  createTaskResumeInfoHook,
  createStartWorkHook,
  createExecutionOrchestratorHook,
  createPrometheusMdOnlyHook,
  createMultiPlanTriggerHook,
  createPlanningWithFilesHook,
  createSilentToolOutputHook,
  createRepoOverviewInjectorHook,
  createRuntimeTrackerHook,
  createContextManifestInjectorHook,
  createSwarmFromPlanHook,
  createAntiSlopEnforcerHook,
  createPreCompletionVerificationHook,
  createDelegationValidateDecisionHook,
  createDelegationNudgeCategorySkillHook,
  createSisyphusJuniorNotepadHook,
  createTmuxParallelAgentsHook,
  createConditionalRulesHooks,
  createSessionHandoffHook,
  createSwarmAgentHook,
  createAnthropicEffortHook,
} from "./hooks";
import {
  EVENT_TOTAL_ORDER,
  HookRuntimeDispatcher,
  getRuntimeRegistryEntries,
  isClaudeCodeBridgeEnabled,
  isHookEnabled as isRuntimeHookEnabled,
  validateRuntimeRegistry,
  type HookEventType,
  type HookNodeId,
  type RuntimeExecutionNode,
} from "./hooks/runtime";
import { createHandoffSummarizer } from "./features/session-handoff";
import {
  contextCollector,
  createContextInjectorMessagesTransformHook,
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
  createMultiPlanTool,
  createSwarmTool,
  interactive_bash,
  startTmuxCheck,
  lspManager,
} from "./tools";
import { BackgroundManager } from "./features/background-agent";
import { SkillMcpManager } from "./features/skill-mcp-manager";
import { initTaskToastManager } from "./features/task-toast-manager";
import { createWorkStateManager } from "./features/work-state";
import { createSwarmRuntimeService } from "./features/sisyphus-swarm/runtime";
import { HookNameSchema, type HookName } from "./config";
import { log, detectExternalNotificationPlugin, getNotificationConflictWarning, resetMessageCursor, deepMerge, getOpenCodeVersion, isOpenCodeVersionAtLeast, OPENCODE_NATIVE_AGENTS_INJECTION_VERSION } from "./shared";
import { filterDisabledTools } from "./shared/disabled-tools";
import { DEFAULT_CONDITIONAL_RULES_CONFIG } from "./features/conditional-rules";
import { DEFAULT_HANDOFF_CONFIG } from "./features/session-handoff";
import { loadPluginConfig } from "./plugin-config";
import { createModelCacheState } from "./plugin-state";
import { createConfigHandler } from "./plugin-handlers";
import type { MessageInput } from "./shared/hook-types";
import { DEFAULT_SESSION_REFERENCE_CONFIG } from "./config/schema"
import {
  executePreToolGovernance,
  executePostToolGovernance,
  executeUserPromptGovernance,
  cleanupGovernanceSession,
  hasGovernanceSession,
} from "./features/governance";
import { CATEGORY_DESCRIPTIONS, DEFAULT_CATEGORIES } from "./tools/delegate-task/constants";

const OhMyOpenCodePlugin: Plugin = async (ctx) => {
  log("[oh-my-opencode] Plugin loading", { directory: ctx.directory });
  // Start background tmux check immediately
  startTmuxCheck();

  const pluginConfig = loadPluginConfig(ctx.directory, ctx);
  const disabledHooks = new Set(pluginConfig.disabled_hooks ?? []);
  const firstMessageVariantGate = createFirstMessageVariantGate();
  const isHookEnabled = (hookName: HookName) =>
    isRuntimeHookEnabled(disabledHooks, hookName);

  const modelCacheState = createModelCacheState();

  const contextWindowGovernor = isHookEnabled("context-window-governor")
    ? createContextWindowGovernorHook(ctx, {
        modelCacheState,
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
            }
          : undefined,
      })
    : null;
  const sessionStateRepair = isHookEnabled("session-state-repair")
    ? createSessionStateRepairHook(ctx, { experimental: pluginConfig.experimental })
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
      sessionNotification = createSessionNotification(ctx);
    }
  }

  const commentChecker = isHookEnabled("comment-checker")
    ? createCommentCheckerHooks(pluginConfig.comment_checker)
    : null;
  const toolOutputTruncator = isHookEnabled("tool-output-truncator")
    ? createToolOutputTruncatorHook(ctx, {
        experimental: pluginConfig.experimental,
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
      directoryAgentsInjector = createDirectoryAgentsInjectorHook(ctx);
    }
  }
  const directoryReadmeInjector = isHookEnabled("directory-readme-injector")
    ? createDirectoryReadmeInjectorHook(ctx)
    : null;
  const emptyTaskResponseDetector = isHookEnabled("empty-task-response-detector")
    ? createEmptyTaskResponseDetectorHook(ctx)
    : null;
  const thinkMode = isHookEnabled("think-mode") ? createThinkModeHook() : null;
  const anthropicEffort = isHookEnabled("anthropic-effort")
    ? createAnthropicEffortHook()
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
  if (governanceEnabled) {
    log("[governance] Integration enabled", {
      tracer: governanceConfig?.tracer?.enabled,
      budget_monitor: governanceConfig?.budget_monitor?.enabled,
      checkpoint: governanceConfig?.checkpoint?.enabled,
      ledger: governanceConfig?.ledger?.enabled,
    });
  }
  const rulesInjector = isHookEnabled("rules-injector")
    ? createRulesInjectorHook(ctx)
    : null;
  const autoUpdateChecker = isHookEnabled("auto-update-checker")
    ? createAutoUpdateCheckerHook(ctx, {
        showStartupToast: isHookEnabled("startup-toast"),
        isSisyphusEnabled: pluginConfig.sisyphus_agent?.disabled !== true,
        autoUpdate: pluginConfig.auto_update ?? true,
      })
    : null;
  const keywordDetector = isHookEnabled("keyword-detector")
    ? createKeywordDetectorHook(ctx, contextCollector)
    : null;
  const contextInjectorMessagesTransform =
    createContextInjectorMessagesTransformHook(contextCollector);

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

  // Register feature handlers with session coordinator
  sessionStateCoordinator.registerFeature("context-collector", {
    onSessionDeleted(sessionID) {
      contextCollector.clearSession(sessionID)
    },
    onSessionCompacted(sessionID) {
      contextCollector.resetOncePerSession(sessionID)
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
      })
    : null;

  const editFailureGuidance = isHookEnabled("edit-failure-guidance")
    ? createEditFailureGuidanceHook(ctx)
    : null;

  const delegationFailureGuidance = isHookEnabled("delegation-failure-guidance")
    ? createDelegationFailureGuidanceHook(ctx)
    : null;

  const startWork = isHookEnabled("start-work")
    ? createStartWorkHook(ctx)
    : null;

  const swarmRuntime = createSwarmRuntimeService();

  const swarmFromPlan = isHookEnabled("swarm-from-plan")
    ? createSwarmFromPlanHook(ctx, pluginConfig, swarmRuntime)
    : null;

  const prometheusMdOnly = isHookEnabled("prometheus-md-only")
    ? createPrometheusMdOnlyHook(ctx)
    : null;

  const taskResumeInfo = createTaskResumeInfoHook();

  const backgroundManager = new BackgroundManager(ctx, pluginConfig.background_task, {
    parallelRuntimeConfig: pluginConfig.parallel_runtime ?? { enabled: true },
  });

  const executionOrchestratorHook = isHookEnabled("execution-orchestrator")
    ? createExecutionOrchestratorHook(ctx, { directory: ctx.directory, backgroundManager })
    : null;

  initTaskToastManager(ctx.client);

  const continuationStopGuard = isHookEnabled("continuation-stop-guard")
    ? createContinuationStopGuardHook(ctx)
    : null;

  const questionLabelTruncator = isHookEnabled("question-label-truncator")
    ? createQuestionLabelTruncatorHook()
    : null;
  const delegationBlockSubagentQuestion = isHookEnabled("delegation-block-subagent-question")
    ? createDelegationBlockSubagentQuestionHook()
    : null;
  const writeExistingFileGuard = isHookEnabled("write-existing-file-guard")
    ? createWriteExistingFileGuardHook(ctx)
    : null;

  // Get Prometheus model config (string or array for multi-plan)
  const prometheusModel = pluginConfig.agents?.prometheus?.model as string | string[] | undefined;

  const multiPlanTrigger = isHookEnabled("multi-plan-trigger")
    ? createMultiPlanTriggerHook({
        model: prometheusModel,
        pipelineConfig: pluginConfig.multi_plan_pipeline,
      })
    : null;

  const todoAutoContinuationEnabled = isHookEnabled("todo-auto-continuation");

  const planningWithFiles = isHookEnabled("planning-with-files") && pluginConfig.planning_with_files?.enabled
    ? createPlanningWithFilesHook(ctx, {
        config: pluginConfig.planning_with_files,
        collector: contextCollector,
        todoContinuationEnabled: todoAutoContinuationEnabled,
      })
    : null;

  const contextManifestInjector = isHookEnabled("context-manifest-injector")
    ? createContextManifestInjectorHook(ctx)
    : null;

  const todoAutoContinuation = todoAutoContinuationEnabled
    ? createTodoAutoContinuationHook(ctx, {
        backgroundManager,
        isContinuationStopped: continuationStopGuard?.isStopped,
      })
    : null;

  const antiSlopEnforcer = isHookEnabled("anti-slop-enforcer")
    ? createAntiSlopEnforcerHook(ctx)
    : null;

  const preCompletionVerification = isHookEnabled("pre-completion-verification")
    ? createPreCompletionVerificationHook(ctx)
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
  const tmuxParallelAgents = isHookEnabled("tmux-parallel-agents") && pluginConfig.tmux_parallel_agents?.enabled
    ? createTmuxParallelAgentsHook(ctx, pluginConfig.tmux_parallel_agents)
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

  if (sessionStateRepair && todoAutoContinuation) {
    sessionStateRepair.setOnAbortCallback(todoAutoContinuation.markRecovering);
    sessionStateRepair.setOnRecoveryCompleteCallback(
      todoAutoContinuation.markRecoveryComplete
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

  const mergedCategories = pluginConfig.categories
    ? { ...DEFAULT_CATEGORIES, ...pluginConfig.categories }
    : DEFAULT_CATEGORIES;

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

  const multiPlanTool = createMultiPlanTool({
    ctx,
    backgroundManager,
    model: prometheusModel,
    pipelineConfig: pluginConfig.multi_plan_pipeline,
  });
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
    skills: mergedSkills,
  });

  const autoSlashCommand = isHookEnabled("auto-slash-command")
    ? createAutoSlashCommandHook({ skills: mergedSkills })
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

  const allTools = {
    ...builtinTools,
    ...backgroundTools,
    look_at: lookAt,
    delegate_task: delegateTask,
    multi_plan: multiPlanTool,
    swarm: swarmTool,
    skill: skillTool,
    skill_mcp: skillMcpTool,
    slashcommand: slashcommandTool,
    interactive_bash,
  };

  const filteredTools = filterDisabledTools(allTools, pluginConfig.disabled_tools);

  return {
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
    },

    "chat.message": async (input, output) => {
      const nodes: RuntimeExecutionNode[] = [
        {
          id: "internal:session-agent-tracking:chat.message",
          invoke: async () => {
            contextCollector.beginTurn(input.sessionID);
            if (input.agent) {
              updateSessionAgent(input.sessionID, input.agent);
            }
          },
        },
        {
          id: "internal:first-message-variant:chat.message",
          invoke: async () => {
            const message = (output as { message: { variant?: string } }).message;
            if (firstMessageVariantGate.shouldOverride(input.sessionID)) {
              const variant = resolveAgentVariant(pluginConfig, input.agent);
              if (variant !== undefined) {
                message.variant = variant;
              }
              firstMessageVariantGate.markApplied(input.sessionID);
            } else {
              applyAgentVariant(pluginConfig, input.agent, message);
            }
          },
        },
      ];

      if (thinkMode?.["chat.params"]) {
        nodes.push({
          id: "think-mode:chat.message",
          invoke: async () => {
            await thinkMode["chat.params"]?.(
              output as {
                parts: Array<{ type: string; text?: string }>;
                message: { model?: { providerID: string; modelID: string } };
              },
              input.sessionID
            );
          },
        });
      }

      if (keywordDetector?.["chat.message"]) {
        nodes.push({
          id: "keyword-detector:chat.message",
          invoke: async () => {
            await keywordDetector["chat.message"]?.(input, output);
          },
        });
      }

      if (claudeCodeBridgeEnabled && claudeCodeHooks["chat.message"]) {
        nodes.push({
          id: "bridge:claude-code-hooks:chat.message",
          invoke: async () => {
            await claudeCodeHooks["chat.message"]?.(input, output);
          },
        });
      }

      if (governanceEnabled) {
        nodes.push({
          id: "internal:governance-user-prompt:chat.message",
          failurePolicy: "fail-closed",
          invoke: async () => {
            try {
              const parts = (output as { parts?: Array<{ type: string; text?: string }> }).parts;
              const prompt = parts
                ?.filter((p) => p.type === "text" && p.text)
                .map((p) => p.text)
                .join("\n")
                .trim() || "";

              const estimatedTokens = Math.ceil(prompt.length / 4);

              const govResult = executeUserPromptGovernance({
                sessionId: input.sessionID,
                prompt,
                cwd: ctx.directory,
                estimatedTokens,
                config: governanceConfig,
              });

              if (govResult.block) {
                throw new Error(
                  `${GOVERNANCE_BLOCK_PREFIX} ${govResult.reason ?? "Prompt blocked"}`
                );
              }

              if (govResult.messages.length > 0) {
                const govContent = govResult.messages.join("\n\n");
                contextCollector.register(input.sessionID, {
                  id: "governance-budget-context",
                  source: "custom",
                  content: govContent,
                  priority: "low",
                });
                log("[governance] Budget context injected", {
                  sessionID: input.sessionID,
                  phase: govResult.budgetStatus ? "active" : "normal",
                });
              }
            } catch (err) {
              if (err instanceof Error && err.message.startsWith(GOVERNANCE_BLOCK_PREFIX)) {
                throw err;
              }
              log("[governance] User prompt error (non-fatal)", {
                sessionID: input.sessionID,
                error: err instanceof Error ? err.message : String(err),
              });
            }
          },
        });
      }

      if (sessionHandoffHook?.["chat.message"]) {
        nodes.push({
          id: "session-handoff:chat.message",
          invoke: async () => {
            await sessionHandoffHook["chat.message"]?.(input, output);
          },
        });
      }

      if (autoSlashCommand?.["chat.message"]) {
        nodes.push({
          id: "auto-slash-command:chat.message",
          invoke: async () => {
            await autoSlashCommand["chat.message"]?.(input, output);
          },
        });
      }

      if (startWork?.["chat.message"]) {
        nodes.push({
          id: "start-work:chat.message",
          invoke: async () => {
            await startWork["chat.message"]?.(input, output);
          },
        });
      }

      if (swarmFromPlan?.["chat.message"]) {
        nodes.push({
          id: "swarm-from-plan:chat.message",
          invoke: async () => {
            await swarmFromPlan["chat.message"]?.(input, output);
          },
        });
      }

      if (multiPlanTrigger?.["chat.message"]) {
        nodes.push({
          id: "multi-plan-trigger:chat.message",
          invoke: async () => {
            await multiPlanTrigger["chat.message"]?.(input, output);
          },
        });
      }

      if (planningWithFiles?.["chat.message"]) {
        nodes.push({
          id: "planning-with-files:chat.message",
          invoke: async () => {
            await planningWithFiles["chat.message"]?.(input, output);
          },
        });
      }

      if (preCompletionVerification?.["chat.message"]) {
        nodes.push({
          id: "pre-completion-verification:chat.message",
          invoke: async () => {
            await preCompletionVerification["chat.message"]?.(input, output);
          },
        });
      }

      if (continuationStopGuard?.["chat.message"]) {
        nodes.push({
          id: "continuation-stop-guard:chat.message",
          invoke: async () => {
            await continuationStopGuard["chat.message"]?.({ sessionID: input.sessionID });
          },
        });
      }

      if (ralphLoop) {
        nodes.push({
          id: "internal:ralph-loop-template:chat.message",
          invoke: async () => {
            const parts = (
              output as { parts?: Array<{ type: string; text?: string }> }
            ).parts;
            const promptText =
              parts
                ?.filter((p) => p.type === "text" && p.text)
                .map((p) => p.text)
                .join("\n")
                .trim() || "";

            const isRalphLoopTemplate =
              promptText.includes("You are starting a Ralph Loop") &&
              promptText.includes("<user-task>");
            const isCancelRalphTemplate = promptText.includes(
              "Cancel the currently active Ralph Loop"
            );

            if (isRalphLoopTemplate) {
              const taskMatch = promptText.match(
                /<user-task>\s*([\s\S]*?)\s*<\/user-task>/i
              );
              const rawTask = taskMatch?.[1]?.trim() || "";

              const quotedMatch = rawTask.match(/^["'](.+?)["']/);
              const prompt =
                quotedMatch?.[1] ||
                rawTask.split(/\s+--/)[0]?.trim() ||
                "Complete the task as instructed";

              const maxIterMatch = rawTask.match(/--max-iterations=(\d+)/i);
              const promiseMatch = rawTask.match(
                /--completion-promise=["']?([^"'\s]+)["']?/i
              );

              log("[ralph-loop] Starting loop from chat.message", {
                sessionID: input.sessionID,
                prompt,
              });
              ralphLoop.startLoop(input.sessionID, prompt, {
                maxIterations: maxIterMatch
                  ? parseInt(maxIterMatch[1], 10)
                  : undefined,
                completionPromise: promiseMatch?.[1],
              });
            } else if (isCancelRalphTemplate) {
              log("[ralph-loop] Cancelling loop from chat.message", {
                sessionID: input.sessionID,
              });
              ralphLoop.cancelLoop(input.sessionID);
            }
          },
        });
      }

      await executeRuntimePipeline("chat.message", nodes);
    },

    "user.prompt.submit": async (input: MessageInput) => {
      const nodes: RuntimeExecutionNode[] = [];

      if (userMemory["user.prompt.submit"]) {
        nodes.push({
          id: "internal:user-memory:user.prompt.submit",
          invoke: async () => {
            await userMemory["user.prompt.submit"]?.(input);
          },
        });
      }

      if (orgMemory["user.prompt.submit"]) {
        nodes.push({
          id: "internal:org-memory:user.prompt.submit",
          invoke: async () => {
            await orgMemory["user.prompt.submit"]?.(input);
          },
        });
      }

      if (sessionHandoffHook?.["user.prompt.submit"]) {
        nodes.push({
          id: "session-handoff:user.prompt.submit",
          invoke: async () => {
            await sessionHandoffHook["user.prompt.submit"]?.(input as {
              sessionID: string;
              parts?: Array<{ type: string; text?: string }>;
            });
          },
        });
      }

      await executeRuntimePipeline("user.prompt.submit", nodes);
    },

    "experimental.chat.messages.transform": async (
      input: Record<string, never>,
      output: { messages: Array<{ info: Message; parts: Part[] }> }
    ) => {
      const nodes: RuntimeExecutionNode[] = [];

      if (contextInjectorMessagesTransform?.["experimental.chat.messages.transform"]) {
        nodes.push({
          id: "internal:context-injector:experimental.chat.messages.transform",
          invoke: async () => {
            await contextInjectorMessagesTransform[
              "experimental.chat.messages.transform"
            ]?.(input, output);
          },
        });
      }

      if (thinkingBlockValidator?.["experimental.chat.messages.transform"]) {
        nodes.push({
          id: "thinking-block-validator:experimental.chat.messages.transform",
          invoke: async () => {
            await thinkingBlockValidator[
              "experimental.chat.messages.transform"
            ]?.(input, output);
          },
        });
      }

      await executeRuntimePipeline("experimental.chat.messages.transform", nodes);
    },

    config: configHandler,

    event: async (input) => {
      const nodes: RuntimeExecutionNode[] = [];

      if (continuationStopGuard?.event) {
        nodes.push({
          id: "continuation-stop-guard:event",
          invoke: async () => {
            await continuationStopGuard.event(input as { event: { type: string; properties?: unknown } });
          },
        });
      }
      if (autoUpdateChecker?.event) {
        nodes.push({
          id: "auto-update-checker:event",
          invoke: async () => {
            await autoUpdateChecker.event(input);
          },
        });
      }
      if (claudeCodeBridgeEnabled) {
        nodes.push({
          id: "bridge:claude-code-hooks:event",
          invoke: async () => {
            await claudeCodeHooks.event(input);
          },
        });
      }
      if (backgroundNotificationHook?.event) {
        nodes.push({
          id: "background-notification:event",
          invoke: async () => {
            await backgroundNotificationHook.event(input);
          },
        });
      }
      if (sessionNotification) {
        nodes.push({
          id: "session-notification:event",
          invoke: async () => {
            await sessionNotification?.(input);
          },
        });
      }
      if (todoAutoContinuation?.handler) {
        nodes.push({
          id: "todo-auto-continuation:event",
          invoke: async () => {
            await todoAutoContinuation.handler(input);
          },
        });
      }
      if (preCompletionVerification?.event) {
        nodes.push({
          id: "pre-completion-verification:event",
          invoke: async () => {
            await preCompletionVerification.event?.(input);
          },
        });
      }
      if (planningWithFiles?.event) {
        nodes.push({
          id: "planning-with-files:event",
          invoke: async () => {
            await planningWithFiles.event?.(input);
          },
        });
      }
      if (userMemory?.event) {
        nodes.push({
          id: "internal:user-memory:event",
          invoke: async () => {
            await userMemory.event(input);
          },
        });
      }
      if (orgMemory?.event) {
        nodes.push({
          id: "internal:org-memory:event",
          invoke: async () => {
            await orgMemory.event(input);
          },
        });
      }
      if (runtimeTracker?.event) {
        nodes.push({
          id: "runtime-tracker:event",
          invoke: async () => {
            await runtimeTracker.event?.(input);
          },
        });
      }
      if (repoOverviewInjector?.event) {
        nodes.push({
          id: "repo-overview-injector:event",
          invoke: async () => {
            await repoOverviewInjector.event?.(input);
          },
        });
      }
      if (contextWindowGovernor?.event) {
        nodes.push({
          id: "context-window-governor:event",
          invoke: async () => {
            await contextWindowGovernor.event(input);
          },
        });
      }
      if (directoryAgentsInjector?.event) {
        nodes.push({
          id: "directory-agents-injector:event",
          invoke: async () => {
            await directoryAgentsInjector.event(input);
          },
        });
      }
      if (directoryReadmeInjector?.event) {
        nodes.push({
          id: "directory-readme-injector:event",
          invoke: async () => {
            await directoryReadmeInjector.event(input);
          },
        });
      }
      if (rulesInjector?.event) {
        nodes.push({
          id: "rules-injector:event",
          invoke: async () => {
            await rulesInjector.event(input);
          },
        });
      }
      if (thinkMode?.event) {
        nodes.push({
          id: "think-mode:event",
          invoke: async () => {
            await thinkMode.event(input);
          },
        });
      }
      if (delegationNudgeAgentUsage?.event) {
        nodes.push({
          id: "delegation-nudge-agent-usage:event",
          invoke: async () => {
            await delegationNudgeAgentUsage.event(input);
          },
        });
      }
      if (delegationNudgeCategorySkill?.event) {
        nodes.push({
          id: "delegation-nudge-category-skill:event",
          invoke: async () => {
            await delegationNudgeCategorySkill.event?.(input);
          },
        });
      }
      if (interactiveBashSession?.event) {
        nodes.push({
          id: "interactive-bash-session:event",
          invoke: async () => {
            await interactiveBashSession.event(input);
          },
        });
      }
      if (ralphLoop?.event) {
        nodes.push({
          id: "ralph-loop:event",
          invoke: async () => {
            await ralphLoop.event(input);
          },
        });
      }
      if (executionOrchestratorHook?.handler) {
        nodes.push({
          id: "execution-orchestrator:event",
          invoke: async () => {
            await executionOrchestratorHook.handler(input);
          },
        });
      }
      if (conditionalRulesHooks?.event) {
        nodes.push({
          id: "conditional-rules:event",
          invoke: async () => {
            await conditionalRulesHooks.event?.(input as { event: { type: string; properties?: unknown } });
          },
        });
      }
      if (sessionHandoffHook?.event) {
        nodes.push({
          id: "session-handoff:event",
          invoke: async () => {
            await sessionHandoffHook.event?.(input);
          },
        });
      }
      if (tmuxParallelAgents?.event) {
        nodes.push({
          id: "tmux-parallel-agents:event",
          invoke: async () => {
            await tmuxParallelAgents.event?.(input);
          },
        });
      }
      if (swarmAgent?.event) {
        nodes.push({
          id: "swarm-agent:event",
          invoke: async () => {
            await swarmAgent.event?.(input);
          },
        });
      }

      nodes.push({
        id: "internal:core-session-state:event",
        failurePolicy: "fail-closed",
        invoke: async () => {
          const { event } = input;
          const props = event.properties as Record<string, unknown> | undefined;

          if (event.type === "session.created") {
            const sessionInfo = props?.info as
              | { id?: string; title?: string; parentID?: string }
              | undefined;
            if (!sessionInfo?.parentID) {
              setMainSession(sessionInfo?.id);
            }
            if (sessionInfo?.id) {
              const agent = (props as Record<string, unknown>)?.agent as string | undefined;
              sessionStateCoordinator.onSessionCreated(sessionInfo.id, sessionInfo.parentID, agent);
            }
            firstMessageVariantGate.markSessionCreated(sessionInfo);
          }

          if (event.type === "session.deleted") {
            const sessionInfo = props?.info as { id?: string } | undefined;
            if (sessionInfo?.id) {
              sessionStateCoordinator.onSessionDeleted(sessionInfo.id);
              resetMessageCursor(sessionInfo.id);
              firstMessageVariantGate.clear(sessionInfo.id);
              swarmRuntime.unbindSession(sessionInfo.id);
              swarmRuntime.unregisterWorker(sessionInfo.id);
              swarmRuntime.unregisterCoordinator(sessionInfo.id);
              await skillMcpManager.disconnectSession(sessionInfo.id);
              await lspManager.cleanupTempDirectoryClients();
            }
          }

          if (event.type === "session.compacted") {
            const sessionID = props?.sessionID as string | undefined;
            if (sessionID) {
              sessionStateCoordinator.onSessionCompacted(sessionID);
            }
          }

          if (event.type === "message.updated") {
            const info = props?.info as Record<string, unknown> | undefined;
            const sessionID = info?.sessionID as string | undefined;
            const agent = info?.agent as string | undefined;
            const role = info?.role as string | undefined;
            if (sessionID && agent && role === "user") {
              updateSessionAgent(sessionID, agent);
            }
          }
        },
      });

      if (sessionStateRepair) {
        nodes.push({
          id: "internal:session-state-repair:event",
          invoke: async () => {
            const { event } = input;
            const props = event.properties as Record<string, unknown> | undefined;
            if (event.type !== "session.error") {
              return;
            }

            const sessionID = props?.sessionID as string | undefined;
            const error = props?.error;

            if (!sessionStateRepair.isRecoverableError(error)) {
              return;
            }

            const messageInfo = {
              id: props?.messageID as string | undefined,
              role: "assistant" as const,
              sessionID,
              error,
            };
            const recovered =
              await sessionStateRepair.handleSessionRecovery(messageInfo);

            if (recovered && sessionID && sessionID === getMainSessionID()) {
              await ctx.client.session
                .prompt({
                  path: { id: sessionID },
                  body: { parts: [{ type: "text", text: "continue" }] },
                  query: { directory: ctx.directory },
                })
                .catch(() => {});
            }
          },
        });
      }

      await executeRuntimePipeline("event", nodes);
    },

    "tool.execute.before": async (input, output) => {
      const nodes: RuntimeExecutionNode[] = [];

      if (questionLabelTruncator?.["tool.execute.before"]) {
        nodes.push({
          id: "question-label-truncator:tool.execute.before",
          invoke: async () => {
            await questionLabelTruncator["tool.execute.before"]?.(input, output);
          },
        });
      }
      if (delegationBlockSubagentQuestion?.["tool.execute.before"]) {
        nodes.push({
          id: "delegation-block-subagent-question:tool.execute.before",
          invoke: async () => {
            await delegationBlockSubagentQuestion["tool.execute.before"]?.(input, output);
          },
        });
      }
      if (writeExistingFileGuard?.["tool.execute.before"]) {
        nodes.push({
          id: "write-existing-file-guard:tool.execute.before",
          invoke: async () => {
            await writeExistingFileGuard["tool.execute.before"]?.(input, output);
          },
        });
      }
      if (userMemory?.["tool.execute.before"]) {
        nodes.push({
          id: "internal:user-memory:tool.execute.before",
          invoke: async () => {
            await userMemory["tool.execute.before"]?.(input, output);
          },
        });
      }
      if (orgMemory?.["tool.execute.before"]) {
        nodes.push({
          id: "internal:org-memory:tool.execute.before",
          invoke: async () => {
            await orgMemory["tool.execute.before"]?.(input, output);
          },
        });
      }
      if (runtimeTracker?.["tool.execute.before"]) {
        nodes.push({
          id: "runtime-tracker:tool.execute.before",
          invoke: async () => {
            await runtimeTracker["tool.execute.before"]?.(input, output);
          },
        });
      }
      if (claudeCodeBridgeEnabled && claudeCodeHooks["tool.execute.before"]) {
        nodes.push({
          id: "bridge:claude-code-hooks:tool.execute.before",
          invoke: async () => {
            await claudeCodeHooks["tool.execute.before"]?.(input, output);
          },
        });
      }
      if (nonInteractiveEnv?.["tool.execute.before"]) {
        nodes.push({
          id: "non-interactive-env:tool.execute.before",
          invoke: async () => {
            await nonInteractiveEnv["tool.execute.before"]?.(input, output);
          },
        });
      }
      if (commentChecker?.["tool.execute.before"]) {
        nodes.push({
          id: "comment-checker:tool.execute.before",
          invoke: async () => {
            await commentChecker["tool.execute.before"]?.(input, output);
          },
        });
      }
      if (directoryAgentsInjector?.["tool.execute.before"]) {
        nodes.push({
          id: "directory-agents-injector:tool.execute.before",
          invoke: async () => {
            await directoryAgentsInjector["tool.execute.before"]?.(input, output);
          },
        });
      }
      if (directoryReadmeInjector?.["tool.execute.before"]) {
        nodes.push({
          id: "directory-readme-injector:tool.execute.before",
          invoke: async () => {
            await directoryReadmeInjector["tool.execute.before"]?.(input, output);
          },
        });
      }
      if (rulesInjector?.["tool.execute.before"]) {
        nodes.push({
          id: "rules-injector:tool.execute.before",
          invoke: async () => {
            await rulesInjector["tool.execute.before"]?.(input, output);
          },
        });
      }
      if (prometheusMdOnly?.["tool.execute.before"]) {
        nodes.push({
          id: "prometheus-md-only:tool.execute.before",
          invoke: async () => {
            await prometheusMdOnly["tool.execute.before"]?.(input, output);
          },
        });
      }
      if (planningWithFiles?.["tool.execute.before"]) {
        nodes.push({
          id: "planning-with-files:tool.execute.before",
          invoke: async () => {
            await planningWithFiles["tool.execute.before"]?.(input, output);
          },
        });
      }
      if (delegationValidateDecision?.["tool.execute.before"]) {
        nodes.push({
          id: "delegation-validate-decision:tool.execute.before",
          invoke: async () => {
            await delegationValidateDecision["tool.execute.before"]?.(input, output);
          },
        });
      }
      if (sisyphusJuniorNotepad?.["tool.execute.before"]) {
        nodes.push({
          id: "sisyphus-junior-notepad:tool.execute.before",
          invoke: async () => {
            await sisyphusJuniorNotepad["tool.execute.before"]?.(input, output);
          },
        });
      }
      if (executionOrchestratorHook?.["tool.execute.before"]) {
        nodes.push({
          id: "execution-orchestrator:tool.execute.before",
          invoke: async () => {
            await executionOrchestratorHook["tool.execute.before"]?.(input, output);
          },
        });
      }
      if (tmuxParallelAgents?.["tool.execute.before"]) {
        nodes.push({
          id: "tmux-parallel-agents:tool.execute.before",
          invoke: async () => {
            await tmuxParallelAgents["tool.execute.before"]?.(input, output);
          },
        });
      }
      if (swarmAgent?.["tool.execute.before"]) {
        nodes.push({
          id: "swarm-agent:tool.execute.before",
          invoke: async () => {
            await swarmAgent["tool.execute.before"]?.(input, output);
          },
        });
      }

      if (conditionalRulesHooks) {
        nodes.push({
          id: "conditional-rules:tool.execute.before",
          invoke: async () => {
            const currentAgent = getSessionAgent(input.sessionID);
            await conditionalRulesHooks["tool.execute.before"]?.({
              tool: input.tool,
              args: output.args as Record<string, unknown>,
              sessionId: input.sessionID,
              context: { cwd: ctx.directory, agent: currentAgent },
            });

            if (input.tool === "delegate_task") {
              const delegateResult = await conditionalRulesHooks["tool.execute.before:delegate_task"]?.({
                args: output.args as Record<string, unknown>,
                sessionId: input.sessionID,
                context: { cwd: ctx.directory, agent: currentAgent },
              });
              if (delegateResult?.args) {
                Object.assign(output.args as Record<string, unknown>, delegateResult.args);
              }
            }
          },
        });
      }

      if (contextManifestInjector?.["tool.execute.before"]) {
        nodes.push({
          id: "context-manifest-injector:tool.execute.before",
          invoke: async () => {
            await contextManifestInjector["tool.execute.before"]?.(input, output);
          },
        });
      }

      nodes.push({
        id: "internal:task-tools-sanitizer:tool.execute.before",
        invoke: async () => {
          if (input.tool === "task") {
            const args = output.args as Record<string, unknown>;

            args.tools = {
              ...(args.tools as Record<string, boolean> | undefined),
              delegate_task: false,
            };
          }
        },
      });

      if (ralphLoop) {
        nodes.push({
          id: "internal:ralph-loop-slash:tool.execute.before",
          invoke: async () => {
            if (input.tool !== "slashcommand") {
              return;
            }
            const args = output.args as { command?: string } | undefined;
            const command = args?.command?.replace(/^\//, "").toLowerCase();
            const sessionID = input.sessionID || getMainSessionID();

            if (command === "ralph-loop" && sessionID) {
              const rawArgs =
                args?.command?.replace(/^\/?(ralph-loop)\s*/i, "") || "";
              const taskMatch = rawArgs.match(/^["'](.+?)["']/);
              const prompt =
                taskMatch?.[1] ||
                rawArgs.split(/\s+--/)[0]?.trim() ||
                "Complete the task as instructed";

              const maxIterMatch = rawArgs.match(/--max-iterations=(\d+)/i);
              const promiseMatch = rawArgs.match(
                /--completion-promise=["']?([^"'\s]+)["']?/i,
              );

              ralphLoop.startLoop(sessionID, prompt, {
                maxIterations: maxIterMatch
                  ? parseInt(maxIterMatch[1], 10)
                  : undefined,
                completionPromise: promiseMatch?.[1],
              });
            } else if (command === "cancel-ralph" && sessionID) {
              ralphLoop.cancelLoop(sessionID);
            } else if (command === "ulw-loop" && sessionID) {
              const rawArgs =
                args?.command?.replace(/^\/?(ulw-loop)\s*/i, "") || "";
              const taskMatch = rawArgs.match(/^["'](.+?)["']/);
              const prompt =
                taskMatch?.[1] ||
                rawArgs.split(/\s+--/)[0]?.trim() ||
                "Complete the task as instructed";

              const maxIterMatch = rawArgs.match(/--max-iterations=(\d+)/i);
              const promiseMatch = rawArgs.match(
                /--completion-promise=["']?([^"'\s]+)["']?/i,
              );

              ralphLoop.startLoop(sessionID, prompt, {
                ultrawork: true,
                maxIterations: maxIterMatch
                  ? parseInt(maxIterMatch[1], 10)
                  : undefined,
                completionPromise: promiseMatch?.[1],
              });
            }
          },
        });
      }

      nodes.push({
        id: "internal:stop-continuation-slash:tool.execute.before",
        invoke: async () => {
          if (input.tool !== "slashcommand") {
            return;
          }
          const args = output.args as { command?: string } | undefined;
          const command = args?.command?.replace(/^\//, "").toLowerCase();
          const sessionID = input.sessionID || getMainSessionID();

          if (command === "stop-continuation" && sessionID) {
            continuationStopGuard?.stop(sessionID);
            todoAutoContinuation?.cancelAllCountdowns();
            ralphLoop?.cancelLoop(sessionID);
            createWorkStateManager(ctx.directory).clear();
            log("[stop-continuation] All continuation mechanisms stopped", {
              sessionID,
            });
          }
        },
      });

      if (governanceEnabled) {
        nodes.push({
          id: "internal:governance-pre-tool:tool.execute.before",
          failurePolicy: "fail-closed",
          invoke: async () => {
            try {
              const govResult = executePreToolGovernance({
                sessionId: input.sessionID,
                toolName: input.tool,
                toolInput: output.args as Record<string, unknown>,
                toolUseId: input.callID,
                cwd: ctx.directory,
                config: governanceConfig,
              });

              if (!govResult.proceed) {
                throw new Error(
                  `${GOVERNANCE_BLOCK_PREFIX} ${govResult.reason ?? "Operation blocked"}`
                );
              }

              if (govResult.modifiedInput) {
                Object.assign(output.args as Record<string, unknown>, govResult.modifiedInput);
              }

              if (govResult.message) {
                const outputWithMessage = output as { args: unknown; message?: string };
                outputWithMessage.message = (outputWithMessage.message ?? "") + "\n" + govResult.message;
              }
            } catch (err) {
              if (err instanceof Error && err.message.startsWith(GOVERNANCE_BLOCK_PREFIX)) {
                throw err;
              }
              log("[governance] Pre-tool error (non-fatal)", {
                sessionID: input.sessionID,
                tool: input.tool,
                error: err instanceof Error ? err.message : String(err),
              });
            }
          },
        });
      }

      if (silentToolOutput?.["tool.execute.before"]) {
        nodes.push({
          id: "silent-tool-output:tool.execute.before",
          invoke: async () => {
            await silentToolOutput["tool.execute.before"]?.(input, output);
          },
        });
      }

      await executeRuntimePipeline("tool.execute.before", nodes);
    },

    "tool.execute.after": async (input, output) => {
      // Guard against undefined output (e.g., from /review command - see issue #1035)
      if (!output) {
        return;
      }
      const nodes: RuntimeExecutionNode[] = [];

      if (planningWithFiles?.["tool.execute.after"]) {
        nodes.push({
          id: "planning-with-files:tool.execute.after",
          invoke: async () => {
            await planningWithFiles["tool.execute.after"]?.(input, output);
          },
        });
      }
      if (claudeCodeBridgeEnabled && claudeCodeHooks["tool.execute.after"]) {
        nodes.push({
          id: "bridge:claude-code-hooks:tool.execute.after",
          invoke: async () => {
            await claudeCodeHooks["tool.execute.after"]?.(input, output);
          },
        });
      }
      if (antiSlopEnforcer?.["tool.execute.after"]) {
        nodes.push({
          id: "anti-slop-enforcer:tool.execute.after",
          invoke: async () => {
            await antiSlopEnforcer["tool.execute.after"]?.(input, output);
          },
        });
      }
      if (silentToolOutput?.["tool.execute.after"]) {
        nodes.push({
          id: "silent-tool-output:tool.execute.after",
          invoke: async () => {
            await silentToolOutput["tool.execute.after"]?.(input, output);
          },
        });
      }
      if (toolOutputTruncator?.["tool.execute.after"]) {
        nodes.push({
          id: "tool-output-truncator:tool.execute.after",
          invoke: async () => {
            await toolOutputTruncator["tool.execute.after"]?.(input, output);
          },
        });
      }
      if (runtimeTracker?.["tool.execute.after"]) {
        nodes.push({
          id: "runtime-tracker:tool.execute.after",
          invoke: async () => {
            await runtimeTracker["tool.execute.after"]?.(input, output);
          },
        });
      }
      if (repoOverviewInjector?.["tool.execute.after"]) {
        nodes.push({
          id: "repo-overview-injector:tool.execute.after",
          invoke: async () => {
            await repoOverviewInjector["tool.execute.after"]?.(input, output);
          },
        });
      }

      if (governanceEnabled) {
        nodes.push({
          id: "internal:governance-post-tool:tool.execute.after",
          invoke: async () => {
            try {
              const metadata = output.metadata as Record<string, unknown> | undefined;
              const outputStr = typeof output.output === "string" ? output.output : "";
              const outputLower = outputStr.toLowerCase();
              const exitCode = typeof metadata?.exitCode === "number" ? metadata.exitCode : undefined;
              const explicitSuccess =
                typeof metadata?.success === "boolean" ? metadata.success : undefined;
              const inferredSuccess =
                explicitSuccess ??
                (exitCode !== undefined
                  ? exitCode === 0
                  : !outputLower.includes("error:") && !outputLower.includes("failed:"));
              const estimatedTokensUsed = Math.ceil(outputStr.length / 4);

              const rawArgs =
                (metadata as { args?: unknown } | undefined)?.args ??
                (output as { args?: unknown }).args;
              const toolInput =
                rawArgs && typeof rawArgs === "object" && !Array.isArray(rawArgs)
                  ? (rawArgs as Record<string, unknown>)
                  : {};

              const govResult = await executePostToolGovernance({
                sessionId: input.sessionID,
                toolName: input.tool,
                toolInput,
                toolOutput: output as Record<string, unknown>,
                toolUseId: input.callID,
                success: inferredSuccess,
                tokensUsed: estimatedTokensUsed,
                cwd: ctx.directory,
                config: governanceConfig,
              });

              if (govResult.warnings.length > 0) {
                output.output = `${output.output}\n\n${govResult.warnings.join("\n")}`;
              }

              if (govResult.systemMessage) {
                output.output = `${output.output}\n\n${govResult.systemMessage}`;
              }

              if (govResult.checkpointCreated) {
                log("[governance] Auto-checkpoint created", { sessionID: input.sessionID });
              }

              if (govResult.block) {
                ctx.client.tui
                  .showToast({
                    body: {
                      title: "Budget Exhausted",
                      message: "Context budget limit reached. Consider wrapping up.",
                      variant: "warning",
                      duration: 5000,
                    },
                  })
                  .catch(() => {});
              }
            } catch (err) {
              log("[governance] Post-tool error (non-fatal)", {
                sessionID: input.sessionID,
                tool: input.tool,
                error: err instanceof Error ? err.message : String(err),
              });
            }
          },
        });
      }

      if (userMemory?.["tool.execute.after"]) {
        nodes.push({
          id: "internal:user-memory:tool.execute.after",
          invoke: async () => {
            await userMemory["tool.execute.after"]?.(input, output);
          },
        });
      }
      if (orgMemory?.["tool.execute.after"]) {
        nodes.push({
          id: "internal:org-memory:tool.execute.after",
          invoke: async () => {
            await orgMemory["tool.execute.after"]?.(input, output);
          },
        });
      }
      if (contextWindowGovernor?.["tool.execute.after"]) {
        nodes.push({
          id: "context-window-governor:tool.execute.after",
          invoke: async () => {
            await contextWindowGovernor["tool.execute.after"]?.(input, output);
          },
        });
      }
      if (commentChecker?.["tool.execute.after"]) {
        nodes.push({
          id: "comment-checker:tool.execute.after",
          invoke: async () => {
            await commentChecker["tool.execute.after"]?.(input, output);
          },
        });
      }
      if (directoryAgentsInjector?.["tool.execute.after"]) {
        nodes.push({
          id: "directory-agents-injector:tool.execute.after",
          invoke: async () => {
            await directoryAgentsInjector["tool.execute.after"]?.(input, output);
          },
        });
      }
      if (directoryReadmeInjector?.["tool.execute.after"]) {
        nodes.push({
          id: "directory-readme-injector:tool.execute.after",
          invoke: async () => {
            await directoryReadmeInjector["tool.execute.after"]?.(input, output);
          },
        });
      }
      if (rulesInjector?.["tool.execute.after"]) {
        nodes.push({
          id: "rules-injector:tool.execute.after",
          invoke: async () => {
            await rulesInjector["tool.execute.after"]?.(input, output);
          },
        });
      }
      if (emptyTaskResponseDetector?.["tool.execute.after"]) {
        nodes.push({
          id: "empty-task-response-detector:tool.execute.after",
          invoke: async () => {
            await emptyTaskResponseDetector["tool.execute.after"]?.(input, output);
          },
        });
      }
      if (delegationNudgeAgentUsage?.["tool.execute.after"]) {
        nodes.push({
          id: "delegation-nudge-agent-usage:tool.execute.after",
          invoke: async () => {
            await delegationNudgeAgentUsage["tool.execute.after"]?.(input, output);
          },
        });
      }
      if (delegationNudgeCategorySkill?.["tool.execute.after"]) {
        nodes.push({
          id: "delegation-nudge-category-skill:tool.execute.after",
          invoke: async () => {
            await delegationNudgeCategorySkill["tool.execute.after"]?.(input, output);
          },
        });
      }
      if (interactiveBashSession?.["tool.execute.after"]) {
        nodes.push({
          id: "interactive-bash-session:tool.execute.after",
          invoke: async () => {
            await interactiveBashSession["tool.execute.after"]?.(input, output);
          },
        });
      }
      if (editFailureGuidance?.["tool.execute.after"]) {
        nodes.push({
          id: "edit-failure-guidance:tool.execute.after",
          invoke: async () => {
            await editFailureGuidance["tool.execute.after"]?.(input, output);
          },
        });
      }
      if (delegationFailureGuidance?.["tool.execute.after"]) {
        nodes.push({
          id: "delegation-failure-guidance:tool.execute.after",
          invoke: async () => {
            await delegationFailureGuidance["tool.execute.after"]?.(input, output);
          },
        });
      }
      if (executionOrchestratorHook?.["tool.execute.after"]) {
        nodes.push({
          id: "execution-orchestrator:tool.execute.after",
          invoke: async () => {
            await executionOrchestratorHook["tool.execute.after"]?.(input, output);
          },
        });
      }
      if (taskResumeInfo["tool.execute.after"]) {
        nodes.push({
          id: "internal:task-resume-info:tool.execute.after",
          invoke: async () => {
            await taskResumeInfo["tool.execute.after"]?.(input, output);
          },
        });
      }
      if (sessionHandoffHook?.["tool.execute.after"]) {
        nodes.push({
          id: "session-handoff:tool.execute.after",
          invoke: async () => {
            await sessionHandoffHook["tool.execute.after"]?.(input, output);
          },
        });
      }
      if (swarmAgent?.["tool.execute.after"]) {
        nodes.push({
          id: "swarm-agent:tool.execute.after",
          invoke: async () => {
            await swarmAgent["tool.execute.after"]?.(input, output);
          },
        });
      }

      await executeRuntimePipeline("tool.execute.after", nodes);
    },

    "experimental.session.compacting": async (
      input: { sessionID: string },
      output?: { context: string[] }
    ) => {
      const nodes: RuntimeExecutionNode[] = [];

      if (
        claudeCodeBridgeEnabled &&
        output &&
        Array.isArray(output.context) &&
        claudeCodeHooks["experimental.session.compacting"]
      ) {
        nodes.push({
          id: "bridge:claude-code-hooks:experimental.session.compacting",
          invoke: async () => {
            await claudeCodeHooks["experimental.session.compacting"]?.(input, output);
          },
        });
      }

      if (contextWindowGovernor?.["experimental.session.compacting"]) {
        nodes.push({
          id: "context-window-governor:experimental.session.compacting",
          invoke: async () => {
            await contextWindowGovernor["experimental.session.compacting"]?.(input, output);
          },
        });
      }

      await executeRuntimePipeline("experimental.session.compacting", nodes);
    },
  };
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
