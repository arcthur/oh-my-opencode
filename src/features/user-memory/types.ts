/**
 * User Memory Types
 *
 * Hierarchical memory system for persistent context across sessions.
 * Inspired by Factory.ai Droid's memory architecture.
 */

export interface EnvironmentInfo {
  /** Operating system */
  os?: string
  /** Shell type (bash, zsh, fish, etc.) */
  shell?: string
  /** Default editor */
  editor?: string
  /** Node.js version if applicable */
  nodeVersion?: string
  /** Python version if applicable */
  pythonVersion?: string
  /** Custom environment notes */
  notes?: string
}

export interface WorkHistoryEntry {
  /** Timestamp of the work session */
  timestamp: number
  /** Brief description of work done */
  summary: string
  /** Project/repository name */
  project?: string
  /** Files that were modified */
  filesModified?: string[]
  /** Outcome (success, partial, failed) */
  outcome?: "success" | "partial" | "failed"
}

export interface UserMemory {
  /** User preferences and settings */
  preferences: Record<string, string>
  /** Development environment information */
  environment: EnvironmentInfo
  /** Recent work history (last N entries) */
  workHistory: WorkHistoryEntry[]
  /** Custom rules/instructions to always apply */
  customRules: string[]
  /** Frequently used commands or patterns */
  frequentPatterns: string[]
  /** Things the user explicitly asked to remember */
  explicitMemories: Array<{
    content: string
    timestamp: number
    context?: string
  }>
  /** Last updated timestamp */
  lastUpdated: number
  /** Schema version for migration */
  schemaVersion: number
}

export interface UserMemoryConfig {
  /** Enable user memory persistence (default: true) */
  enabled: boolean
  /** Persist user preferences (default: true) */
  persist_preferences: boolean
  /** Persist work history (default: true) */
  persist_work_history: boolean
  /** Max work history entries to keep (default: 50) */
  max_history_entries: number
  /** Auto-inject memory context on session start (default: true) */
  auto_inject: boolean
}

export const DEFAULT_USER_MEMORY: UserMemory = {
  preferences: {},
  environment: {},
  workHistory: [],
  customRules: [],
  frequentPatterns: [],
  explicitMemories: [],
  lastUpdated: Date.now(),
  schemaVersion: 1,
}

export const DEFAULT_CONFIG: UserMemoryConfig = {
  enabled: true,
  persist_preferences: true,
  persist_work_history: true,
  max_history_entries: 50,
  auto_inject: true,
}

export const CURRENT_SCHEMA_VERSION = 1
