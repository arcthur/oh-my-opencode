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
  // NOTE: createCompactionContextInjector removed - OpenCode API does not yet support experimental.session.compacting
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
  createTaskResumeInfoHook,
  createStartWorkHook,
  createAtlasHook,
  createPrometheusMdOnlyHook,
  createMultiPlanTriggerHook,
  createPlanningWithFilesHook,
  createSilentToolOutputHook,
  createAntiSlopEnforcerHook,
  createPreCompletionVerificationHook,
  createDelegationValidatorHook,
} from "./hooks";
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
  interactive_bash,
  startTmuxCheck,
  lspManager,
} from "./tools";
import { BackgroundManager } from "./features/background-agent";
import { SkillMcpManager } from "./features/skill-mcp-manager";
import { initTaskToastManager } from "./features/task-toast-manager";
import { type HookName } from "./config";
import { log, detectExternalNotificationPlugin, getNotificationConflictWarning, resetMessageCursor } from "./shared";
import { loadPluginConfig } from "./plugin-config";
import { createModelCacheState, getModelLimit } from "./plugin-state";
import { createConfigHandler } from "./plugin-handlers";
import type { MessageInput } from "./shared/hook-types";
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
  const directoryAgentsInjector = isHookEnabled("directory-agents-injector")
    ? createDirectoryAgentsInjectorHook(ctx)
    : null;
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
  if (governanceEnabled) {
    log("[governance] Integration enabled", {
      tracer: governanceConfig?.tracer?.enabled,
      budget_monitor: governanceConfig?.budget_monitor?.enabled,
      checkpoint: governanceConfig?.checkpoint?.enabled,
      ledger: governanceConfig?.ledger?.enabled,
    });
  }
  const anthropicContextWindowLimitRecovery = isHookEnabled(
    "context-window-limit-recovery"
  )
    ? createContextWindowLimitRecoveryHook(ctx, {
        experimental: pluginConfig.experimental,
      })
    : null;
  // NOTE: compactionContextInjector removed - OpenCode API does not yet support experimental.session.compacting
  // When API support is added, reintegrate from claude-code-hooks or compaction-context-injector
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

  const atlasHook = isHookEnabled("atlas")
    ? createAtlasHook(ctx)
    : null;

  const prometheusMdOnly = isHookEnabled("prometheus-md-only")
    ? createPrometheusMdOnlyHook(ctx)
    : null;

  const taskResumeInfo = createTaskResumeInfoHook();

  const backgroundManager = new BackgroundManager(ctx);

  initTaskToastManager(ctx.client);

  // Get Prometheus model config (string or array for multi-plan)
  const prometheusModel = pluginConfig.agents?.Prometheus?.model as string | string[] | undefined;

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

  const todoContinuationEnforcer = todoContinuationEnabled
    ? createTodoContinuationEnforcer(ctx, { backgroundManager })
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
  const delegateTask = createDelegateTask({
    manager: backgroundManager,
    client: ctx.client,
    directory: ctx.directory,
    userCategories: pluginConfig.categories,
    gitMasterConfig: pluginConfig.git_master,
  });
  const multiPlanTool = createMultiPlanTool({
    ctx,
    backgroundManager,
    model: prometheusModel,
    pipelineConfig: pluginConfig.multi_plan_pipeline,
  });
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

  const commands = discoverCommandsSync();
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
            throw new Error(govResult.reason ?? "Governance blocked the prompt");
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
          log("[governance] User prompt error (non-fatal)", {
            sessionID: input.sessionID,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      await autoSlashCommand?.["chat.message"]?.(input, output);
      await startWork?.["chat.message"]?.(input, output);
      await multiPlanTrigger?.["chat.message"]?.(input, output);
      await planningWithFiles?.["chat.message"]?.(input, output);
      await preCompletionVerification?.["chat.message"]?.(input, output);

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
      await directoryAgentsInjector?.event(input);
      await directoryReadmeInjector?.event(input);
      await rulesInjector?.event(input);
      await thinkMode?.event(input);
      await anthropicContextWindowLimitRecovery?.event(input);
      await agentUsageReminder?.event(input);
      await interactiveBashSession?.event(input);
      await ralphLoop?.event(input);
      await atlasHook?.handler(input);

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
      // Memory context registration (uses contextCollector with oncePerSession)
      await userMemory?.["tool.execute.before"]?.(input, output);
      await orgMemory?.["tool.execute.before"]?.(input, output);

      // Governance pre-tool checks
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
            throw new Error(govResult.reason ?? "Governance blocked the operation");
          }

          if (govResult.modifiedInput) {
            Object.assign(output.args as Record<string, unknown>, govResult.modifiedInput);
          }

          if (govResult.message) {
            const outputWithMessage = output as { args: unknown; message?: string };
            outputWithMessage.message = (outputWithMessage.message ?? "") + "\n" + govResult.message;
          }
        } catch (err) {
          if (err instanceof Error && err.message.includes("Governance blocked")) {
            throw err;
          }
          log("[governance] Pre-tool error (non-fatal)", {
            sessionID: input.sessionID,
            tool: input.tool,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      await claudeCodeHooks["tool.execute.before"](input, output);
      await nonInteractiveEnv?.["tool.execute.before"](input, output);
      await commentChecker?.["tool.execute.before"](input, output);
      await directoryAgentsInjector?.["tool.execute.before"]?.(input, output);
      await directoryReadmeInjector?.["tool.execute.before"]?.(input, output);
      await rulesInjector?.["tool.execute.before"]?.(input, output);
      await prometheusMdOnly?.["tool.execute.before"]?.(input, output);
      await planningWithFiles?.["tool.execute.before"]?.(input, output);
      await delegationValidator?.["tool.execute.before"]?.(input, output);

      if (input.tool === "task") {
        const args = output.args as Record<string, unknown>;
        const subagentType = args.subagent_type as string;
        const isExploreOrLibrarian = ["explore", "librarian"].includes(
          subagentType
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
            /--completion-promise=["']?([^"'\s]+)["']?/i
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
             /--completion-promise=["']?([^"'\s]+)["']?/i
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

      await silentToolOutput?.["tool.execute.before"]?.(input, output);
    },

    "tool.execute.after": async (input, output) => {
      await planningWithFiles?.["tool.execute.after"]?.(input, output);
      await claudeCodeHooks["tool.execute.after"](input, output);

      // Governance post-tool processing
      if (governanceEnabled) {
        try {
          const govResult = await executePostToolGovernance({
            sessionId: input.sessionID,
            toolName: input.tool,
            toolInput: (input as Record<string, unknown>).args as Record<string, unknown> ?? {},
            toolOutput: output as Record<string, unknown>,
            toolUseId: input.callID,
            success: true,
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

      await antiSlopEnforcer?.["tool.execute.after"]?.(input, output);
      await silentToolOutput?.["tool.execute.after"]?.(input, output);
      await toolOutputTruncator?.["tool.execute.after"](input, output);
      await userMemory?.["tool.execute.after"]?.(input, output);
      await orgMemory?.["tool.execute.after"]?.(input, output);
      await contextWindowMonitor?.["tool.execute.after"](input, output);
      await commentChecker?.["tool.execute.after"](input, output);
      await directoryAgentsInjector?.["tool.execute.after"](input, output);
      await directoryReadmeInjector?.["tool.execute.after"](input, output);
      await rulesInjector?.["tool.execute.after"](input, output);
      await emptyTaskResponseDetector?.["tool.execute.after"](input, output);
      await agentUsageReminder?.["tool.execute.after"](input, output);
      await interactiveBashSession?.["tool.execute.after"](input, output);
await editErrorRecovery?.["tool.execute.after"](input, output);
        await delegateTaskRetry?.["tool.execute.after"](input, output);
        await atlasHook?.["tool.execute.after"]?.(input, output);
      await taskResumeInfo["tool.execute.after"](input, output);
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
