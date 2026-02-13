import type { PluginInput } from "@opencode-ai/plugin"
import type { Message, Part } from "@opencode-ai/sdk"
import type { GovernanceConfig, OhMyOpenCodeConfig } from "../../../config"
import type { HookPoint, PolicyDecision, PolicyEventInput } from "../../../contracts"
import type {
  ExecutionBudgetLimits,
  SessionExecutionBudgetManager,
} from "../../../features/policy-runtime/execution-budget"
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

  persistGovernanceTraceSnapshot?: (sessionID: string) => boolean

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

  workOrchestrator?: {
    ["chat.message"]?: ChatMessageHandler
    ["tool.execute.before"]?: ToolExecuteBeforeHandler
    ["tool.execute.after"]?: ToolExecuteAfterHandler
    event?: EventHandler
    stopContinuation: (sessionID: string) => void
    isContinuationStopped: (sessionID: string) => boolean
    getContinuationRound: (sessionID: string) => number | undefined
  }

  preCompletionVerification?: {
    ["chat.message"]?: ChatMessageHandler
    event?: EventHandler
  }

  sisyphusContextualInjector?: {
    ["chat.message"]?: ChatMessageHandler
    ["tool.execute.before"]?: ToolExecuteBeforeHandler
    event?: EventHandler
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

  nonInteractiveEnv?: {
    ["tool.execute.before"]?: ToolExecuteBeforeHandler
  }

  commentChecker?: {
    ["tool.execute.before"]?: ToolExecuteBeforeHandler
    ["tool.execute.after"]?: ToolExecuteAfterHandler
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

  policyRuntime?: {
    observe?: (event: PolicyEventInput) => Promise<void>
    enforce?: (event: PolicyEventInput) => Promise<PolicyDecision[]>
    recordSuperseded?: (params: {
      sessionID: string
      hookPoint: HookPoint
      decisions: PolicyDecision[]
      reason: string
    }) => void
  }

  executionBudgetManager?: SessionExecutionBudgetManager
  executionBudgetLimits?: ExecutionBudgetLimits
}
