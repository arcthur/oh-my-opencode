/**
 * Progress Log Template
 *
 * This is your SESSION HISTORY. Track what you've done for context continuity.
 * Enables effective resumption after interruptions.
 */

export interface ProgressTemplateOptions {
  planName: string
  phases?: { name: string }[]
}

export function generateProgressTemplate(options: ProgressTemplateOptions): string {
  const { planName, phases } = options

  const defaultPhases = [
    { name: "Requirements & Discovery" },
    { name: "Planning & Design" },
    { name: "Implementation" },
    { name: "Testing & Verification" },
    { name: "Delivery & Documentation" },
  ]

  const phasesToUse = phases && phases.length > 0 ? phases : defaultPhases

  const phaseLogs = phasesToUse
    .map((p, i) => `### Phase ${i + 1}: ${p.name}

**Status**: pending
**Started**: -
**Completed**: -

**Actions Taken**:
- (none yet)

**Files Modified**:
- (none yet)

---
`)
    .join("\n")

  return `# Progress Log: ${planName}

> **Session Date**: ${new Date().toISOString().split("T")[0]}

---

## Phase Progress

${phaseLogs}

## Test Results

| Test Case | Input | Expected | Actual | Status |
|-----------|-------|----------|--------|--------|
| - | - | - | - | pending |

---

## Error Log (Detailed)

| Timestamp | Error | Resolution Attempt | Outcome |
|-----------|-------|-------------------|---------|
| - | (none yet) | - | - |

---

## 5-Question Reboot Check

> Use this when resuming after a break or context loss.

1. **Where am I?** (Current phase and file)
   -

2. **Where am I going?** (Next steps)
   -

3. **What is my goal?** (The north star)
   -

4. **What have I learned?** (Key findings)
   -

5. **What have I completed?** (Achievements)
   -

---

## Session Notes

- Session Started: ${new Date().toISOString()}
- Last Activity: ${new Date().toISOString()}

---

## Related Files

- [task_plan.md](./task_plan.md) - Phases, goals, decisions
- [findings.md](./findings.md) - Research and discoveries

---

> **Reminder**: Keep this updated to enable effective context recovery.
`
}

/** Add a phase log entry */
export function addPhaseLogEntry(
  content: string,
  phase: number,
  action: string,
  filesModified?: string[]
): string {
  const phaseRegex = new RegExp(
    `### Phase ${phase}:[^]*?\\*\\*Actions Taken\\*\\*:\\n([^]*?)\\n\\n\\*\\*Files Modified\\*\\*:`,
    "m"
  )

  const match = content.match(phaseRegex)
  if (!match) return content

  const existingActions = match[1]
  const newAction = `- ${action} (${new Date().toISOString().split("T")[1].split(".")[0]})`

  let updatedContent = content.replace(
    match[0],
    match[0].replace(existingActions, `${existingActions}\n${newAction}`)
  )

  if (filesModified && filesModified.length > 0) {
    const filesRegex = new RegExp(
      `### Phase ${phase}:[^]*?\\*\\*Files Modified\\*\\*:\\n([^]*?)\\n\\n---`,
      "m"
    )
    const filesMatch = updatedContent.match(filesRegex)
    if (filesMatch) {
      const existingFiles = filesMatch[1]
      const newFiles = filesModified.map(f => `- ${f}`).join("\n")
      updatedContent = updatedContent.replace(
        filesMatch[0],
        filesMatch[0].replace(existingFiles, `${existingFiles}\n${newFiles}`)
      )
    }
  }

  return updatedContent
}

/** Update phase status */
export function updatePhaseStatus(
  content: string,
  phase: number,
  status: "pending" | "in_progress" | "complete" | "blocked"
): string {
  const statusRegex = new RegExp(
    `(### Phase ${phase}:[^]*?\\*\\*Status\\*\\*: )(pending|in_progress|complete|blocked)`,
    "m"
  )

  let updatedContent = content.replace(statusRegex, `$1${status}`)

  // Update started/completed timestamps
  const now = new Date().toISOString()
  if (status === "in_progress") {
    const startedRegex = new RegExp(
      `(### Phase ${phase}:[^]*?\\*\\*Started\\*\\*: )(-|\\d{4}-\\d{2}-\\d{2}T[^\\n]+)`,
      "m"
    )
    updatedContent = updatedContent.replace(startedRegex, `$1${now}`)
  } else if (status === "complete") {
    const completedRegex = new RegExp(
      `(### Phase ${phase}:[^]*?\\*\\*Completed\\*\\*: )(-|\\d{4}-\\d{2}-\\d{2}T[^\\n]+)`,
      "m"
    )
    updatedContent = updatedContent.replace(completedRegex, `$1${now}`)
  }

  return updatedContent
}

/** Update last activity timestamp */
export function updateLastActivity(content: string): string {
  return content.replace(
    /Last Activity: \d{4}-\d{2}-\d{2}T[\d:.]+Z/,
    `Last Activity: ${new Date().toISOString()}`
  )
}
