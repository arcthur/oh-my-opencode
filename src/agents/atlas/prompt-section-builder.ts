import type { CategoryConfig } from "../../config/schema"
import type { AvailableAgent, AvailableSkill } from "../dynamic-agent-prompt-builder"
import { DEFAULT_CATEGORIES, CATEGORY_DESCRIPTIONS } from "../../tools/delegate-task/constants"
import { truncateDescription } from "../../shared/truncate-description"

function formatCustomSkillsBlock(rows: string[], customSkills: AvailableSkill[], emphasisMarker: string): string {
  if (customSkills.length === 0) return ""
  return `${emphasisMarker}Custom Skills${emphasisMarker}

| Skill | When to Use | Source |
|-------|-------------|--------|
${rows.join("\n")}`
}

export const getCategoryDescription = (name: string, userCategories?: Record<string, CategoryConfig>) =>
  userCategories?.[name]?.description ?? CATEGORY_DESCRIPTIONS[name] ?? "General tasks"

export function buildAgentSelectionSection(agents: AvailableAgent[]): string {
  if (agents.length === 0) {
    return `##### Option B: Explicit Agent

No specialist agents available.`
  }

  const rows = agents.map((agent) => {
    const shortDesc = truncateDescription(agent.description)
    return `| \`${agent.name}\` | ${shortDesc} |`
  })

  return `##### Option B: Explicit Agent

| Agent | Best For |
|-------|----------|
${rows.join("\n")}`
}

export function buildCategorySection(userCategories?: Record<string, CategoryConfig>): string {
  const allCategories = { ...DEFAULT_CATEGORIES, ...userCategories }
  const rows = Object.entries(allCategories).map(([name, config]) => {
    const temp = config.temperature ?? 0.5
    return `| \`${name}\` | ${temp} | ${getCategoryDescription(name, userCategories)} |`
  })

  return `##### Option A: Category Routing

Categories route execution to optimized workers:

| Category | Temperature | Best For |
|----------|-------------|----------|
${rows.join("\n")}

\`\`\`typescript
delegate_task(
  description="...",
  category="[category-name]",
  load_skills=[...],
  run_in_background=false,
  prompt="..."
)
\`\`\``
}

export function buildSkillsSection(skills: AvailableSkill[]): string {
  if (skills.length === 0) return ""

  const builtinSkills = skills.filter((skill) => skill.location === "plugin")
  const customSkills = skills.filter((skill) => skill.location !== "plugin")

  const builtinRows = builtinSkills.map((skill) => {
    const shortDesc = truncateDescription(skill.description)
    return `| \`${skill.name}\` | ${shortDesc} |`
  })

  const customRows = customSkills.map((skill) => {
    const shortDesc = truncateDescription(skill.description)
    const source = skill.location === "project" ? "project" : "user"
    return `| \`${skill.name}\` | ${shortDesc} | ${source} |`
  })

  const customSkillBlock = formatCustomSkillsBlock(customRows, customSkills, "**")

  let skillsTable: string
  if (customSkills.length > 0 && builtinSkills.length > 0) {
    skillsTable = `**Built-in Skills**

| Skill | When to Use |
|-------|-------------|
${builtinRows.join("\n")}

${customSkillBlock}`
  } else if (customSkills.length > 0) {
    skillsTable = customSkillBlock
  } else {
    skillsTable = `| Skill | When to Use |
|-------|-------------|
${builtinRows.join("\n")}`
  }

  return `
#### Skill Selection

${skillsTable}

Use relevant skills in \`load_skills\` for each delegation.`
}

export function buildDecisionMatrix(agents: AvailableAgent[], userCategories?: Record<string, CategoryConfig>): string {
  const allCategories = { ...DEFAULT_CATEGORIES, ...userCategories }

  const categoryRows = Object.entries(allCategories).map(([name]) =>
    `| ${getCategoryDescription(name, userCategories)} | \`category="${name}"\` |`
  )

  const agentRows = agents.map((agent) => {
    const shortDesc = truncateDescription(agent.description)
    return `| ${shortDesc} | \`subagent_type="${agent.name}"\` |`
  })

  return `##### Decision Matrix

| Task Domain | Use |
|-------------|-----|
${categoryRows.join("\n")}
${agentRows.join("\n")}

Provide either \`category\` or \`subagent_type\`, never both.`
}
