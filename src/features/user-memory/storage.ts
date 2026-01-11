import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { join } from "node:path"
import { homedir } from "node:os"
import type { UserMemory, WorkHistoryEntry, UserMemoryConfig } from "./types"
import { DEFAULT_USER_MEMORY, CURRENT_SCHEMA_VERSION } from "./types"
import { log } from "../../shared/logger"

const MEMORY_DIR = join(homedir(), ".opencode", "memory")
const USER_MEMORY_FILE = join(MEMORY_DIR, "user.json")

function ensureMemoryDir(): void {
  if (!existsSync(MEMORY_DIR)) {
    mkdirSync(MEMORY_DIR, { recursive: true })
  }
}

/**
 * Load user memory from persistent storage
 */
export function loadUserMemory(): UserMemory {
  try {
    ensureMemoryDir()

    if (!existsSync(USER_MEMORY_FILE)) {
      return { ...DEFAULT_USER_MEMORY }
    }

    const data = JSON.parse(readFileSync(USER_MEMORY_FILE, "utf-8")) as UserMemory

    // Migrate if needed
    if (data.schemaVersion !== CURRENT_SCHEMA_VERSION) {
      return migrateUserMemory(data)
    }

    return data
  } catch (error) {
    log("[user-memory] failed to load memory", { error: String(error) })
    return { ...DEFAULT_USER_MEMORY }
  }
}

/**
 * Save user memory to persistent storage
 */
export function saveUserMemory(memory: UserMemory): void {
  try {
    ensureMemoryDir()
    memory.lastUpdated = Date.now()
    memory.schemaVersion = CURRENT_SCHEMA_VERSION
    writeFileSync(USER_MEMORY_FILE, JSON.stringify(memory, null, 2), "utf-8")
    log("[user-memory] saved memory")
  } catch (error) {
    log("[user-memory] failed to save memory", { error: String(error) })
  }
}

/**
 * Migrate user memory from older schema versions
 */
function migrateUserMemory(data: Partial<UserMemory>): UserMemory {
  log("[user-memory] migrating from schema version", { from: data.schemaVersion, to: CURRENT_SCHEMA_VERSION })

  return {
    preferences: data.preferences || {},
    environment: data.environment || {},
    workHistory: data.workHistory || [],
    customRules: data.customRules || [],
    frequentPatterns: data.frequentPatterns || [],
    explicitMemories: data.explicitMemories || [],
    lastUpdated: Date.now(),
    schemaVersion: CURRENT_SCHEMA_VERSION,
  }
}

/**
 * Update a specific preference
 */
export function setPreference(key: string, value: string): void {
  const memory = loadUserMemory()
  memory.preferences[key] = value
  saveUserMemory(memory)
}

/**
 * Get a specific preference
 */
export function getPreference(key: string): string | undefined {
  const memory = loadUserMemory()
  return memory.preferences[key]
}

/**
 * Add a work history entry
 */
export function addWorkHistoryEntry(
  entry: Omit<WorkHistoryEntry, "timestamp">,
  config: UserMemoryConfig
): void {
  if (!config.persist_work_history) return

  const memory = loadUserMemory()

  memory.workHistory.unshift({
    ...entry,
    timestamp: Date.now(),
  })

  // Trim to max entries
  if (memory.workHistory.length > config.max_history_entries) {
    memory.workHistory = memory.workHistory.slice(0, config.max_history_entries)
  }

  saveUserMemory(memory)
}

/**
 * Add an explicit memory (something the user asked to remember)
 */
export function addExplicitMemory(content: string, context?: string): void {
  const memory = loadUserMemory()

  memory.explicitMemories.push({
    content,
    timestamp: Date.now(),
    context,
  })

  saveUserMemory(memory)
}

/**
 * Add a custom rule
 */
export function addCustomRule(rule: string): void {
  const memory = loadUserMemory()

  if (!memory.customRules.includes(rule)) {
    memory.customRules.push(rule)
    saveUserMemory(memory)
  }
}

/**
 * Remove a custom rule
 */
export function removeCustomRule(rule: string): void {
  const memory = loadUserMemory()
  memory.customRules = memory.customRules.filter(r => r !== rule)
  saveUserMemory(memory)
}

/**
 * Update environment info
 */
export function updateEnvironment(env: Partial<UserMemory["environment"]>): void {
  const memory = loadUserMemory()
  memory.environment = { ...memory.environment, ...env }
  saveUserMemory(memory)
}

/**
 * Clear all user memory
 */
export function clearUserMemory(): void {
  saveUserMemory({ ...DEFAULT_USER_MEMORY })
}

/**
 * Get memory summary for injection
 */
export function getMemorySummary(): string | null {
  const memory = loadUserMemory()

  const sections: string[] = []

  // Custom rules
  if (memory.customRules.length > 0) {
    sections.push(`## User Rules\n${memory.customRules.map(r => `- ${r}`).join("\n")}`)
  }

  // Explicit memories
  if (memory.explicitMemories.length > 0) {
    const recentMemories = memory.explicitMemories.slice(-10) // Last 10
    sections.push(`## Remembered Context\n${recentMemories.map(m => `- ${m.content}`).join("\n")}`)
  }

  // Preferences
  const prefEntries = Object.entries(memory.preferences)
  if (prefEntries.length > 0) {
    sections.push(`## User Preferences\n${prefEntries.map(([k, v]) => `- ${k}: ${v}`).join("\n")}`)
  }

  // Environment
  const envParts: string[] = []
  if (memory.environment.os) envParts.push(`OS: ${memory.environment.os}`)
  if (memory.environment.shell) envParts.push(`Shell: ${memory.environment.shell}`)
  if (memory.environment.editor) envParts.push(`Editor: ${memory.environment.editor}`)
  if (envParts.length > 0) {
    sections.push(`## Environment\n${envParts.join(", ")}`)
  }

  // Recent work (last 3)
  if (memory.workHistory.length > 0) {
    const recent = memory.workHistory.slice(0, 3)
    const workLines = recent.map(w => {
      const date = new Date(w.timestamp).toLocaleDateString()
      return `- [${date}] ${w.summary}${w.project ? ` (${w.project})` : ""}`
    })
    sections.push(`## Recent Work\n${workLines.join("\n")}`)
  }

  if (sections.length === 0) return null

  return `[User Memory - Persistent Context]\n${sections.join("\n\n")}\n[End User Memory]`
}
