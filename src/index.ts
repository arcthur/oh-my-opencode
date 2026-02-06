import type { Plugin } from "@opencode-ai/plugin";
import {
  createTodoContinuationEnforcer,
  createContextWindowMonitorHook,
  createSessionRecoveryHook,
  createSessionNotification,
  createCommentCheckerHooks,
  createToolOutputTruncatorHook,
  createDirectoryAgentsInjectorHook,
  createDirectoryReadmeInjectorHook,
  createEmptyTaskResponseDetectorHook,
  createThinkModeHook,
  createClaudeCodeHooksHook,
  createContextWindowLimitRecoveryHook,
  createCompactionContextInjector,
  createRulesInjectorHook,
  createBackgroundNotificationHook,
  createAutoUpdateCheckerHook,
  createKeywordDetectorHook,
  createAgentUsageReminderHook,
  createNonInteractiveEnvHook,
  createInteractiveBashSessionHook,

  createThinkingBlockValidatorHook,
  createRalphLoopHook,
  createAutoSlashCommandHook,
  createEditErrorRecoveryHook,
  createDelegateTaskRetryHook,
  createQuestionLabelTruncatorHook,
  createSubagentQuestionBlockerHook,
  createWriteExistingFileGuardHook,
  createStopContinuationGuardHook,
  createTaskResumeInfoHook,
  createStartWorkHook,
  createAtlasHook,
  createPrometheusMdOnlyHook,
  createMultiPlanTriggerHook,
  createPlanningWithFilesHook,
  createSilentToolOutputHook,
  createContextManifestInjectorHook,
  createSwarmFromPlanHook,
  createAntiSlopEnforcerHook,
  createPreCompletionVerificationHook,
  createDelegationValidatorHook,
  createCategorySkillReminderHook,
  createSisyphusJuniorNotepadHook,
  createTmuxParallelAgentsHook,
  createConditionalRulesHooks,
  createSessionHandoffHook,
  createSwarmAgentHook,
  createPreemptiveCompactionHook,
} from "./hooks";
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
import { createBuiltinSkills } from "./features/builtin-skills";
import { getSystemMcpServerNames } from "./features/claude-code-mcp-loader";
import {
  setMainSession,
  getMainSessionID,
  setSessionAgent,
  updateSessionAgent,
  clearSessionAgent,
  getSessionAgent,
} from "./features/claude-code-session-state";
import { sessionStateCoordinator } from "./features/session-state-coordinator";
import {
  builtinTools,
  createCallOmoAgent,
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
import { type HookName } from "./config";
import { log, detectExternalNotificationPlugin, getNotificationConflictWarning, resetMessageCursor, deepMerge, getOpenCodeVersion, isOpenCodeVersionAtLeast, OPENCODE_NATIVE_AGENTS_INJECTION_VERSION, includesCaseInsensitive } from "./shared";
import { DEFAULT_CONDITIONAL_RULES_CONFIG } from "./features/conditional-rules";
import { DEFAULT_HANDOFF_CONFIG } from "./features/session-handoff";
import { loadPluginConfig } from "./plugin-config";
import { createModelCacheState, getModelLimit } from "./plugin-state";
import { createConfigHandler } from "./plugin-handlers";
import type { MessageInput } from "./shared/hook-types";
import { DEFAULT_SESSION_REFERENCE_CONFIG, type SessionReferenceConfig } from "./config/schema"
import {
  executePreToolGovernance,
  executePostToolGovernance,
  executeUserPromptGovernance,
  cleanupGovernanceSession,
} from "./features/governance";

const OhMyOpenCodePlugin: Plugin = async (ctx) => {
  log("[oh-my-opencode] Plugin loading", { directory: ctx.directory });
  // Start background tmux check immediately
  startTmuxCheck();

  const pluginConfig = loadPluginConfig(ctx.directory, ctx);
  const disabledHooks = new Set(pluginConfig.disabled_hooks ?? []);
  const firstMessageVariantGate = createFirstMessageVariantGate();
  const isHookEnabled = (hookName: HookName) => !disabledHooks.has(hookName);

  const modelCacheState = createModelCacheState();

  const contextWindowMonitor = isHookEnabled("context-window-monitor")
    ? createContextWindowMonitorHook(ctx)
    : null;

  // Preemptive compaction: auto-trigger session summarization before hitting context limit.
  // Enabled by default; disable via disabled_hooks ("preemptive-compaction") or experimental.preemptive_compaction=false.
  const preemptiveCompactionEnabled =
    isHookEnabled("preemptive-compaction") &&
    pluginConfig.experimental?.preemptive_compaction !== false;
  const preemptiveCompaction = preemptiveCompactionEnabled
    ? createPreemptiveCompactionHook(ctx, {
        threshold: pluginConfig.experimental?.preemptive_compaction_threshold,
      })
    : null;
  const sessionRecovery = isHookEnabled("session-recovery")
    ? createSessionRecoveryHook(ctx, { experimental: pluginConfig.experimental })
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
  const claudeCodeHooks = createClaudeCodeHooksHook(
    ctx,
    {
      disabledHooks: (pluginConfig.claude_code?.hooks ?? true) ? undefined : true,
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
  const contextWindowLimitRecovery = isHookEnabled("context-window-limit-recovery")
    ? createContextWindowLimitRecoveryHook(ctx, {
        experimental: pluginConfig.experimental,
      })
    : null;

  const compactionContextInjector = isHookEnabled("compaction-context-injector")
    ? createCompactionContextInjector()
    : null;
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
      source_limits: pluginConfig.context_budget.source_limits,
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

  const userMemory = createUserMemoryHook(ctx, pluginConfig.user_memory, {
    summarizer: createDefaultUserMemorySummarizer(ctx, pluginConfig.user_memory, {
      categories: pluginConfig.categories,
    }),
    collector: contextCollector,
  });
  const orgMemory = createOrgMemoryHook(ctx, pluginConfig.org_memory, {
    collector: contextCollector,
  });
  const agentUsageReminder = isHookEnabled("agent-usage-reminder")
    ? createAgentUsageReminderHook(ctx)
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

  const editErrorRecovery = isHookEnabled("edit-error-recovery")
    ? createEditErrorRecoveryHook(ctx)
    : null;

  const delegateTaskRetry = isHookEnabled("delegate-task-retry")
    ? createDelegateTaskRetryHook(ctx)
    : null;

  const startWork = isHookEnabled("start-work")
    ? createStartWorkHook(ctx)
    : null;

  const swarmFromPlan = isHookEnabled("swarm-from-plan")
    ? createSwarmFromPlanHook(ctx, pluginConfig)
    : null;

  const prometheusMdOnly = isHookEnabled("prometheus-md-only")
    ? createPrometheusMdOnlyHook(ctx)
    : null;

  const taskResumeInfo = createTaskResumeInfoHook();

  const backgroundManager = new BackgroundManager(ctx, pluginConfig.background_task, {
    parallelRuntimeConfig: pluginConfig.parallel_runtime ?? { enabled: true },
  });

  const atlasHook = isHookEnabled("atlas")
    ? createAtlasHook(ctx, { directory: ctx.directory, backgroundManager })
    : null;

  initTaskToastManager(ctx.client);

  const stopContinuationGuard = isHookEnabled("stop-continuation-guard")
    ? createStopContinuationGuardHook(ctx)
    : null;

  const questionLabelTruncator = createQuestionLabelTruncatorHook();
  const subagentQuestionBlocker = createSubagentQuestionBlockerHook();
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

  const todoContinuationEnabled = isHookEnabled("todo-continuation-enforcer");

  const planningWithFiles = isHookEnabled("planning-with-files") && pluginConfig.planning_with_files?.enabled
    ? createPlanningWithFilesHook(ctx, {
        config: pluginConfig.planning_with_files,
        collector: contextCollector,
        todoContinuationEnabled,
      })
    : null;

  const contextManifestInjector = isHookEnabled("context-manifest-injector")
    ? createContextManifestInjectorHook(ctx)
    : null;

  const todoContinuationEnforcer = todoContinuationEnabled
    ? createTodoContinuationEnforcer(ctx, {
        backgroundManager,
        isContinuationStopped: stopContinuationGuard?.isStopped,
      })
    : null;

  const antiSlopEnforcer = isHookEnabled("anti-slop-enforcer")
    ? createAntiSlopEnforcerHook(ctx)
    : null;

  const preCompletionVerification = isHookEnabled("pre-completion-verification")
    ? createPreCompletionVerificationHook(ctx)
    : null;

  const delegationValidator = isHookEnabled("delegation-validator")
    ? createDelegationValidatorHook(ctx)
    : null;

  // Category-skill reminder: pre-decision nudge for orchestrators
  // Complements delegation-validator (post-decision validation)
  const categorySkillReminder = isHookEnabled("category-skill-reminder")
    ? createCategorySkillReminderHook(ctx)
    : null;

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
    ? createSwarmAgentHook(ctx, { config: pluginConfig })
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

  // Session reference config: prefer session_handoff.reference over top-level session_reference
  // If only session_reference is used, log deprecation warning
  const hasNestedReference = pluginConfig.session_handoff?.reference !== undefined
  const hasTopLevelReference = pluginConfig.session_reference !== undefined

  if (hasTopLevelReference && !hasNestedReference) {
    log("[session-handoff] DEPRECATED: 'session_reference' is deprecated. Use 'session_handoff.reference' instead.", {
      level: "warn",
    })
  }

  const sessionReferenceConfig = deepMerge(
    DEFAULT_SESSION_REFERENCE_CONFIG,
    // First apply top-level (deprecated), then nested (preferred) for override
    deepMerge(
      (pluginConfig.session_reference ?? {}) as Partial<SessionReferenceConfig>,
      (pluginConfig.session_handoff?.reference ?? {}) as Partial<SessionReferenceConfig>
    )
  ) as SessionReferenceConfig

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

  if (sessionRecovery && todoContinuationEnforcer) {
    sessionRecovery.setOnAbortCallback(todoContinuationEnforcer.markRecovering);
    sessionRecovery.setOnRecoveryCompleteCallback(
      todoContinuationEnforcer.markRecoveryComplete
    );
  }

  const backgroundNotificationHook = isHookEnabled("background-notification")
    ? createBackgroundNotificationHook(backgroundManager)
    : null;
  const backgroundTools = createBackgroundTools(backgroundManager, ctx.client);

  const callOmoAgent = createCallOmoAgent(ctx, backgroundManager);
  const lookAt = createLookAt(ctx);
  const disabledSkills = new Set(pluginConfig.disabled_skills ?? []);
  const delegateTask = createDelegateTask({
    manager: backgroundManager,
    client: ctx.client,
    directory: ctx.directory,
    userCategories: pluginConfig.categories,
    gitMasterConfig: pluginConfig.git_master,
    disabledSkills,
  });
  const multiPlanTool = createMultiPlanTool({
    ctx,
    backgroundManager,
    model: prometheusModel,
    pipelineConfig: pluginConfig.multi_plan_pipeline,
  });
  const swarmTool = createSwarmTool({
    directory: ctx.directory,
    config: pluginConfig,
    sessionId: getMainSessionID(),
  });
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

  return {
    tool: {
      ...builtinTools,
      ...backgroundTools,
      call_omo_agent: callOmoAgent,
      look_at: lookAt,
      delegate_task: delegateTask,
      multi_plan: multiPlanTool,
      swarm: swarmTool,
      skill: skillTool,
      skill_mcp: skillMcpTool,
      slashcommand: slashcommandTool,
      interactive_bash,
    },

    "chat.message": async (input, output) => {
      if (input.agent) {
        updateSessionAgent(input.sessionID, input.agent);
      }

      const message = (output as { message: { variant?: string } }).message
      if (firstMessageVariantGate.shouldOverride(input.sessionID)) {
        const variant = resolveAgentVariant(pluginConfig, input.agent)
        if (variant !== undefined) {
          message.variant = variant
        }
        firstMessageVariantGate.markApplied(input.sessionID)
      } else {
        applyAgentVariant(pluginConfig, input.agent, message)
      }

      // Think-mode must run before keyword-detector injection so detection sees the raw user prompt.
      await thinkMode?.["chat.params"]?.(output as any, input.sessionID)

      await keywordDetector?.["chat.message"]?.(input, output);
      await claudeCodeHooks["chat.message"]?.(input, output);

      // Governance user prompt processing
      if (governanceEnabled) {
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
          // Re-throw governance blocks, swallow other errors
          if (err instanceof Error && err.message.startsWith(GOVERNANCE_BLOCK_PREFIX)) {
            throw err;
          }
          log("[governance] User prompt error (non-fatal)", {
            sessionID: input.sessionID,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      // Session handoff must run before autoSlashCommand to handle /handoff commands
      await sessionHandoffHook?.["chat.message"]?.(input, output);
      await autoSlashCommand?.["chat.message"]?.(input, output);
      await startWork?.["chat.message"]?.(input, output);
      await swarmFromPlan?.["chat.message"]?.(input, output);
      await multiPlanTrigger?.["chat.message"]?.(input, output);
      await planningWithFiles?.["chat.message"]?.(input, output);
      await preCompletionVerification?.["chat.message"]?.(input, output);
      await stopContinuationGuard?.["chat.message"]?.({ sessionID: input.sessionID });

      if (ralphLoop) {
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
      }
    },

    "user.prompt.submit": async (input: MessageInput) => {
      await userMemory["user.prompt.submit"]?.(input);
      await orgMemory["user.prompt.submit"]?.(input);
      await sessionHandoffHook?.["user.prompt.submit"]?.(input as { sessionID: string; parts?: Array<{ type: string; text?: string }> });
    },

    "experimental.chat.messages.transform": async (
      input: Record<string, never>,
      output: { messages: Array<{ info: unknown; parts: unknown[] }> }
    ) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await contextInjectorMessagesTransform?.["experimental.chat.messages.transform"]?.(input, output as any);
      await thinkingBlockValidator?.[
        "experimental.chat.messages.transform"
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ]?.(input, output as any);

    },

    config: configHandler,

    event: async (input) => {
      await stopContinuationGuard?.event(input as { event: { type: string; properties?: unknown } });
      await autoUpdateChecker?.event(input);
      await claudeCodeHooks.event(input);
      await backgroundNotificationHook?.event(input);
      await sessionNotification?.(input);
      await todoContinuationEnforcer?.handler(input);
      await preCompletionVerification?.event?.(input);
      await planningWithFiles?.event?.(input);
      await userMemory?.event(input);
      await orgMemory?.event(input);
      await contextWindowMonitor?.event(input);
      await preemptiveCompaction?.event?.(input);
      await directoryAgentsInjector?.event(input);
      await directoryReadmeInjector?.event(input);
      await rulesInjector?.event(input);
      await thinkMode?.event(input);
      await contextWindowLimitRecovery?.event(input);
      await agentUsageReminder?.event(input);
      await categorySkillReminder?.event?.(input);
      await interactiveBashSession?.event(input);
      await ralphLoop?.event(input);
      await atlasHook?.handler(input);
      await conditionalRulesHooks?.event?.(input as { event: { type: string; properties?: unknown } });
      await sessionHandoffHook?.event?.(input);
      await tmuxParallelAgents?.event?.(input);
      await swarmAgent?.event?.(input);

      const { event } = input;
      const props = event.properties as Record<string, unknown> | undefined;

      if (event.type === "session.created") {
        const sessionInfo = props?.info as
          | { id?: string; title?: string; parentID?: string }
          | undefined;
        if (!sessionInfo?.parentID) {
          setMainSession(sessionInfo?.id);
          sessionStateCoordinator.setMainSessionID(sessionInfo?.id);
        }
        if (sessionInfo?.id) {
          const agent = (props as Record<string, unknown>)?.agent as string | undefined;
          sessionStateCoordinator.onSessionCreated(sessionInfo.id, sessionInfo.parentID, agent);
        }
        firstMessageVariantGate.markSessionCreated(sessionInfo);
      }

      if (event.type === "session.deleted") {
        const sessionInfo = props?.info as { id?: string } | undefined;
        if (sessionInfo?.id === getMainSessionID()) {
          setMainSession(undefined);
          sessionStateCoordinator.setMainSessionID(undefined);
        }
        if (sessionInfo?.id) {
          // Dispatch to coordinator first (handlers do their cleanup, including contextCollector)
          sessionStateCoordinator.onSessionDeleted(sessionInfo.id);
          // Then clean up plugin-level state (not covered by coordinator handlers)
          clearSessionAgent(sessionInfo.id);
          resetMessageCursor(sessionInfo.id);
          firstMessageVariantGate.clear(sessionInfo.id);
          await skillMcpManager.disconnectSession(sessionInfo.id);
          await lspManager.cleanupTempDirectoryClients();

          // Cleanup governance session
          if (governanceEnabled) {
            try {
              cleanupGovernanceSession(sessionInfo.id);
            } catch (err) {
              log("[governance] Session cleanup error (non-fatal)", {
                sessionID: sessionInfo.id,
                error: err instanceof Error ? err.message : String(err),
              });
            }
          }
        }
      }

      if (event.type === "session.compacted") {
        const sessionID = props?.sessionID as string | undefined;
        if (sessionID) {
          // Coordinator dispatches to handlers (including contextCollector.resetOncePerSession)
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

      if (event.type === "session.error") {
        const sessionID = props?.sessionID as string | undefined;
        const error = props?.error;

        if (sessionRecovery?.isRecoverableError(error)) {
          const messageInfo = {
            id: props?.messageID as string | undefined,
            role: "assistant" as const,
            sessionID,
            error,
          };
          const recovered =
            await sessionRecovery.handleSessionRecovery(messageInfo);

          if (recovered && sessionID && sessionID === getMainSessionID()) {
            await ctx.client.session
              .prompt({
                path: { id: sessionID },
                body: { parts: [{ type: "text", text: "continue" }] },
                query: { directory: ctx.directory },
              })
              .catch(() => {});
          }
        }
      }
    },

    "tool.execute.before": async (input, output) => {
      // Question label truncation (runs early to fix labels before other processing)
      await questionLabelTruncator?.["tool.execute.before"]?.(input, output);
      // Block question tool calls from subagent sessions
      await subagentQuestionBlocker?.["tool.execute.before"]?.(input, output);
      // Guard against accidental overwrites: force edit tool for existing files
      await writeExistingFileGuard?.["tool.execute.before"]?.(input, output);

      // Memory context registration (uses contextCollector with oncePerSession)
      await userMemory?.["tool.execute.before"]?.(input, output);
      await orgMemory?.["tool.execute.before"]?.(input, output);

      await claudeCodeHooks["tool.execute.before"](input, output);
      await nonInteractiveEnv?.["tool.execute.before"](input, output);
      await commentChecker?.["tool.execute.before"](input, output);
      await directoryAgentsInjector?.["tool.execute.before"]?.(input, output);
      await directoryReadmeInjector?.["tool.execute.before"]?.(input, output);
      await rulesInjector?.["tool.execute.before"]?.(input, output);
      await prometheusMdOnly?.["tool.execute.before"]?.(input, output);
      await planningWithFiles?.["tool.execute.before"]?.(input, output);
      await delegationValidator?.["tool.execute.before"]?.(input, output);
      await sisyphusJuniorNotepad?.["tool.execute.before"]?.(input, output);
      await atlasHook?.["tool.execute.before"]?.(input, output);
      await tmuxParallelAgents?.["tool.execute.before"]?.(input, output);
      await swarmAgent?.["tool.execute.before"]?.(input, output);

      // Conditional rules for file operations
      if (conditionalRulesHooks) {
        const currentAgent = getSessionAgent(input.sessionID);
        await conditionalRulesHooks["tool.execute.before"]?.({
          tool: input.tool,
          args: output.args as Record<string, unknown>,
          sessionId: input.sessionID,
          context: { cwd: ctx.directory, agent: currentAgent },
        });

        // Special handling for delegate_task to modify prompt with applicable rules
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
      }

      await contextManifestInjector?.["tool.execute.before"]?.(input, output);

      if (input.tool === "task") {
        const args = output.args as Record<string, unknown>;
        const subagentType = args.subagent_type as string;
        const isExploreOrLibrarian = includesCaseInsensitive(
          ["explore", "librarian"],
          subagentType ?? ""
        );

        args.tools = {
          ...(args.tools as Record<string, boolean> | undefined),
          delegate_task: false,
          ...(isExploreOrLibrarian ? { call_omo_agent: false } : {}),
        };
      }

      if (ralphLoop && input.tool === "slashcommand") {
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
      }

      if (input.tool === "slashcommand") {
        const args = output.args as { command?: string } | undefined;
        const command = args?.command?.replace(/^\//, "").toLowerCase();
        const sessionID = input.sessionID || getMainSessionID();

        if (command === "stop-continuation" && sessionID) {
          stopContinuationGuard?.stop(sessionID);
          todoContinuationEnforcer?.cancelAllCountdowns();
          ralphLoop?.cancelLoop(sessionID);
          createWorkStateManager(ctx.directory).clear();
          log("[stop-continuation] All continuation mechanisms stopped", {
            sessionID,
          });
        }
      }

	      // Governance pre-tool checks (run late to capture final args and avoid tracing denied calls)
      if (governanceEnabled) {
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
      }

      await silentToolOutput?.["tool.execute.before"]?.(input, output);
    },

    "tool.execute.after": async (input, output) => {
      // Guard against undefined output (e.g., from /review command - see issue #1035)
      if (!output) {
        return;
      }
      await planningWithFiles?.["tool.execute.after"]?.(input, output);
      await claudeCodeHooks["tool.execute.after"](input, output);

      await antiSlopEnforcer?.["tool.execute.after"]?.(input, output);
      await silentToolOutput?.["tool.execute.after"]?.(input, output);
      await toolOutputTruncator?.["tool.execute.after"](input, output);

      // Governance post-tool processing (run after output shaping so budget estimates match actual context)
      if (governanceEnabled) {
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
      }

      await userMemory?.["tool.execute.after"]?.(input, output);
      await orgMemory?.["tool.execute.after"]?.(input, output);
      await preemptiveCompaction?.["tool.execute.after"]?.(input, output);
      await contextWindowMonitor?.["tool.execute.after"](input, output);
      await commentChecker?.["tool.execute.after"](input, output);
      await directoryAgentsInjector?.["tool.execute.after"](input, output);
      await directoryReadmeInjector?.["tool.execute.after"](input, output);
      await rulesInjector?.["tool.execute.after"](input, output);
      await emptyTaskResponseDetector?.["tool.execute.after"](input, output);
      await agentUsageReminder?.["tool.execute.after"](input, output);
      await categorySkillReminder?.["tool.execute.after"]?.(input, output);
      await interactiveBashSession?.["tool.execute.after"](input, output);
      await editErrorRecovery?.["tool.execute.after"](input, output);
      await delegateTaskRetry?.["tool.execute.after"](input, output);
      await atlasHook?.["tool.execute.after"]?.(input, output);
      await taskResumeInfo["tool.execute.after"](input, output);
      await sessionHandoffHook?.["tool.execute.after"]?.(input, output);
      await swarmAgent?.["tool.execute.after"]?.(input, output);
    },

    "experimental.session.compacting": async (
      input: { sessionID: string },
      output?: { context: string[] }
    ) => {
      // Claude Code compatibility: allow PreCompact hooks to inject extra compaction context
      if (output && Array.isArray(output.context)) {
        await claudeCodeHooks["experimental.session.compacting"]?.(input, output);
      }

      if (!compactionContextInjector) {
        return;
      }

      // Best-effort: infer provider/model from recent assistant messages for accurate injection metadata
      let providerID = "anthropic";
      let modelID = "claude-opus-4-5";
      try {
        const messagesResp = await ctx.client.session.messages({
          path: { id: input.sessionID },
        });
        const payload = messagesResp as { data?: Array<{ info?: Record<string, unknown> }> } | Array<{ info?: Record<string, unknown> }>;
        const messages = Array.isArray(payload) ? payload : (payload.data ?? []);

        for (let i = messages.length - 1; i >= 0; i--) {
          const info = messages[i]?.info as Record<string, unknown> | undefined;
          const model = info?.model as { providerID?: string; modelID?: string } | undefined;
          const infoProviderID = info?.providerID as string | undefined;
          const infoModelID = info?.modelID as string | undefined;

          if (model?.providerID && model?.modelID) {
            providerID = model.providerID;
            modelID = model.modelID;
            break;
          }
          if (infoProviderID && infoModelID) {
            providerID = infoProviderID;
            modelID = infoModelID;
            break;
          }
        }
      } catch {
        // Best-effort only; compaction should proceed even if metadata is unavailable
      }

      await compactionContextInjector({
        sessionID: input.sessionID,
        providerID,
        modelID,
        usageRatio: 0.8,
        directory: ctx.directory,
      });
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
