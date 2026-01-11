/**
 * User Memory Module
 *
 * Provides persistent memory across sessions, inspired by Factory.ai Droid's
 * hierarchical memory system. Stores:
 * - User preferences
 * - Environment information
 * - Work history
 * - Custom rules/instructions
 * - Explicit memories (things user asked to remember)
 */

export type {
  UserMemory,
  UserMemoryConfig,
  EnvironmentInfo,
  WorkHistoryEntry,
} from "./types"

export {
  DEFAULT_USER_MEMORY,
  DEFAULT_CONFIG,
  CURRENT_SCHEMA_VERSION,
} from "./types"

export {
  loadUserMemory,
  saveUserMemory,
  setPreference,
  getPreference,
  addWorkHistoryEntry,
  addExplicitMemory,
  addCustomRule,
  removeCustomRule,
  updateEnvironment,
  clearUserMemory,
  getMemorySummary,
} from "./storage"

export { createUserMemoryHook } from "./hook"
