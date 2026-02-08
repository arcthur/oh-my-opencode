/**
 * Unified Handoff Renderer
 *
 * Single source of truth for formatting handoff content.
 * Used by prompt-builder, injector, and reference-resolver.
 */

import type {
  HandoffPackage,
  HandoffPayload,
  Decision,
  Artifact,
  AntiPattern,
  RecoveryPattern,
} from "./types"
import { checkHandoffStaleness, formatStalenessWarning } from "./staleness"

// ============================================================================
// Render Options
// ============================================================================

export interface RenderOptions {
  /**
   * Rendering mode affects headers and structure:
   * - 'prompt': Active handoff for new session (includes preamble, goal section)
   * - 'injection': Auto-injected context (includes staleness warning)
   * - 'reference': @session:id resolution (compact format)
   */
  mode: "prompt" | "injection" | "reference"

  /** Project path for staleness detection (injection mode) */
  projectPath?: string

  /** Include preamble explaining the handoff (prompt mode) */
  includePreamble?: boolean

  /** Include file listing */
  includeFiles?: boolean

  /** Include remaining tasks section */
  includeRemainingTasks?: boolean

  /** Maximum items per section (prevents token overflow) */
  maxItems?: {
    decisions?: number
    artifacts?: number
    antiPatterns?: number
    recoveryPatterns?: number
    domainContext?: number
  }
}

const DEFAULT_MAX_ITEMS = {
  decisions: 5,
  artifacts: 10,
  antiPatterns: 5,
  recoveryPatterns: 3,
  domainContext: 5,
}

const DEFAULT_MAX_ITEMS_PROMPT = {
  decisions: 10,
  artifacts: 15,
  antiPatterns: 10,
  recoveryPatterns: 10,
  domainContext: 10,
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Get human-readable age string
 */
export function getAgeString(timestamp: number): string {
  const ageMs = Date.now() - timestamp
  const ageHours = ageMs / (1000 * 60 * 60)

  if (ageHours < 1) return "just now"
  if (ageHours < 24) return `${Math.round(ageHours)} hours ago`
  const ageDays = Math.round(ageHours / 24)
  if (ageDays === 1) return "yesterday"
  return `${ageDays} days ago`
}

/**
 * Summarize tool arguments for display
 */
export function summarizeArgs(args: Record<string, unknown>): string {
  const filePath = args.file_path ?? args.filePath ?? args.path
  if (typeof filePath === "string") {
    return ` ${filePath}`
  }

  const command = args.command
  if (typeof command === "string") {
    const maxLen = 40
    return ` "${command.slice(0, maxLen)}${command.length > maxLen ? "..." : ""}"`
  }

  return ""
}

/**
 * Truncate error message for display
 */
export function truncateError(error: string, maxLen = 100): string {
  const firstLine = error.split("\n")[0]
  if (firstLine.length > maxLen) {
    return firstLine.slice(0, maxLen - 3) + "..."
  }
  return firstLine
}

// ============================================================================
// Item Formatters
// ============================================================================

export interface FormatDecisionOptions {
  /** 1-based index for numbered lists, undefined for bullet format */
  index?: number
  /** Include rejected alternatives */
  includeRejected?: boolean
  /** Include related files */
  includeRelatedFiles?: boolean
}

/**
 * Format a decision for display
 */
export function formatDecision(
  decision: Decision,
  options: FormatDecisionOptions = {}
): string {
  const { index, includeRejected = true, includeRelatedFiles = true } = options
  const lines: string[] = []
  const prefix = index !== undefined ? `${index}.` : "-"

  lines.push(`${prefix} **${decision.what}**: ${decision.chosen}`)
  lines.push(`   - Why: ${decision.why}`)

  if (includeRejected && decision.rejected && decision.rejected.length > 0) {
    const rejectedList = decision.rejected
      .slice(0, 2)
      .map((r) => `${r.approach} (${r.reason})`)
      .join("; ")
    lines.push(`   - Rejected: ${rejectedList}`)
  }

  if (includeRelatedFiles && decision.relatedFiles && decision.relatedFiles.length > 0) {
    lines.push(`   - Files: ${decision.relatedFiles.join(", ")}`)
  }

  return lines.join("\n")
}

/**
 * Format an artifact for display
 */
export function formatArtifact(artifact: Artifact): string {
  const changeIcon =
    artifact.changeType === "created" ? "+" : artifact.changeType === "deleted" ? "-" : "~"
  return `- [${changeIcon}] \`${artifact.path}\`: ${artifact.summary}`
}

/**
 * Format an anti-pattern for display
 */
export function formatAntiPattern(ap: AntiPattern, options?: { index?: number }): string {
  const prefix = options?.index !== undefined ? `${options.index}.` : "-"
  let line = `${prefix} **${ap.approach}**: ${ap.reason}`
  if (ap.errorSignature) {
    line += `\n   - Error: \`${ap.errorSignature.slice(0, 100)}\``
  }
  if (ap.context) {
    line += `\n   - Context: ${ap.context}`
  }
  return line
}

/**
 * Format a recovery pattern for display
 */
export function formatRecoveryPattern(pattern: RecoveryPattern, index: number): string {
  const lines: string[] = []
  const categoryLabel = pattern.contextSignature.errorCategory.replace(/-/g, " ")

  lines.push(`### RP-${index}: ${categoryLabel}`)
  lines.push("")
  lines.push("**Failures:**")

  const failuresToShow = pattern.failureSequence.slice(0, 3)
  for (let i = 0; i < failuresToShow.length; i++) {
    const fail = failuresToShow[i]
    lines.push(
      `${i + 1}. \`${fail.tool}${summarizeArgs(fail.args)}\` → Error: ${truncateError(fail.error)}`
    )
  }

  lines.push("")
  lines.push("**Resolution:**")
  lines.push(
    `\`${pattern.resolution.tool}${summarizeArgs(pattern.resolution.args)}\` → ${pattern.resolution.result || "Success"}`
  )

  if (pattern.insight) {
    lines.push("")
    lines.push(`**Lesson:** ${pattern.insight.summary}`)
    if (pattern.insight.precheck) {
      lines.push(`**Precheck:** ${pattern.insight.precheck}`)
    }
  }

  return lines.join("\n")
}

// ============================================================================
// Section Renderers
// ============================================================================

function renderDecisionsSection(decisions: Decision[], max: number): string {
  if (decisions.length === 0) return ""

  const formatted = decisions
    .slice(0, max)
    .map((d, i) => formatDecision(d, { index: i + 1 }))
    .join("\n\n")

  return `**Key Decisions:**\n${formatted}`
}

function renderArtifactsSection(artifacts: Artifact[], max: number): string {
  if (artifacts.length === 0) return ""

  const formatted = artifacts.slice(0, max).map(formatArtifact).join("\n")

  return `**Relevant Files:**\n${formatted}`
}

function renderAntiPatternsSection(antiPatterns: AntiPattern[], max: number): string {
  if (antiPatterns.length === 0) return ""

  const formatted = antiPatterns
    .slice(0, max)
    .map((ap, i) => formatAntiPattern(ap, { index: i + 1 }))
    .join("\n\n")

  return `**Avoid These Approaches:**\n${formatted}`
}

function renderRecoveryPatternsSection(patterns: RecoveryPattern[], max: number): string {
  if (!patterns || patterns.length === 0) return ""

  // Filter by confidence if insight exists
  const filtered = patterns
    .filter((rp) => !rp.insight || rp.insight.confidence >= 0.5)
    .slice(0, max)

  if (filtered.length === 0) return ""

  const formatted = filtered.map((rp, i) => formatRecoveryPattern(rp, i + 1)).join("\n\n")

  return `**Recovery Patterns (How failures were resolved):**\n\n${formatted}`
}

function renderDomainContextSection(domainContext: string[], max: number): string {
  if (domainContext.length === 0) return ""

  const formatted = domainContext
    .slice(0, max)
    .map((c) => `- ${c}`)
    .join("\n")

  return `**Domain Knowledge:**\n${formatted}`
}

function renderRemainingTasksSection(tasks?: string[]): string {
  if (!tasks || tasks.length === 0) return ""

  const formatted = tasks.map((t) => `- ${t}`).join("\n")

  return `**Remaining Tasks:**\n${formatted}`
}

// ============================================================================
// Main Renderers
// ============================================================================

/**
 * Render a handoff package for injection into a new session
 */
export function renderHandoffForInjection(
  pkg: HandoffPackage,
  projectPath: string,
  options?: Partial<RenderOptions>
): string {
  const maxItems = { ...DEFAULT_MAX_ITEMS, ...options?.maxItems }
  const lines: string[] = []

  // Header with age
  const age = getAgeString(pkg.createdAt)
  lines.push(`### Session: ${pkg.id} (${age})`)
  lines.push(`**Goal**: ${pkg.metadata.originalGoal}`)
  lines.push("")

  // Staleness warning
  const staleness = checkHandoffStaleness(pkg, projectPath)
  const warning = formatStalenessWarning(staleness)
  if (warning) {
    lines.push(warning)
  }

  // Sections
  const sections = [
    renderDecisionsSection(pkg.payload.decisions, maxItems.decisions!),
    renderRecoveryPatternsSection(pkg.payload.recoveryPatterns ?? [], maxItems.recoveryPatterns!),
    renderAntiPatternsSection(pkg.payload.antiPatterns, maxItems.antiPatterns!),
    renderDomainContextSection(pkg.payload.domainContext, maxItems.domainContext!),
    renderRemainingTasksSection(pkg.payload.remainingTasks),
  ].filter(Boolean)

  if (options?.includeFiles !== false) {
    const artifactsSection = renderArtifactsSection(pkg.payload.artifacts, maxItems.artifacts!)
    if (artifactsSection) {
      sections.push(artifactsSection)
    }
  }

  lines.push(sections.join("\n\n"))

  return lines.join("\n")
}

/**
 * Render a handoff package for @session:id reference
 */
export function renderHandoffForReference(
  pkg: HandoffPackage,
  projectPath: string,
  options?: Partial<RenderOptions>
): string {
  // Reference mode uses same format as injection but without recovery patterns by default
  const maxItems = {
    ...DEFAULT_MAX_ITEMS,
    recoveryPatterns: 2,
    ...options?.maxItems,
  }

  return renderHandoffForInjection(pkg, projectPath, { ...options, maxItems })
}

/**
 * Render a handoff as an active handoff prompt
 */
export function renderHandoffPrompt(
  goal: string,
  payload: HandoffPayload,
  sourcePackage: HandoffPackage,
  options?: Partial<RenderOptions>
): string {
  const { includePreamble = true, includeFiles = true, includeRemainingTasks = true } = options ?? {}
  const maxItems = { ...DEFAULT_MAX_ITEMS_PROMPT, ...options?.maxItems }
  const sections: string[] = []

  // Preamble
  if (includePreamble) {
    sections.push(`## Session Handoff

This session continues from a previous session (${sourcePackage.id}).
The following context has been transferred to help you accomplish the goal.

---`)
  }

  // Goal
  sections.push(`## Goal

${goal}`)

  // Decisions
  if (payload.decisions.length > 0) {
    const formatted = payload.decisions
      .slice(0, maxItems.decisions)
      .map((d, i) => formatDecision(d, { index: i + 1 }))
      .join("\n\n")

    sections.push(`## Key Decisions

These decisions were made in the previous session and should guide your approach:

${formatted}`)
  }

  // Recovery patterns
  if (payload.recoveryPatterns && payload.recoveryPatterns.length > 0) {
    const formatted = payload.recoveryPatterns
      .slice(0, maxItems.recoveryPatterns)
      .map((rp, i) => formatRecoveryPattern(rp, i + 1))
      .join("\n\n")

    sections.push(`## Recovery Patterns

When you encounter similar errors, use these proven solutions:

${formatted}`)
  }

  // Anti-patterns
  if (payload.antiPatterns.length > 0) {
    const formatted = payload.antiPatterns
      .slice(0, maxItems.antiPatterns)
      .map((ap, i) => formatAntiPattern(ap, { index: i + 1 }))
      .join("\n\n")

    sections.push(`## Approaches to AVOID

These approaches were tried and FAILED. Do NOT repeat them:

${formatted}`)
  }

  // Domain knowledge
  if (payload.domainContext.length > 0) {
    const formatted = payload.domainContext
      .slice(0, maxItems.domainContext)
      .map((c) => `- ${c}`)
      .join("\n")

    sections.push(`## Domain Knowledge

Important insights about this codebase:

${formatted}`)
  }

  // Artifacts
  if (includeFiles && payload.artifacts.length > 0) {
    const formatted = payload.artifacts.slice(0, maxItems.artifacts).map(formatArtifact).join("\n")

    sections.push(`## Relevant Files

Files from the previous session:

${formatted}`)
  }

  // Remaining tasks
  if (includeRemainingTasks && payload.remainingTasks && payload.remainingTasks.length > 0) {
    const formatted = payload.remainingTasks.map((t) => `- ${t}`).join("\n")

    sections.push(`## Remaining Tasks

Tasks carried over from the previous session:

${formatted}`)
  }

  // Instructions
  sections.push(`---

**Instructions**: Use the context above to accomplish the stated goal.
If any previous decision conflicts with the goal, prioritize the goal.
Avoid the documented anti-patterns unless you have a specific reason to revisit them.`)

  return sections.join("\n\n")
}

/**
 * Render a specific section of a handoff
 */
export function renderSection(pkg: HandoffPackage, section: string): string {
  const maxItems = DEFAULT_MAX_ITEMS

  switch (section) {
    case "decisions":
      if (pkg.payload.decisions.length === 0) return "No decisions recorded."
      return pkg.payload.decisions
        .slice(0, maxItems.decisions)
        .map((d, i) => formatDecision(d, { index: i + 1 }))
        .join("\n\n")

    case "artifacts":
      if (pkg.payload.artifacts.length === 0) return "No artifacts recorded."
      return pkg.payload.artifacts.slice(0, maxItems.artifacts).map(formatArtifact).join("\n")

    case "antiPatterns":
      if (pkg.payload.antiPatterns.length === 0) return "No anti-patterns recorded."
      return pkg.payload.antiPatterns
        .slice(0, maxItems.antiPatterns)
        .map((ap) => formatAntiPattern(ap))
        .join("\n")

    case "context":
      if (pkg.payload.domainContext.length === 0) return "No domain context recorded."
      return pkg.payload.domainContext
        .slice(0, maxItems.domainContext)
        .map((c) => `- ${c}`)
        .join("\n")

    case "recoveryPatterns":
      if (!pkg.payload.recoveryPatterns || pkg.payload.recoveryPatterns.length === 0) {
        return "No recovery patterns recorded."
      }
      return pkg.payload.recoveryPatterns
        .slice(0, maxItems.recoveryPatterns)
        .map((rp, i) => formatRecoveryPattern(rp, i + 1))
        .join("\n\n")

    default:
      return `Unknown section: ${section}`
  }
}

/**
 * Build a compact summary for display (not for prompt injection)
 */
export function renderHandoffSummary(
  goal: string,
  payload: HandoffPayload,
  sourcePackage: HandoffPackage
): string {
  const lines: string[] = []

  lines.push(`**Goal**: ${goal}`)
  lines.push(`**Handoff ID**: ${sourcePackage.id}`)
  lines.push("")
  lines.push("Context transferred:")
  lines.push(`- ${payload.decisions.length} decisions`)
  lines.push(`- ${payload.antiPatterns.length} anti-patterns`)
  lines.push(`- ${payload.artifacts.length} artifacts`)

  if (payload.recoveryPatterns && payload.recoveryPatterns.length > 0) {
    lines.push(`- ${payload.recoveryPatterns.length} recovery patterns`)
  }

  if (payload.domainContext.length > 0) {
    lines.push(`- ${payload.domainContext.length} domain insights`)
  }

  if (payload.remainingTasks && payload.remainingTasks.length > 0) {
    lines.push(`- ${payload.remainingTasks.length} remaining tasks`)
  }

  return lines.join("\n")
}

/**
 * Format multiple handoffs for injection
 */
export function renderMultipleHandoffsForInjection(
  packages: HandoffPackage[],
  projectPath: string,
  options?: Partial<RenderOptions>
): string {
  if (packages.length === 0) {
    return ""
  }

  const sections = packages.map((pkg) => renderHandoffForInjection(pkg, projectPath, options))

  return `## Previous Session Context

The following context was extracted from recent sessions on this project.

${sections.join("\n---\n\n")}`
}
