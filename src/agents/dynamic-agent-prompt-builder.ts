import type { AgentPromptMetadata } from "./types"
import { truncateDescription } from "../shared/truncate-description"

export interface AvailableAgent {
  name: string
  description: string
  metadata: AgentPromptMetadata
}

export interface AvailableTool {
  name: string
  category: "lsp" | "ast" | "search" | "session" | "command" | "other"
}

export interface AvailableSkill {
  name: string
  description: string
  location: "user" | "project" | "plugin"
}

export interface AvailableCategory {
  name: string
  description: string
  model?: string
}

export interface BuildToolSelectionOptions {
  maxAgentRows?: number
  compact?: boolean
}

export interface BuildDelegationTableOptions {
  maxRows?: number
  includeFallbackHint?: boolean
}

export interface BuildCategorySkillsGuideOptions {
  maxCategories?: number
  maxSkills?: number
  compact?: boolean
}

function sanitizeMarkdownTableCell(value: string): string {
  return value
    .replace(/\r?\n/g, " ")
    .replace(/\|/g, "\\|")
    .replace(/\s+/g, " ")
    .trim()
}

function truncateFirstSentence(value: string): string {
  return truncateDescription(value)
}

export function categorizeTools(toolNames: string[]): AvailableTool[] {
  return toolNames.map((name) => {
    let category: AvailableTool["category"] = "other"
    if (name.startsWith("lsp_")) {
      category = "lsp"
    } else if (name.startsWith("ast_grep")) {
      category = "ast"
    } else if (name === "grep" || name === "glob") {
      category = "search"
    } else if (name.startsWith("session_")) {
      category = "session"
    } else if (name === "slashcommand") {
      category = "command"
    }
    return { name, category }
  })
}

function formatToolsForPrompt(tools: AvailableTool[]): string {
  const lspTools = tools.filter((t) => t.category === "lsp")
  const astTools = tools.filter((t) => t.category === "ast")
  const searchTools = tools.filter((t) => t.category === "search")

  const parts: string[] = []

  if (searchTools.length > 0) {
    parts.push(...searchTools.map((t) => `\`${t.name}\``))
  }

  if (lspTools.length > 0) {
    parts.push("`lsp_*`")
  }

  if (astTools.length > 0) {
    parts.push("`ast_grep`")
  }

  return parts.join(", ")
}

export function buildKeyTriggersSection(agents: AvailableAgent[], _skills: AvailableSkill[] = []): string {
  const keyTriggers = agents
    .filter((a) => a.metadata.keyTrigger)
    .map((a) => `- ${sanitizeMarkdownTableCell(a.metadata.keyTrigger ?? "")}`)

  if (keyTriggers.length === 0) return ""

  return `### Key Triggers (check BEFORE classification):

${keyTriggers.join("\n")}
- **"Look into" + "create PR"** → Not just research. Full implementation cycle expected.`
}

export function buildToolSelectionTable(
  agents: AvailableAgent[],
  tools: AvailableTool[] = [],
  _skills: AvailableSkill[] = [],
  options: BuildToolSelectionOptions = {}
): string {
  const { maxAgentRows, compact = false } = options
  const rows: string[] = [
    compact ? "### Tool & Agent Selection (Compact):" : "### Tool & Agent Selection:",
    "",
  ]

  rows.push("| Resource | Cost | When to Use |")
  rows.push("|----------|------|-------------|")

  if (tools.length > 0) {
    const toolsDisplay = sanitizeMarkdownTableCell(formatToolsForPrompt(tools))
    rows.push(`| ${toolsDisplay} | FREE | Not Complex, Scope Clear, No Implicit Assumptions |`)
  }

  const costOrder = { FREE: 0, CHEAP: 1, EXPENSIVE: 2 }
  const sortedAgents = [...agents]
    .filter((a) => a.metadata.category !== "utility")
    .sort((a, b) => costOrder[a.metadata.cost] - costOrder[b.metadata.cost])

  const visibleAgents =
    typeof maxAgentRows === "number" && maxAgentRows >= 0
      ? sortedAgents.slice(0, maxAgentRows)
      : sortedAgents

  for (const agent of visibleAgents) {
    const safeAgentName = sanitizeMarkdownTableCell(agent.name)
    const shortDesc = sanitizeMarkdownTableCell(truncateFirstSentence(agent.description))
    rows.push(`| \`${safeAgentName}\` agent | ${agent.metadata.cost} | ${shortDesc} |`)
  }

  if (visibleAgents.length < sortedAgents.length) {
    const remaining = sortedAgents.length - visibleAgents.length
    rows.push(`| ... | ... | ${remaining} more agents omitted (use \`delegate_task\` + \`skill\` to inspect full capabilities) |`)
  }

  rows.push("")
  rows.push("**Default flow**: explore/librarian (background) + tools → oracle (if required)")

  return rows.join("\n")
}

export function buildExploreSection(agents: AvailableAgent[]): string {
  const exploreAgent = agents.find((a) => a.name === "explore")
  if (!exploreAgent) return ""

  const useWhen = exploreAgent.metadata.useWhen || []
  const avoidWhen = exploreAgent.metadata.avoidWhen || []

  return `### Explore Agent = Contextual Grep

Use it as a **peer tool**, not a fallback. Fire liberally.

| Use Direct Tools | Use Explore Agent |
|------------------|-------------------|
${avoidWhen.map((w) => `| ${sanitizeMarkdownTableCell(w)} |  |`).join("\n")}
${useWhen.map((w) => `|  | ${sanitizeMarkdownTableCell(w)} |`).join("\n")}`
}

export function buildLibrarianSection(agents: AvailableAgent[]): string {
  const librarianAgent = agents.find((a) => a.name === "librarian")
  if (!librarianAgent) return ""

  const useWhen = librarianAgent.metadata.useWhen || []

  return `### Librarian Agent = Reference Grep

Search **external references** (docs, OSS, web). Fire proactively when unfamiliar libraries are involved.

| Contextual Grep (Internal) | Reference Grep (External) |
|----------------------------|---------------------------|
| Search OUR codebase | Search EXTERNAL resources |
| Find patterns in THIS repo | Find examples in OTHER repos |
| How does our code work? | How does this library work? |
| Project-specific logic | Official API documentation |
| | Library best practices & quirks |
| | OSS implementation examples |

**Trigger phrases** (fire librarian immediately):
${useWhen.map((w) => `- "${sanitizeMarkdownTableCell(w)}"`).join("\n")}`
}

export function buildDelegationTable(
  agents: AvailableAgent[],
  options: BuildDelegationTableOptions = {}
): string {
  const { maxRows, includeFallbackHint = false } = options
  const rows: string[] = [
    "### Delegation Table:",
    "",
    "| Domain | Delegate To | Trigger |",
    "|--------|-------------|---------|",
  ]

  const tableRows: string[] = []
  for (const agent of agents) {
    for (const trigger of agent.metadata.triggers) {
      const safeDomain = sanitizeMarkdownTableCell(trigger.domain)
      const safeAgentName = sanitizeMarkdownTableCell(agent.name)
      const safeTrigger = sanitizeMarkdownTableCell(trigger.trigger)
      tableRows.push(`| ${safeDomain} | \`${safeAgentName}\` | ${safeTrigger} |`)
    }
  }

  const visibleRows =
    typeof maxRows === "number" && maxRows >= 0
      ? tableRows.slice(0, maxRows)
      : tableRows

  rows.push(...visibleRows)

  if (visibleRows.length < tableRows.length) {
    const remaining = tableRows.length - visibleRows.length
    rows.push(`| ... | ... | ${remaining} more delegation triggers omitted |`)
  }

  if (includeFallbackHint) {
    rows.push("")
    rows.push("Use `delegate_task` with explicit `category` and `load_skills` when the compact table is insufficient.")
  }

  return rows.join("\n")
}

export function buildCategorySkillsDelegationGuide(
  categories: AvailableCategory[],
  skills: AvailableSkill[],
  options: BuildCategorySkillsGuideOptions = {}
): string {
  const { maxCategories, maxSkills, compact = false } = options
  if (categories.length === 0 && skills.length === 0) return ""

  const visibleCategories =
    typeof maxCategories === "number" && maxCategories >= 0
      ? categories.slice(0, maxCategories)
      : categories
  const visibleSkills =
    typeof maxSkills === "number" && maxSkills >= 0
      ? skills.slice(0, maxSkills)
      : skills

  const categoryRows = visibleCategories.map((c) => {
    const safeName = sanitizeMarkdownTableCell(c.name)
    const desc = sanitizeMarkdownTableCell(c.description || c.name)
    return `| \`${safeName}\` | ${desc} |`
  })

  const skillRows = visibleSkills.map((s) => {
    const safeName = sanitizeMarkdownTableCell(s.name)
    const desc = sanitizeMarkdownTableCell(truncateFirstSentence(s.description))
    return `| \`${safeName}\` | ${desc} |`
  })

  const categoriesTruncated = visibleCategories.length < categories.length
  const skillsTruncated = visibleSkills.length < skills.length
  const truncationNote = categoriesTruncated || skillsTruncated
    ? "\n\n**Note**: List is truncated. Use `skill` tool and category docs for full details."
    : ""

  if (compact) {
    return `### Category + Skills Delegation System (Compact)

| Category | Domain / Best For |
|----------|-------------------|
${categoryRows.join("\n")}

| Skill | Expertise Domain |
|-------|------------------|
${skillRows.join("\n")}

For category delegation, include relevant skills via \`load_skills=[...]\` and justify omissions.${truncationNote}`
  }

  return `### Category + Skills Delegation System

**delegate_task(...) combines categories and skills for optimal task execution.**

#### Available Categories (Domain-Optimized Models)

Each category is configured with a model optimized for that domain. Read the description to understand when to use it.

| Category | Domain / Best For |
|----------|-------------------|
${categoryRows.join("\n")}

#### Available Skills (Domain Expertise Injection)

Skills inject specialized instructions into the subagent. Read the description to understand when each skill applies.

| Skill | Expertise Domain |
|-------|------------------|
${skillRows.join("\n")}

---

### MANDATORY: Category + Skill Selection Protocol

**STEP 1: Select Category**
- Read each category's description
- Match task requirements to category domain
- Select the category whose domain BEST fits the task

**STEP 2: Evaluate ALL Skills**
For EVERY skill listed above, ask yourself:
> "Does this skill's expertise domain overlap with my task?"

- If YES → INCLUDE in \`load_skills=[...]\`
- If NO → You MUST justify why (see below)

**STEP 3: Justify Omissions**

If you choose NOT to include a skill that MIGHT be relevant, you MUST provide:

\`\`\`
SKILL EVALUATION for "[skill-name]":
- Skill domain: [what the skill description says]
- Task domain: [what your task is about]
- Decision: OMIT
- Reason: [specific explanation of why domains don't overlap]
\`\`\`

**WHY JUSTIFICATION IS MANDATORY:**
- Forces you to actually READ skill descriptions
- Prevents lazy omission of potentially useful skills
- Subagents are STATELESS - they only know what you tell them
- Missing a relevant skill = suboptimal output

---

### Delegation Pattern

\`\`\`typescript
delegate_task(
  description="...",
  category="[selected-category]",
  load_skills=["skill-1", "skill-2"],  // Include ALL relevant skills
  run_in_background=false,
  prompt="..."
)
\`\`\`

**ANTI-PATTERN (will produce poor results):**
\`\`\`typescript
delegate_task(description="...", category="...", load_skills=[], run_in_background=false, prompt="...")  // Empty load_skills without justification
\`\`\`${truncationNote}`
}

export function buildOracleSection(agents: AvailableAgent[]): string {
  const oracleAgent = agents.find((a) => a.name === "oracle")
  if (!oracleAgent) return ""

  const useWhen = oracleAgent.metadata.useWhen || []
  const avoidWhen = oracleAgent.metadata.avoidWhen || []

  return `<Oracle_Usage>
## Oracle — Read-Only High-IQ Consultant

Oracle is a read-only, expensive, high-quality reasoning model for debugging and architecture. Consultation only.

### WHEN to Consult:

| Trigger | Action |
|---------|--------|
${useWhen.map((w) => `| ${sanitizeMarkdownTableCell(w)} | Oracle FIRST, then implement |`).join("\n")}

### WHEN NOT to Consult:

${avoidWhen.map((w) => `- ${sanitizeMarkdownTableCell(w)}`).join("\n")}

### Usage Pattern:
Briefly announce "Consulting Oracle for [reason]" before invocation.

**Exception**: This is the ONLY case where you announce before acting. For all other work, start immediately without status updates.
</Oracle_Usage>`
}

export function buildHardBlocksSection(): string {
  const blocks = [
    "| Type error suppression (`as any`, `@ts-ignore`) | Never |",
    "| Commit without explicit request | Never |",
    "| Speculate about unread code | Never |",
    "| Leave code in broken state after failures | Never |",
  ]

  return `## Hard Blocks (NEVER violate)

| Constraint | No Exceptions |
|------------|---------------|
${blocks.join("\n")}`
}

export function buildAntiPatternsSection(): string {
  const patterns = [
    "| **Type Safety** | `as any`, `@ts-ignore`, `@ts-expect-error` |",
    "| **Error Handling** | Empty catch blocks `catch(e) {}` |",
    "| **Testing** | Deleting failing tests to \"pass\" |",
    "| **Search** | Firing agents for single-line typos or obvious syntax errors |",
    "| **Debugging** | Shotgun debugging, random changes |",
  ]

  return `## Anti-Patterns (BLOCKING violations)

| Category | Forbidden |
|----------|-----------|
${patterns.join("\n")}`
}

export function buildUltraworkSection(
  agents: AvailableAgent[],
  categories: AvailableCategory[],
  skills: AvailableSkill[]
): string {
  const lines: string[] = []

  if (categories.length > 0) {
    lines.push("**Categories** (for implementation tasks):")
    for (const cat of categories) {
      const safeName = sanitizeMarkdownTableCell(cat.name)
      const shortDesc = sanitizeMarkdownTableCell(cat.description || cat.name)
      lines.push(`- \`${safeName}\`: ${shortDesc}`)
    }
    lines.push("")
  }

  if (skills.length > 0) {
    lines.push("**Skills** (combine with categories - EVALUATE ALL for relevance):")
    for (const skill of skills) {
      const safeName = sanitizeMarkdownTableCell(skill.name)
      const shortDesc = sanitizeMarkdownTableCell(truncateFirstSentence(skill.description))
      lines.push(`- \`${safeName}\`: ${shortDesc}`)
    }
    lines.push("")
  }

  if (agents.length > 0) {
    const ultraworkAgentPriority = ["explore", "librarian", "plan", "oracle"]
    const sortedAgents = [...agents].sort((a, b) => {
      const aIdx = ultraworkAgentPriority.indexOf(a.name)
      const bIdx = ultraworkAgentPriority.indexOf(b.name)
      if (aIdx === -1 && bIdx === -1) return 0
      if (aIdx === -1) return 1
      if (bIdx === -1) return -1
      return aIdx - bIdx
    })

    lines.push("**Agents** (for specialized consultation/exploration):")
    for (const agent of sortedAgents) {
      const safeName = sanitizeMarkdownTableCell(agent.name)
      const shortDesc = sanitizeMarkdownTableCell(truncateFirstSentence(agent.description))
      const suffix = agent.name === "explore" || agent.name === "librarian" ? " (multiple)" : ""
      lines.push(`- \`${safeName}${suffix}\`: ${shortDesc}`)
    }
  }

  return lines.join("\n")
}
