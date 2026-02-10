export type BackgroundTaskStatus =
  | "pending"
  | "running"
  | "completed"
  | "error"
  | "cancelled"
  | "interrupt"

export interface TaskProgress {
  toolCalls: number
  lastTool?: string
  lastUpdate: Date
  lastMessage?: string
  lastMessageAt?: Date
}

export interface BackgroundTask {
  id: string
  sessionID?: string
  parentSessionID: string
  parentMessageID: string
  description: string
  prompt: string
  agent: string
  category?: string
  /** True when the selected model/category is considered unstable (e.g. Gemini); used for babysitting/monitoring. */
  isUnstableAgent?: boolean
  status: BackgroundTaskStatus
  queuedAt?: Date
  startedAt?: Date
  completedAt?: Date
  result?: string
  error?: string
  progress?: TaskProgress
  parentModel?: { providerID: string; modelID: string }
  model?: { providerID: string; modelID: string; variant?: string }
  /** Active concurrency slot key */
  concurrencyKey?: string
  /** Persistent key for re-acquiring concurrency on resume */
  concurrencyGroup?: string
  /** Global parallel-runtime run identifier */
  parallelRunId?: string
  /** Global parallel-runtime lease identifier */
  parallelLeaseId?: string
  /** Parent session's agent name for notification */
  parentAgent?: string
  /** If true, skip parent session notification on completion (for internal orchestration tasks) */
  silent?: boolean
  /** Last message count for stability detection */
  lastMsgCount?: number
  /** Number of consecutive polls with stable message count */
  stablePolls?: number
}

export interface LaunchInput {
  description: string
  prompt: string
  agent: string
  category?: string
  /** True when the selected category/model is marked unstable (non-gemini custom unstable categories included). */
  isUnstableAgent?: boolean
  parentSessionID: string
  parentMessageID: string
  parentModel?: { providerID: string; modelID: string }
  parentAgent?: string
  model?: { providerID: string; modelID: string; variant?: string }
  skills?: string[]
  skillContent?: string
  /** If true, skip parent session notification on completion (for internal orchestration tasks) */
  silent?: boolean
  /** Custom working directory (e.g., git worktree path) - overrides parent directory */
  directory?: string
}

export interface ResumeInput {
  sessionId: string
  prompt: string
  parentSessionID: string
  parentMessageID: string
  parentModel?: { providerID: string; modelID: string }
  parentAgent?: string
}
