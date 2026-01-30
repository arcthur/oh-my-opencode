/**
 * Handoff Prompt Builder
 *
 * Constructs the initial prompt for a new session from handoff context.
 */

import type { HandoffPackage, HandoffPayload, Decision, Artifact, AntiPattern } from "./types"

// ============================================================================
// Types
// ============================================================================

export interface PromptBuilderOptions {
  /** Whether to include preamble explaining the handoff */
  includePreamble?: boolean

  /** Whether to include file listing */
  includeFiles?: boolean

  /** Whether to include remaining tasks section */
  includeRemainingTasks?: boolean

  /** Maximum line length for wrapping */
  maxLineLength?: number
}

// ============================================================================
// Formatters
// ============================================================================

function formatDecision(decision: Decision, index: number): string {
  const lines: string[] = []

  lines.push(`${index + 1}. **${decision.what}**`)
  lines.push(`   - Chose: ${decision.chosen}`)
  lines.push(`   - Reason: ${decision.why}`)

  if (decision.rejected && decision.rejected.length > 0) {
    const rejected = decision.rejected
      .slice(0, 2)
      .map((r) => `${r.approach} (${r.reason})`)
      .join("; ")
    lines.push(`   - Rejected: ${rejected}`)
  }

  if (decision.relatedFiles && decision.relatedFiles.length > 0) {
    lines.push(`   - Files: ${decision.relatedFiles.join(", ")}`)
  }

  return lines.join("\n")
}

function formatAntiPattern(ap: AntiPattern, index: number): string {
  let line = `${index + 1}. **${ap.approach}**: ${ap.reason}`
  if (ap.errorSignature) {
    line += `\n   - Error: \`${ap.errorSignature.slice(0, 100)}\``
  }
  if (ap.context) {
    line += `\n   - Context: ${ap.context}`
  }
  return line
}

function formatArtifact(artifact: Artifact): string {
  const changeIcon = artifact.changeType === "created" ? "+" : artifact.changeType === "deleted" ? "-" : "~"
  return `- [${changeIcon}] \`${artifact.path}\`: ${artifact.summary}`
}

// ============================================================================
// Main Builder
// ============================================================================

/**
 * Build a handoff prompt for starting a new session
 */
export function buildHandoffPrompt(
  goal: string,
  payload: HandoffPayload,
  sourcePackage: HandoffPackage,
  options: PromptBuilderOptions = {}
): string {
  const {
    includePreamble = true,
    includeFiles = true,
    includeRemainingTasks = true,
  } = options

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

  // Decisions (Context)
  if (payload.decisions.length > 0) {
    const formattedDecisions = payload.decisions
      .map((d, i) => formatDecision(d, i))
      .join("\n\n")

    sections.push(`## Key Decisions

These decisions were made in the previous session and should guide your approach:

${formattedDecisions}`)
  }

  // Domain Knowledge
  if (payload.domainContext.length > 0) {
    const formattedContext = payload.domainContext
      .map((c) => `- ${c}`)
      .join("\n")

    sections.push(`## Domain Knowledge

Important insights about this codebase:

${formattedContext}`)
  }

  // Anti-patterns (CRITICAL - always include all)
  if (payload.antiPatterns.length > 0) {
    const formattedAntiPatterns = payload.antiPatterns
      .map((ap, i) => formatAntiPattern(ap, i))
      .join("\n\n")

    sections.push(`## Approaches to AVOID

These approaches were tried and FAILED. Do NOT repeat them:

${formattedAntiPatterns}`)
  }

  // Key Files
  if (includeFiles && payload.artifacts.length > 0) {
    const formattedArtifacts = payload.artifacts
      .map(formatArtifact)
      .join("\n")

    sections.push(`## Relevant Files

Files from the previous session:

${formattedArtifacts}`)
  }

  // Remaining Tasks
  if (includeRemainingTasks && payload.remainingTasks && payload.remainingTasks.length > 0) {
    const formattedTasks = payload.remainingTasks
      .map((t) => `- [ ] ${t}`)
      .join("\n")

    sections.push(`## Remaining Tasks

Tasks carried over from the previous session:

${formattedTasks}`)
  }

  // Instructions
  sections.push(`---

**Instructions**: Use the context above to accomplish the stated goal.
If any previous decision conflicts with the goal, prioritize the goal.
Avoid the documented anti-patterns unless you have a specific reason to revisit them.`)

  return sections.join("\n\n")
}

/**
 * Build a compact summary for display (not for prompt injection)
 */
export function buildHandoffSummary(
  goal: string,
  payload: HandoffPayload,
  sourcePackage: HandoffPackage
): string {
  const lines: string[] = []

  lines.push(`**Goal**: ${goal}`)
  lines.push(`**Session**: ${sourcePackage.id}`)
  lines.push(`**Handoff ID**: ${sourcePackage.id}`)
  lines.push("")
  lines.push("Context transferred:")
  lines.push(`- ${payload.decisions.length} decisions`)
  lines.push(`- ${payload.antiPatterns.length} anti-patterns`)
  lines.push(`- ${payload.artifacts.length} key files`)

  if (payload.domainContext.length > 0) {
    lines.push(`- ${payload.domainContext.length} domain insights`)
  }

  if (payload.remainingTasks && payload.remainingTasks.length > 0) {
    lines.push(`- ${payload.remainingTasks.length} remaining tasks`)
  }

  return lines.join("\n")
}
