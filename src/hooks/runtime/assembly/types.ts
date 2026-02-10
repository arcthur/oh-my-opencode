import type { PluginInput } from "@opencode-ai/plugin"
import type { Message, Part } from "@opencode-ai/sdk"
import type { GovernanceConfig, OhMyOpenCodeConfig } from "../../../config"
import type { EventInput, MessageInput, ToolExecuteInput } from "../../../shared/hook-types"

export type MaybePromiseVoid = Promise<void> | void

export interface ChatMessageInput {
  sessionID: string
  agent?: string
  messageID?: string
}

export interface ChatMessageOutput {
  parts: Array<{ type: string; text?: string }>
  message: Record<string, unknown> & { variant?: string }
}

export interface UserPromptSubmitInput extends MessageInput {
  parts?: Array<{ type: string; text?: string }>
}

export interface ToolExecuteBeforeOutput {
  args: Record<string, unknown>
  message?: string
}

export interface ToolExecuteAfterOutput {
  title: string
  output: string
  metadata: Record<string, unknown>
  args?: unknown
}

export interface ExperimentalChatTransformOutput {
  messages: Array<{ info: Message; parts: Part[] }>
}

export interface ExperimentalSessionCompactingInput {
  sessionID: string
}

export interface ExperimentalSessionCompactingOutput {
  context: string[]
}

type ChatMessageHandler = (
  input: ChatMessageInput,
  output: ChatMessageOutput
) => MaybePromiseVoid

type UserPromptSubmitHandler = (
  input: UserPromptSubmitInput
) => MaybePromiseVoid

type ToolExecuteBeforeHandler = (
  input: ToolExecuteInput,
  output: ToolExecuteBeforeOutput
) => MaybePromiseVoid

type ToolExecuteAfterHandler = (
  input: ToolExecuteInput,
  output: ToolExecuteAfterOutput
) => MaybePromiseVoid

type EventHandler = (input: EventInput) => MaybePromiseVoid

type ExperimentalChatTransformHandler = (
  input: Record<string, never>,
  output: ExperimentalChatTransformOutput
) => MaybePromiseVoid

type ExperimentalSessionCompactingHandler = (
  input: ExperimentalSessionCompactingInput,
  output?: ExperimentalSessionCompactingOutput
) => MaybePromiseVoid

export interface RuntimeAssemblyContext {
  pluginConfig?: OhMyOpenCodeConfig
  directory?: string
  client?: PluginInput["client"]

  claudeCodeBridgeEnabled?: boolean
  governanceEnabled?: boolean
  governanceConfig?: GovernanceConfig
  governanceBlockPrefix?: string

  firstMessageVariantGate?: {
    shouldOverride: (sessionID: string) => boolean
    markApplied: (sessionID: string) => void
    markSessionCreated: (sessionInfo: { id?: string; title?: string; parentID?: string } | undefined) => void
    clear: (sessionID: string) => void
  }
  resolveAgentVariant?: (config: OhMyOpenCodeConfig, agentName?: string) => string | undefined
  applyAgentVariant?: (
    config: OhMyOpenCodeConfig,
    agentName: string | undefined,
    message: { variant?: string }
  ) => void

  contextCollector?: {
    beginTurn: (sessionID: string) => void
    register: (
      sessionID: string,
      options: {
        id: string
        source: string
        content: string
        priority?: "critical" | "high" | "normal" | "low"
      }
    ) => void
  }

  setMainSession?: (sessionID?: string) => void
  getMainSessionID?: () => string | undefined
  updateSessionAgent?: (sessionID: string, agent: string) => void
  getSessionAgent?: (sessionID: string) => string | undefined

  sessionStateCoordinator?: {
    onSessionCreated: (sessionID: string, parentID?: string, agent?: string) => void
    onSessionDeleted: (sessionID: string) => void
    onSessionCompacted: (sessionID: string) => void
  }

  resetMessageCursor?: (sessionID: string) => void

  swarmRuntime?: {
    unbindSession: (sessionID: string) => void
    unregisterWorker: (sessionID: string) => void
    unregisterCoordinator: (sessionID: string) => void
  }

  skillMcpManager?: {
    disconnectSession: (sessionID: string) => Promise<void>
  }

  lspManager?: {
    cleanupTempDirectoryClients: () => Promise<void>
  }

  continuationControl?: {
    beginEvent: (input: { event: { type: string; properties?: unknown } }) => void
    flushEvent: (input: { event: { type: string; properties?: unknown } }) => Promise<void>
  }

  thinkMode?: {
    ["chat.params"]?: (
      output: {
        parts: Array<{ type: string; text?: string }>
        message: { model?: { providerID: string; modelID: string } }
      },
      sessionID: string
    ) => MaybePromiseVoid
    event?: EventHandler
  }

  keywordDetector?: {
    ["chat.message"]?: ChatMessageHandler
  }

  claudeCodeHooks?: {
    ["chat.message"]?: ChatMessageHandler
    ["tool.execute.before"]?: ToolExecuteBeforeHandler
    ["tool.execute.after"]?: ToolExecuteAfterHandler
    ["experimental.session.compacting"]?: ExperimentalSessionCompactingHandler
    event?: EventHandler
  }

  sessionHandoffHook?: {
    ["chat.message"]?: ChatMessageHandler
    ["user.prompt.submit"]?: UserPromptSubmitHandler
    ["tool.execute.after"]?: ToolExecuteAfterHandler
    event?: EventHandler
  }

  autoSlashCommand?: {
    ["chat.message"]?: ChatMessageHandler
  }

  startWork?: {
    ["chat.message"]?: ChatMessageHandler
  }

  swarmFromPlan?: {
    ["chat.message"]?: ChatMessageHandler
  }

  planningWithFiles?: {
    ["chat.message"]?: ChatMessageHandler
    ["tool.execute.before"]?: ToolExecuteBeforeHandler
    ["tool.execute.after"]?: ToolExecuteAfterHandler
    event?: EventHandler
  }

  preCompletionVerification?: {
    ["chat.message"]?: ChatMessageHandler
    event?: EventHandler
  }

  continuationStopGuard?: {
    ["chat.message"]?: (input: { sessionID: string }) => MaybePromiseVoid
    event?: EventHandler
    stop: (sessionID: string) => void
  }

  ralphLoop?: {
    event?: EventHandler
    startLoop: (
      sessionID: string,
      prompt: string,
      options?: { ultrawork?: boolean; maxIterations?: number; completionPromise?: string }
    ) => void
    cancelLoop: (sessionID: string) => void
  }

  userMemory?: {
    ["user.prompt.submit"]?: UserPromptSubmitHandler
    ["tool.execute.before"]?: ToolExecuteBeforeHandler
    ["tool.execute.after"]?: ToolExecuteAfterHandler
    event?: EventHandler
  }

  orgMemory?: {
    ["user.prompt.submit"]?: UserPromptSubmitHandler
    ["tool.execute.before"]?: ToolExecuteBeforeHandler
    ["tool.execute.after"]?: ToolExecuteAfterHandler
    event?: EventHandler
  }

  contextInjectorMessagesTransform?: {
    ["experimental.chat.messages.transform"]?: ExperimentalChatTransformHandler
  }

  thinkingBlockValidator?: {
    ["experimental.chat.messages.transform"]?: ExperimentalChatTransformHandler
  }

  autoUpdateChecker?: {
    event?: EventHandler
  }

  backgroundNotificationHook?: {
    event?: EventHandler
  }

  sessionNotification?: EventHandler

  taskAutoContinuation?: {
    handler?: EventHandler
    cancelAllCountdowns: () => void
  }

  unstableAgentWatchdog?: {
    event?: EventHandler
  }

  runtimeTracker?: {
    ["tool.execute.before"]?: ToolExecuteBeforeHandler
    ["tool.execute.after"]?: ToolExecuteAfterHandler
    event?: EventHandler
  }

  repoOverviewInjector?: {
    ["tool.execute.after"]?: ToolExecuteAfterHandler
    event?: EventHandler
  }

  contextWindowGovernor?: {
    ["tool.execute.after"]?: ToolExecuteAfterHandler
    ["experimental.session.compacting"]?: ExperimentalSessionCompactingHandler
    event?: EventHandler
  }

  directoryAgentsInjector?: {
    ["tool.execute.before"]?: ToolExecuteBeforeHandler
    ["tool.execute.after"]?: ToolExecuteAfterHandler
    event?: EventHandler
  }

  directoryReadmeInjector?: {
    ["tool.execute.before"]?: ToolExecuteBeforeHandler
    ["tool.execute.after"]?: ToolExecuteAfterHandler
    event?: EventHandler
  }

  rulesInjector?: {
    ["tool.execute.before"]?: ToolExecuteBeforeHandler
    ["tool.execute.after"]?: ToolExecuteAfterHandler
    event?: EventHandler
  }

  delegationNudgeAgentUsage?: {
    ["tool.execute.after"]?: ToolExecuteAfterHandler
    event?: EventHandler
  }

  delegationNudgeCategorySkill?: {
    ["tool.execute.after"]?: ToolExecuteAfterHandler
    event?: EventHandler
  }

  interactiveBashSession?: {
    ["tool.execute.after"]?: ToolExecuteAfterHandler
    event?: EventHandler
  }

  executionOrchestratorHook?: {
    ["tool.execute.before"]?: ToolExecuteBeforeHandler
    ["tool.execute.after"]?: ToolExecuteAfterHandler
    handler?: EventHandler
  }

  conditionalRulesHooks?: {
    ["tool.execute.before"]?: (input: {
      tool: string
      args: Record<string, unknown>
      sessionId: string
      context: { cwd: string; agent?: string }
    }) => MaybePromiseVoid
    ["tool.execute.before:delegate_task"]?: (input: {
      args: Record<string, unknown>
      sessionId: string
      context: { cwd: string; agent?: string }
    }) => Promise<{ args?: Record<string, unknown> } | undefined>
    event?: EventHandler
  }

  tmuxParallelAgents?: {
    ["tool.execute.before"]?: ToolExecuteBeforeHandler
    event?: EventHandler
  }

  swarmAgent?: {
    ["tool.execute.before"]?: ToolExecuteBeforeHandler
    ["tool.execute.after"]?: ToolExecuteAfterHandler
    event?: EventHandler
  }

  sessionStateRepair?: {
    handleSessionRecovery: (messageInfo: {
      id?: string
      role: "assistant"
      sessionID?: string
      error: unknown
    }) => Promise<boolean>
  }

  questionLabelTruncator?: {
    ["tool.execute.before"]?: ToolExecuteBeforeHandler
  }

  delegationBlockSubagentQuestion?: {
    ["tool.execute.before"]?: ToolExecuteBeforeHandler
  }

  writeExistingFileGuard?: {
    ["tool.execute.before"]?: ToolExecuteBeforeHandler
  }

  nonInteractiveEnv?: {
    ["tool.execute.before"]?: ToolExecuteBeforeHandler
  }

  commentChecker?: {
    ["tool.execute.before"]?: ToolExecuteBeforeHandler
    ["tool.execute.after"]?: ToolExecuteAfterHandler
  }

  prometheusMdOnly?: {
    ["tool.execute.before"]?: ToolExecuteBeforeHandler
  }

  delegationValidateDecision?: {
    ["tool.execute.before"]?: ToolExecuteBeforeHandler
  }

  sisyphusJuniorNotepad?: {
    ["tool.execute.before"]?: ToolExecuteBeforeHandler
  }

  contextManifestInjector?: {
    ["tool.execute.before"]?: ToolExecuteBeforeHandler
  }

  silentToolOutput?: {
    ["tool.execute.before"]?: ToolExecuteBeforeHandler
    ["tool.execute.after"]?: ToolExecuteAfterHandler
  }

  antiSlopEnforcer?: {
    ["tool.execute.after"]?: ToolExecuteAfterHandler
  }

  toolOutputTruncator?: {
    ["tool.execute.after"]?: ToolExecuteAfterHandler
  }

  emptyTaskResponseDetector?: {
    ["tool.execute.after"]?: ToolExecuteAfterHandler
  }

  editFailureGuidance?: {
    ["tool.execute.after"]?: ToolExecuteAfterHandler
  }

  delegationFailureGuidance?: {
    ["tool.execute.after"]?: ToolExecuteAfterHandler
  }

  taskResumeInfo?: {
    ["tool.execute.after"]?: ToolExecuteAfterHandler
  }
}
