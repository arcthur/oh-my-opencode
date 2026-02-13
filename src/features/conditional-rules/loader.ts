/**
 * Rule Loader
 *
 * Loads conditional rules from:
 * 1. AGENTS.md files discovered in project tree
 * 2. Configuration modules (.opencode/oh-my-opencode/*.json)
 */

import { readFileSync } from "node:fs"
import { join, basename } from "node:path"
import { discoverAgentsMdFiles, getAgentsMdDirectory } from "./agents-md-parser"
import type {
  ConditionalRule,
  ConditionalRulesConfig,
  ConfigRule,
  ParsedAgentsMd,
  RuleCondition,
} from "./types"
import { DEFAULT_CONDITIONAL_RULES_CONFIG } from "./types"
import { log } from "../../shared/logger"

// ============================================================================
// Rule Loading
// ============================================================================

/**
 * Load all conditional rules from AGENTS.md files and configuration
 */
export async function loadAllRules(
  projectRoot: string,
  config: ConditionalRulesConfig = DEFAULT_CONDITIONAL_RULES_CONFIG
): Promise<ConditionalRule[]> {
  const rules: ConditionalRule[] = []

  // 1. Load rules from AGENTS.md files
  if (config.agents_md.enabled) {
    const agentsMdRules = await loadAgentsMdRules(projectRoot, config)
    rules.push(...agentsMdRules)
  }

  // 2. Load rules from configuration
  if (config.conditional_rules && config.conditional_rules.length > 0) {
    const configRules = loadConfigRules(projectRoot, config.conditional_rules)
    rules.push(...configRules)
  }

  log("[conditional-rules] loaded rules", {
    total: rules.length,
    fromAgentsMd: rules.filter((r) => r.source.type === "agents-md").length,
    fromConfig: rules.filter((r) => r.source.type === "config").length,
  })

  return rules
}

/**
 * Load rules from AGENTS.md files
 */
async function loadAgentsMdRules(
  projectRoot: string,
  config: ConditionalRulesConfig
): Promise<ConditionalRule[]> {
  const rules: ConditionalRule[] = []

  const agentsMdFiles = await discoverAgentsMdFiles(projectRoot, config.agents_md)

  for (const parsed of agentsMdFiles) {
    const rulesFromFile = convertAgentsMdToRules(parsed, projectRoot)
    rules.push(...rulesFromFile)
  }

  return rules
}

/**
 * Convert parsed AGENTS.md to conditional rules
 */
function convertAgentsMdToRules(parsed: ParsedAgentsMd, projectRoot: string): ConditionalRule[] {
  const rules: ConditionalRule[] = []
  const agentsDir = getAgentsMdDirectory(parsed, projectRoot)
  const displayName = agentsDir === "." ? "root" : basename(agentsDir)

  // Priority: deeper directories have HIGHER priority (100 + depth)
  // More specific rules (from nested directories) should override more general rules (from root)
  // This follows the principle of specificity: src/api/AGENTS.md > src/AGENTS.md > root AGENTS.md
  const basePriority = 100 + parsed.depth

  // Global rules (apply to the directory and all subdirectories)
  if (parsed.globalRules.trim()) {
    const directoryCondition: RuleCondition =
      agentsDir === "."
        ? { type: "glob", pattern: "**/*" } // Root applies to everything
        : { type: "directory", path: agentsDir, recursive: true }

    rules.push({
      id: `agents-md:${hashPath(parsed.sourcePath)}:global`,
      name: `Rules from ${displayName}/AGENTS.md`,
      source: { type: "agents-md", path: parsed.sourcePath, depth: parsed.depth },
      conditions: [directoryCondition],
      content: parsed.globalRules,
      priority: basePriority,
      enabled: true,
    })
  }

  // Conditional blocks
  for (const block of parsed.conditionalBlocks) {
    const conditions: RuleCondition[] = []

    // First condition: must be within the AGENTS.md directory
    if (agentsDir !== ".") {
      conditions.push({ type: "directory", path: agentsDir, recursive: true })
    }

    // Second condition: match the glob pattern from the include directive
    conditions.push({ type: "glob", pattern: block.pattern })

    rules.push({
      id: `agents-md:${hashPath(parsed.sourcePath)}:${block.lineStart}`,
      name: `Rules for ${block.pattern} (${displayName})`,
      source: { type: "agents-md", path: parsed.sourcePath, depth: parsed.depth },
      conditions,
      content: block.content,
      priority: basePriority - 1, // Conditional blocks have slightly lower priority than global
      enabled: true,
    })
  }

  return rules
}

/**
 * Load rules from configuration
 */
function loadConfigRules(projectRoot: string, configRules: ConfigRule[]): ConditionalRule[] {
  const rules: ConditionalRule[] = []

  for (const configRule of configRules) {
    // Resolve content (may be a file reference)
    let content: string
    if (typeof configRule.content === "string") {
      content = configRule.content
    } else if (configRule.content.file) {
      try {
        const filePath = join(projectRoot, configRule.content.file)
        content = readFileSync(filePath, "utf-8")
      } catch (e) {
        log("[conditional-rules] failed to load rule file", {
          id: configRule.id,
          file: configRule.content.file,
          error: String(e),
        })
        continue
      }
    } else {
      continue
    }

    rules.push({
      id: configRule.id,
      name: configRule.name,
      source: { type: "config", section: "conditional_rules" },
      conditions: configRule.conditions,
      content,
      priority: configRule.priority ?? 0,
      enabled: configRule.enabled ?? true,
    })
  }

  return rules
}

// ============================================================================
// Utilities
// ============================================================================

/**
 * Simple hash for path to create stable IDs
 */
function hashPath(path: string): string {
  let hash = 0
  for (let i = 0; i < path.length; i++) {
    const char = path.charCodeAt(i)
    hash = (hash << 5) - hash + char
    hash = hash & hash // Convert to 32bit integer
  }
  return Math.abs(hash).toString(36)
}

/**
 * Extract file mentions from text (for delegate_task prompt analysis)
 */
export function extractFileMentions(text: string): string[] {
  const mentions: string[] = []

  // Match file paths like src/foo/bar.ts, ./relative/path.js, etc.
  const pathPattern = /(?:^|\s|[`"'])([./]?(?:[\w-]+\/)*[\w-]+\.\w+)(?:\s|[`"']|$|:|\))/g
  let match
  while ((match = pathPattern.exec(text)) !== null) {
    const path = match[1]
    // Filter out obvious non-paths
    if (path.includes("/") || path.match(/\.(ts|tsx|js|jsx|md|json|yaml|yml|css|scss|html)$/)) {
      mentions.push(path.replace(/^\.\//, ""))
    }
  }

  // Match explicit mentions like "file: src/foo.ts" or "in src/foo.ts"
  const explicitPattern = /(?:file|in|at|modify|edit|update|create|read):\s*([./]?(?:[\w-]+\/)*[\w-]+\.\w+)/gi
  while ((match = explicitPattern.exec(text)) !== null) {
    mentions.push(match[1].replace(/^\.\//, ""))
  }

  return [...new Set(mentions)]
}

/**
 * Check if rules should be reloaded based on time
 */
export function shouldReloadRules(lastLoadTime: number, maxAge = 30_000): boolean {
  return Date.now() - lastLoadTime > maxAge
}
