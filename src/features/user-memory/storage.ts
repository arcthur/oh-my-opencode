import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync } from "node:fs"
import { join } from "node:path"
import { homedir } from "node:os"
import type { UserMemory, WorkHistoryEntry, UserMemoryConfig, PatternStats, FrequentPatternConfig, TemporalValidityConfig } from "./types"
import { DEFAULT_USER_MEMORY, CURRENT_SCHEMA_VERSION, DEFAULT_PATTERN_STATS, DEFAULT_PATTERN_CONFIG, DEFAULT_TEMPORAL_VALIDITY_CONFIG } from "./types"
import { log } from "../../shared/logger"
import { filterKnowledgeForInjection, filterWorkHistoryForInjection } from "./temporal-validity"

const MEMORY_DIR = join(homedir(), ".opencode", "memory")
const USER_MEMORY_FILE = join(MEMORY_DIR, "user.json")
const PATTERN_STATS_FILE = join(MEMORY_DIR, "pattern-stats.json")

function ensureMemoryDir(): void {
  if (!existsSync(MEMORY_DIR)) {
    mkdirSync(MEMORY_DIR, { recursive: true })
  }
}

/**
 * Atomic file write: write to temp file then rename
 * This prevents partial writes from corrupting the file on crash or concurrent access
 */
function atomicWriteFileSync(filePath: string, content: string): void {
  const tempPath = filePath + ".tmp"
  writeFileSync(tempPath, content, "utf-8")
  renameSync(tempPath, filePath)  // rename is atomic on POSIX systems
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

    const data = JSON.parse(readFileSync(USER_MEMORY_FILE, "utf-8")) as Partial<UserMemory>
    return normalizeUserMemory(data)
  } catch (error) {
    log("[user-memory] failed to load memory", { error: String(error) })
    return { ...DEFAULT_USER_MEMORY }
  }
}

/**
 * Save user memory to persistent storage
 * Uses atomic write (temp file + rename) to prevent corruption
 */
export function saveUserMemory(memory: UserMemory): void {
  try {
    ensureMemoryDir()
    memory.lastUpdated = Date.now()
    memory.schemaVersion = CURRENT_SCHEMA_VERSION
    atomicWriteFileSync(USER_MEMORY_FILE, JSON.stringify(memory, null, 2))
    log("[user-memory] saved memory")
  } catch (error) {
    log("[user-memory] failed to save memory", { error: String(error) })
  }
}

/**
 * Ensure user memory has all required fields with defaults
 */
function normalizeUserMemory(data: Partial<UserMemory>): UserMemory {
  return {
    preferences: data.preferences || {},
    environment: data.environment || {},
    workHistory: data.workHistory || [],
    customRules: data.customRules || [],
    frequentPatterns: data.frequentPatterns || [],
    explicitMemories: data.explicitMemories || [],
    lastUpdated: Date.now(),
    schemaVersion: CURRENT_SCHEMA_VERSION,
    weeklySummaries: data.weeklySummaries || [],
    monthlySummaries: data.monthlySummaries || [],
    longTermKnowledge: data.longTermKnowledge || [],
    lastWeeklyAggregation: data.lastWeeklyAggregation,
    lastMonthlyAggregation: data.lastMonthlyAggregation,
    lastKnowledgeExtraction: data.lastKnowledgeExtraction,
    entityGraph: data.entityGraph,
    lastEntityExtraction: data.lastEntityExtraction,
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
 * Disclosure level for progressive context loading.
 * Higher levels include more detail but consume more tokens.
 *
 * - minimal: ~50 tokens - Rules + top knowledge only
 * - standard: ~150 tokens - + summaries + preferences (default)
 * - full: ~300 tokens - + entity graph + all work history
 */
export type DisclosureLevel = "minimal" | "standard" | "full"

/**
 * Get memory summary for injection
 *
 * Supports progressive disclosure to optimize token usage:
 * - minimal: Just rules and top 3 knowledge items (~50 tokens)
 * - standard: + weekly/monthly summaries + preferences (~150 tokens)
 * - full: + entity graph + all work history (~300 tokens)
 *
 * Includes hierarchical memory from RAPTOR aggregation:
 * - L3: Long-term knowledge (high-confidence distilled insights)
 * - L2: Monthly summary (last month's overview)
 * - L1: Weekly summary (this week's progress)
 * - L0: Recent work history (last 3 entries)
 */
export function getMemorySummary(
  temporalConfig: TemporalValidityConfig = DEFAULT_TEMPORAL_VALIDITY_CONFIG,
  disclosureLevel: DisclosureLevel = "standard"
): string | null {
  const memory = loadUserMemory()
  const sections: string[] = []

  // ============================================================================
  // MINIMAL LEVEL: Rules + Top Knowledge (~50 tokens)
  // Always included regardless of disclosure level
  // ============================================================================

  // Custom rules (highest priority - always include)
  if (memory.customRules.length > 0) {
    sections.push(`## User Rules\n${memory.customRules.map(r => `- ${r}`).join("\n")}`)
  }

  // Explicit memories (always include)
  if (memory.explicitMemories.length > 0) {
    const limit = disclosureLevel === "minimal" ? 5 : 10
    const recentMemories = memory.explicitMemories.slice(-limit)
    sections.push(`## Remembered Context\n${recentMemories.map(m => `- ${m.content}`).join("\n")}`)
  }

  // L3: Long-term Knowledge (with temporal filtering)
  const knowledgeLimit = disclosureLevel === "minimal" ? 3 : 5
  const validKnowledge = memory.longTermKnowledge
    ? filterKnowledgeForInjection(memory.longTermKnowledge, temporalConfig, knowledgeLimit)
    : []

  if (validKnowledge.length > 0) {
    const knowledgeLines = validKnowledge.map(k =>
      `- [${k.category}] ${k.content}`
    )
    sections.push(`## Long-term Learnings\n${knowledgeLines.join("\n")}`)
  }

  // Early return for minimal disclosure
  if (disclosureLevel === "minimal") {
    if (sections.length === 0) return null
    return `[User Memory - Minimal]\n${sections.join("\n\n")}\n[End User Memory]`
  }

  // ============================================================================
  // STANDARD LEVEL: + Summaries + Preferences (~150 tokens)
  // ============================================================================

  // L2: Last Month Summary
  const recentMonth = memory.monthlySummaries?.[0]
  if (recentMonth) {
    sections.push(
      `## Last Month (${recentMonth.month})\n${recentMonth.summary}` +
      (recentMonth.projects.length > 0
        ? `\nProjects: ${recentMonth.projects.slice(0, 3).join(", ")}`
        : "")
    )
  }

  // L1: This Week Summary
  const recentWeek = memory.weeklySummaries?.[0]
  if (recentWeek) {
    const achievements = recentWeek.keyAchievements.slice(0, 2).join("; ")
    sections.push(
      `## This Week\n${recentWeek.summary}` +
      (achievements ? `\nKey: ${achievements}` : "")
    )
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

  // Early return for standard disclosure
  if (disclosureLevel === "standard") {
    if (sections.length === 0) return null
    return `[User Memory - Hierarchical Context]\n${sections.join("\n\n")}\n[End User Memory]`
  }

  // ============================================================================
  // FULL LEVEL: + Entity Graph + All Work History (~300 tokens)
  // ============================================================================

  // L0: Recent work (with temporal filtering)
  if (memory.workHistory.length > 0) {
    const recent = filterWorkHistoryForInjection(memory.workHistory, temporalConfig, 5)
    if (recent.length > 0) {
      const workLines = recent.map(w => {
        const date = new Date(w.timestamp).toLocaleDateString()
        return `- [${date}] ${w.summary}${w.project ? ` (${w.project})` : ""}`
      })
      sections.push(`## Recent Work\n${workLines.join("\n")}`)
    }
  }

  // Entity Graph (full disclosure only)
  if (memory.entityGraph && Object.keys(memory.entityGraph.nodes).length > 0) {
    const entityLines: string[] = []
    const nodesByType: Record<string, string[]> = {}

    // Group entities by type
    for (const node of Object.values(memory.entityGraph.nodes)) {
      if (!nodesByType[node.type]) nodesByType[node.type] = []
      const aliases = node.aliases.length > 0 ? ` (aka ${node.aliases.slice(0, 2).join(", ")})` : ""
      nodesByType[node.type].push(`${node.name}${aliases}`)
    }

    // Format by type
    if (nodesByType.person?.length) {
      entityLines.push(`People: ${nodesByType.person.slice(0, 5).join(", ")}`)
    }
    if (nodesByType.project?.length) {
      entityLines.push(`Projects: ${nodesByType.project.slice(0, 5).join(", ")}`)
    }
    if (nodesByType.technology?.length) {
      entityLines.push(`Technologies: ${nodesByType.technology.slice(0, 5).join(", ")}`)
    }
    if (nodesByType.organization?.length) {
      entityLines.push(`Organizations: ${nodesByType.organization.slice(0, 3).join(", ")}`)
    }

    // Add key relationships
    const topRelations = memory.entityGraph.relationships
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 5)  // More relations in full mode
    if (topRelations.length > 0) {
      const relLines = topRelations.map(r => {
        const subj = memory.entityGraph!.nodes[r.subject]?.name ?? r.subject
        const obj = memory.entityGraph!.nodes[r.object]?.name ?? r.object
        return `${subj} ${r.predicate.replace(/_/g, " ")} ${obj}`
      })
      entityLines.push(`Relations: ${relLines.join("; ")}`)
    }

    if (entityLines.length > 0) {
      sections.push(`## Known Entities\n${entityLines.join("\n")}`)
    }
  }

  // Frequent operations
  if (memory.frequentPatterns.length > 0) {
    const patterns = memory.frequentPatterns.slice(0, 10)
    sections.push(`## Frequent Operations\n${patterns.map(p => `- ${p}`).join("\n")}`)
  }

  if (sections.length === 0) return null

  return `[User Memory - Full Context]\n${sections.join("\n\n")}\n[End User Memory]`
}

// ============================================================================
// Pattern Statistics API
// ============================================================================

/**
 * Load pattern statistics from persistent storage
 */
export function loadPatternStats(): PatternStats {
  try {
    ensureMemoryDir()

    if (!existsSync(PATTERN_STATS_FILE)) {
      return { ...DEFAULT_PATTERN_STATS }
    }

    const data = JSON.parse(readFileSync(PATTERN_STATS_FILE, "utf-8")) as PatternStats
    return data
  } catch (error) {
    log("[user-memory] failed to load pattern stats", { error: String(error) })
    return { ...DEFAULT_PATTERN_STATS }
  }
}

/**
 * Save pattern statistics to persistent storage
 */
export function savePatternStats(stats: PatternStats): void {
  try {
    ensureMemoryDir()
    atomicWriteFileSync(PATTERN_STATS_FILE, JSON.stringify(stats, null, 2))
  } catch (error) {
    log("[user-memory] failed to save pattern stats", { error: String(error) })
  }
}

/**
 * Normalize tool arguments to a directory-level pattern
 * e.g., "src/hooks/preemptive-compaction/index.ts" -> "src/hooks/*"
 */
export function normalizeArgsToPattern(tool: string, args: unknown): string | null {
  if (!args || typeof args !== "object") return null

  const argsObj = args as Record<string, unknown>

  // Handle file-based tools (Read, Write, Edit, Glob)
  if (tool === "Read" || tool === "Write" || tool === "Edit") {
    const filePath = argsObj.file_path || argsObj.filePath || argsObj.path
    if (typeof filePath === "string") {
      return extractDirectoryPattern(filePath)
    }
  }

  // Handle Glob
  if (tool === "Glob" || tool === "glob") {
    const pattern = argsObj.pattern
    if (typeof pattern === "string") {
      // Keep glob patterns as-is but truncate
      return pattern.length > 50 ? pattern.slice(0, 47) + "..." : pattern
    }
  }

  // Handle Grep
  if (tool === "Grep" || tool === "grep") {
    const pattern = argsObj.pattern
    if (typeof pattern === "string") {
      // Categorize grep patterns
      if (/TODO|FIXME|XXX|HACK/i.test(pattern)) return "TODO/FIXME patterns"
      if (/import|require|from/i.test(pattern)) return "import statements"
      if (/function|class|interface|type/i.test(pattern)) return "definitions"
      return pattern.length > 30 ? pattern.slice(0, 27) + "..." : pattern
    }
  }

  // Handle Bash
  if (tool === "Bash" || tool === "bash") {
    const command = argsObj.command
    if (typeof command === "string") {
      // Extract command name and first arg
      const parts = command.trim().split(/\s+/)
      const cmd = parts[0]
      if (["npm", "yarn", "pnpm", "bun"].includes(cmd)) {
        return `${cmd} ${parts[1] || ""}`.trim()
      }
      if (["git", "docker", "kubectl"].includes(cmd)) {
        return `${cmd} ${parts[1] || ""}`.trim()
      }
      return cmd
    }
  }

  return null
}

/**
 * Extract directory pattern from a file path
 * e.g., "src/hooks/preemptive-compaction/index.ts" -> "src/hooks/*"
 */
function extractDirectoryPattern(filePath: string): string {
  const parts = filePath.split("/")
  if (parts.length <= 2) {
    return parts[0] + "/*"
  }
  // Keep first two directory levels
  return parts.slice(0, 2).join("/") + "/*"
}

/**
 * Create a signature for a tool pattern
 */
function createPatternSignature(tool: string, argsPattern: string): string {
  return `${tool}::${argsPattern}`
}

/**
 * Record a tool usage for pattern tracking (in-memory accumulation)
 */
export function recordToolUsage(
  tool: string,
  args: unknown,
  sessionID: string,
  stats: PatternStats
): void {
  const argsPattern = normalizeArgsToPattern(tool, args)
  if (!argsPattern) return

  const signature = createPatternSignature(tool, argsPattern)

  if (!stats.patterns[signature]) {
    stats.patterns[signature] = {
      tool,
      argsPattern,
      count: 0,
      lastUsed: 0,
      sessionIds: [],
    }
  }

  const entry = stats.patterns[signature]
  entry.count++
  entry.lastUsed = Date.now()

  if (!entry.sessionIds.includes(sessionID)) {
    entry.sessionIds.push(sessionID)
    // Keep only last 10 session IDs
    if (entry.sessionIds.length > 10) {
      entry.sessionIds = entry.sessionIds.slice(-10)
    }
  }
}

/**
 * Aggregate pattern stats into frequentPatterns in user memory
 */
export function aggregateFrequentPatterns(
  config: FrequentPatternConfig = DEFAULT_PATTERN_CONFIG
): string[] {
  const stats = loadPatternStats()
  const now = Date.now()
  const decayMs = config.decay_days * 24 * 60 * 60 * 1000

  // Filter and score patterns
  const qualified = Object.values(stats.patterns)
    .filter(p => p.count >= config.min_occurrences)
    .filter(p => p.sessionIds.length >= config.min_sessions)
    .map(p => {
      // Apply decay penalty for old patterns
      const age = now - p.lastUsed
      const decayFactor = age > decayMs ? 0.5 : 1.0
      const score = p.count * decayFactor * p.sessionIds.length
      return { ...p, score }
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, config.max_patterns)

  // Format as human-readable strings
  const patterns = qualified.map(p =>
    `${p.tool}: ${p.argsPattern} (${p.count} uses)`
  )

  // Update user memory
  const memory = loadUserMemory()
  memory.frequentPatterns = patterns
  saveUserMemory(memory)

  // Update aggregation timestamp
  stats.lastAggregated = now
  savePatternStats(stats)

  log("[user-memory] aggregated frequent patterns", { count: patterns.length })

  return patterns
}
