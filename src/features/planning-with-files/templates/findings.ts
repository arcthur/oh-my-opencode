/**
 * Findings Template
 *
 * This is your KNOWLEDGE BASE. Persist information across context windows.
 * Apply the 2-Action Rule: Update after every 2 view/search operations.
 */

export interface FindingsTemplateOptions {
  planName: string
  requirements?: string[]
}

export function generateFindingsTemplate(options: FindingsTemplateOptions): string {
  const { planName, requirements } = options

  const requirementsSection = requirements && requirements.length > 0
    ? requirements.map((r, i) => `${i + 1}. ${r}`).join("\n")
    : "1. (Pending discovery)"

  return `# Findings & Decisions: ${planName}

> **2-Action Rule**: Update this document after every 2 view/search/browse operations.

---

## Requirements

${requirementsSection}

---

## Research Findings

| # | Source | Finding | Relevance |
|---|--------|---------|-----------|
| - | (none yet) | - | - |

---

## Technical Decisions

| # | Decision | Rationale | Alternatives Considered |
|---|----------|-----------|------------------------|
| - | (none yet) | - | - |

---

## Issues Encountered

| # | Issue | Root Cause | Resolution |
|---|-------|------------|------------|
| - | (none yet) | - | - |

---

## Resources

| Name | URL | Notes |
|------|-----|-------|
| - | - | - |

---

## Visual/Browser Findings

> **Important**: Multimodal content doesn't persist in context. Capture as text immediately.

| Source | Description | Timestamp |
|--------|-------------|-----------|
| - | - | - |

---

## Notes

- Created: ${new Date().toISOString().split("T")[0]}
- Last Updated: ${new Date().toISOString().split("T")[0]}
- Action Count Since Last Update: 0

---

> **Reminder**: The 2-Action Rule ensures you never lose important discoveries.
`
}

/** Update action count in findings */
export function updateFindingsActionCount(content: string, newCount: number): string {
  return content.replace(
    /Action Count Since Last Update: \d+/,
    `Action Count Since Last Update: ${newCount}`
  )
}

/** Reset action count after update */
export function resetFindingsActionCount(content: string): string {
  const updatedContent = content.replace(
    /Last Updated: \d{4}-\d{2}-\d{2}/,
    `Last Updated: ${new Date().toISOString().split("T")[0]}`
  )
  return updateFindingsActionCount(updatedContent, 0)
}

/** Extract current action count */
export function getFindingsActionCount(content: string): number {
  const match = content.match(/Action Count Since Last Update: (\d+)/)
  return match ? parseInt(match[1], 10) : 0
}
