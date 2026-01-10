/**
 * Task Plan Template
 *
 * This is your WORKING MEMORY document. Keep it updated as you work.
 * Re-read this before making any significant changes to stay on track.
 */

export interface TaskPlanTemplateOptions {
  goal: string
  planName: string
  phases?: { name: string; description: string }[]
  keyQuestions?: string[]
}

export function generateTaskPlanTemplate(options: TaskPlanTemplateOptions): string {
  const { goal, planName, phases, keyQuestions } = options

  const defaultPhases = [
    { name: "Requirements & Discovery", description: "Understand the problem space and gather requirements" },
    { name: "Planning & Design", description: "Make technical decisions and plan the approach" },
    { name: "Implementation", description: "Execute the plan and write code" },
    { name: "Testing & Verification", description: "Verify the implementation meets requirements" },
    { name: "Delivery & Documentation", description: "Finalize and document the work" },
  ]

  const phasesToUse = phases && phases.length > 0 ? phases : defaultPhases

  const phaseTable = phasesToUse
    .map((p, i) => `| ${i + 1} | ${p.name} | pending | ${p.description} |`)
    .join("\n")

  const questionsSection = keyQuestions && keyQuestions.length > 0
    ? keyQuestions.map((q, i) => `${i + 1}. ${q}`).join("\n")
    : "1. [ ] What are the core requirements?\n2. [ ] What are the potential risks?\n3. [ ] What dependencies exist?"

  return `# Task Plan: ${planName}

> **Goal**: ${goal}

---

## Phases

| # | Phase | Status | Description |
|---|-------|--------|-------------|
${phaseTable}

**Status Legend**: \`pending\` → \`in_progress\` → \`complete\` | \`blocked\`

---

## Decisions Made

| # | Decision | Rationale | Phase |
|---|----------|-----------|-------|
| - | (none yet) | - | - |

---

## Errors Encountered (3-Strike Protocol)

| # | Error | Attempt | Action Taken | Resolution |
|---|-------|---------|--------------|------------|
| - | (none yet) | - | - | - |

**Protocol**:
- Strike 1: Diagnose the root cause
- Strike 2: Try alternative approaches
- Strike 3: Rethink assumptions
- Escalate: Ask for help or block the phase

---

## Key Questions

${questionsSection}

---

## Notes

- Created: ${new Date().toISOString().split("T")[0]}
- Last Updated: ${new Date().toISOString().split("T")[0]}

---

> **Reminder**: Re-read this document before any Write/Edit/Bash operations to prevent goal drift.
`
}

/** Parse a task plan markdown back to structured data */
export function parseTaskPlan(content: string): {
  goal: string
  phases: { id: number; name: string; status: string; description: string }[]
  decisions: { id: number; decision: string; rationale: string; phase: string }[]
  errors: { id: number; error: string; attempt: string; action: string; resolution: string }[]
} {
  const goalMatch = content.match(/\*\*Goal\*\*:\s*(.+)/)
  const goal = goalMatch ? goalMatch[1].trim() : ""

  // Parse phases table
  const phasesRegex = /\|\s*(\d+)\s*\|\s*([^|]+)\s*\|\s*([^|]+)\s*\|\s*([^|]+)\s*\|/g
  const phases: { id: number; name: string; status: string; description: string }[] = []
  let match
  while ((match = phasesRegex.exec(content)) !== null) {
    const id = parseInt(match[1], 10)
    if (!isNaN(id)) {
      phases.push({
        id,
        name: match[2].trim(),
        status: match[3].trim(),
        description: match[4].trim(),
      })
    }
  }

  // Parse decisions table
  const decisionsSection = content.match(/## Decisions Made[\s\S]*?(?=##|$)/)?.[0] || ""
  const decisions: { id: number; decision: string; rationale: string; phase: string }[] = []
  const decisionRegex = /\|\s*(\d+)\s*\|\s*([^|]+)\s*\|\s*([^|]+)\s*\|\s*([^|]+)\s*\|/g
  while ((match = decisionRegex.exec(decisionsSection)) !== null) {
    const id = parseInt(match[1], 10)
    if (!isNaN(id)) {
      decisions.push({
        id,
        decision: match[2].trim(),
        rationale: match[3].trim(),
        phase: match[4].trim(),
      })
    }
  }

  // Parse errors table
  const errorsSection = content.match(/## Errors Encountered[\s\S]*?(?=##|$)/)?.[0] || ""
  const errors: { id: number; error: string; attempt: string; action: string; resolution: string }[] = []
  const errorRegex = /\|\s*(\d+)\s*\|\s*([^|]+)\s*\|\s*([^|]+)\s*\|\s*([^|]+)\s*\|\s*([^|]+)\s*\|/g
  while ((match = errorRegex.exec(errorsSection)) !== null) {
    const id = parseInt(match[1], 10)
    if (!isNaN(id)) {
      errors.push({
        id,
        error: match[2].trim(),
        attempt: match[3].trim(),
        action: match[4].trim(),
        resolution: match[5].trim(),
      })
    }
  }

  return { goal, phases, decisions, errors }
}
