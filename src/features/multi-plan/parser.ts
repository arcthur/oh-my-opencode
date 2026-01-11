/**
 * Parser utilities for multi-plan comparison reports
 */

/**
 * A model that was rejected in a conflict resolution
 */
export interface RejectedModel {
  /** Model name that was rejected */
  modelName: string
  /** ID of the conflict (extracted from CONFLICT section header) */
  conflictId: string
  /** The criticism given for why this model was wrong */
  criticism: string
}

/**
 * Parse comparison report to find rejected models in conflicts.
 *
 * A model is "rejected" if:
 * 1. It appears in a "Why {model} is WRONG" section
 * 2. It is NOT the winner in the VERDICT
 *
 * @param reportContent - The full content of the comparison report
 * @param modelNames - List of model names to check for rejections
 * @returns Array of rejected models with their conflict IDs and criticisms
 */
export function parseRejectedModels(
  reportContent: string,
  modelNames: string[]
): RejectedModel[] {
  const rejections: RejectedModel[] = []

  // Find all CONFLICT sections
  const conflictSections = reportContent.split(/### CONFLICT:/).slice(1)

  for (const section of conflictSections) {
    const conflictIdMatch = section.match(/^([^\n]+)/)
    const conflictId = conflictIdMatch ? conflictIdMatch[1].trim() : "general"

    const verdict = parseVerdict(section, modelNames)

    // For BOTH_VALID, no models are rejected
    if (verdict.type === "both_valid") {
      continue
    }

    const winnerLower = verdict.type === "accept" ? verdict.winnerLower : undefined

    // For each model, check if it was criticized and NOT the winner
    for (const modelName of modelNames) {
      const modelNameLower = modelName.toLowerCase()

      // Skip if this model won this conflict
      if (winnerLower && modelNameLower === winnerLower) continue

      // Match "Why {model} is WRONG:" pattern (case insensitive)
      // Handles both `**Why strategist is WRONG**:` and `**Why {strategist} is WRONG**:`
      // The lookahead handles common terminators, and `$` handles end of section/content
      const wrongPattern = new RegExp(
        `\\*\\*Why\\s+(?:\\{)?${escapeRegExp(modelName)}(?:\\})?\\s+is\\s+WRONG\\*\\*:([\\s\\S]*?)(?=\\*\\*Why|\\*\\*VERDICT|---|\\n\\n|$)`,
        "i"
      )
      const wrongMatch = wrongPattern.exec(section)

      if (wrongMatch) {
        // Check if this model-conflict pair is already added
        const alreadyAdded = rejections.some(
          (r) => r.modelName === modelName && r.conflictId === conflictId
        )
        if (!alreadyAdded) {
          rejections.push({
            modelName,
            conflictId,
            criticism: wrongMatch[1].trim(),
          })
        }
      }
    }
  }

  return rejections
}

function parseVerdict(
  conflictSection: string,
  modelNames: string[]
): { type?: string; winnerLower?: string } {
  // Matches patterns like:
  // - **VERDICT**: ACCEPT strategist
  // - **VERDICT**: `ACCEPT strategist`
  // - **VERDICT**: ACCEPT Strategy Expert (spaces)
  // - **VERDICT**: ACCEPT gpt/5.2 (non-word chars)
  // - **VERDICT**: MERGE
  // - **VERDICT**: BOTH_VALID (All three)
  // - **VERDICT**: REJECT ALL
  const verdictLineMatch = conflictSection.match(
    /\*\*VERDICT\*\*:\s*`?([^\n`]+)`?/i
  )
  if (!verdictLineMatch) return {}

  const verdictText = verdictLineMatch[1].trim()
  if (!verdictText) return {}

  const type = verdictText.split(/\s+/)[0].toLowerCase()

  if (type !== "accept") {
    return { type }
  }

  const winnerRaw = verdictText.replace(/^accept\s+/i, "").trim()
  const winnerLowerCandidate = winnerRaw.toLowerCase()
  const winnerLower = modelNames.find(
    (m) => m.toLowerCase() === winnerLowerCandidate
  )?.toLowerCase()

  return { type, winnerLower }
}

/**
 * Escape special regex characters in a string
 */
function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}
