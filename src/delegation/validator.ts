import type { BuiltinAgentName } from "../agents/types"
import type {
  DelegationDecision,
  ValidationResult,
  ValidationWarning,
  AgentValidationRules,
  TaskType,
  Complexity,
} from "./types"

/**
 * Validation rules matrix for each agent.
 * Defines what task types, complexity levels, and domains are appropriate for each agent.
 */
const VALIDATION_RULES: Partial<Record<BuiltinAgentName, AgentValidationRules>> = {
  explore: {
    validTaskTypes: ["exploration", "debugging"],
    validComplexity: ["trivial", "simple", "moderate", "complex"],
    validDomains: ["frontend", "backend", "general"],
  },
  librarian: {
    validTaskTypes: ["exploration", "research"],
    validComplexity: ["trivial", "simple", "moderate", "complex"],
    validDomains: ["external", "general"],
  },
  oracle: {
    validTaskTypes: ["debugging", "architecture"],
    validComplexity: ["moderate", "complex"],
    validDomains: ["backend", "general", "frontend"],
    minComplexity: "moderate",
  },
  "frontend-ui-ux-engineer": {
    validTaskTypes: ["implementation", "refactoring"],
    validComplexity: ["trivial", "simple", "moderate", "complex"],
    validDomains: ["frontend"],
  },
  "document-writer": {
    validTaskTypes: ["documentation"],
    validComplexity: ["trivial", "simple", "moderate", "complex"],
    validDomains: ["frontend", "backend", "general"],
  },
  "Metis (Plan Consultant)": {
    validTaskTypes: ["architecture", "research"],
    validComplexity: ["moderate", "complex"],
    validDomains: ["frontend", "backend", "general"],
    minComplexity: "moderate",
  },
  "Momus (Plan Reviewer)": {
    validTaskTypes: ["architecture"],
    validComplexity: ["moderate", "complex"],
    validDomains: ["frontend", "backend", "general"],
    minComplexity: "moderate",
  },
}

/**
 * Complexity ordering for comparison
 */
const COMPLEXITY_ORDER: Record<Complexity, number> = {
  trivial: 0,
  simple: 1,
  moderate: 2,
  complex: 3,
}

/**
 * Suggest a better agent for a given task type
 */
function suggestBetterAgent(taskType: TaskType): string | undefined {
  const suggestions: Partial<Record<TaskType, string>> = {
    exploration: "explore or librarian",
    implementation: "frontend-ui-ux-engineer (for frontend) or direct implementation",
    debugging: "explore first, then oracle if 2+ attempts failed",
    refactoring: "frontend-ui-ux-engineer (for frontend) or direct implementation",
    documentation: "document-writer",
    architecture: "oracle or Metis",
    research: "librarian",
  }
  return suggestions[taskType]
}

/**
 * Validate a delegation decision against the rules matrix.
 * Returns warnings if the decision seems suboptimal, but doesn't block execution.
 */
export function validateDelegationDecision(
  decision: DelegationDecision
): ValidationResult {
  const warnings: ValidationWarning[] = []
  const rules = VALIDATION_RULES[decision.agent]

  // If we don't have rules for this agent, skip validation
  if (!rules) {
    return { valid: true, warnings: [] }
  }

  // Check task type match
  if (!rules.validTaskTypes.includes(decision.taskType)) {
    const suggestion = suggestBetterAgent(decision.taskType)
    warnings.push({
      type: "task_type_mismatch",
      message: `${decision.agent} is not typically used for "${decision.taskType}" tasks`,
      suggestion: suggestion ? `Consider using ${suggestion}` : undefined,
    })
  }

  // Check minimum complexity (overkill detection)
  if (rules.minComplexity) {
    const minOrder = COMPLEXITY_ORDER[rules.minComplexity]
    const actualOrder = COMPLEXITY_ORDER[decision.complexity]
    if (actualOrder < minOrder) {
      warnings.push({
        type: "overkill",
        message: `${decision.agent} is expensive and typically used for ${rules.minComplexity}+ tasks, but this is "${decision.complexity}"`,
        suggestion: "Consider using direct tools or cheaper agents first",
      })
    }
  }

  // Check frontend implementation/refactoring - should use frontend-ui-ux-engineer
  // This check is independent of validDomains because even if an agent "supports" frontend domain,
  // implementation/refactoring in frontend should still prefer the specialized agent
  if (
    decision.domain === "frontend" &&
    decision.agent !== "frontend-ui-ux-engineer" &&
    (decision.taskType === "implementation" || decision.taskType === "refactoring")
  ) {
    warnings.push({
      type: "domain_mismatch",
      message: "Frontend implementation/refactoring should typically use frontend-ui-ux-engineer",
      suggestion: "Delegate visual changes to frontend-ui-ux-engineer",
    })
  }

  return {
    valid: warnings.length === 0,
    warnings,
  }
}

/**
 * Extract delegation decision JSON from assistant message content.
 * Looks for <delegation-decision>...</delegation-decision> tags.
 */
export function extractDelegationDecision(
  messageContent: string
): DelegationDecision | null {
  // Match <delegation-decision> ... </delegation-decision>
  const match = messageContent.match(
    /<delegation-decision>\s*([\s\S]*?)\s*<\/delegation-decision>/i
  )

  if (!match) {
    return null
  }

  const jsonContent = match[1].trim()

  try {
    const parsed = JSON.parse(jsonContent)

    // Validate required fields
    if (
      typeof parsed.agent !== "string" ||
      typeof parsed.taskType !== "string" ||
      typeof parsed.complexity !== "string" ||
      typeof parsed.domain !== "string" ||
      typeof parsed.reason !== "string" ||
      !Array.isArray(parsed.signals)
    ) {
      return null
    }

    return parsed as DelegationDecision
  } catch {
    // JSON parse error
    return null
  }
}

/**
 * Format validation warnings as a human-readable string
 */
export function formatValidationWarnings(warnings: ValidationWarning[]): string {
  if (warnings.length === 0) {
    return ""
  }

  return warnings
    .map((w) => {
      const suggestion = w.suggestion ? ` (${w.suggestion})` : ""
      return `- ${w.type}: ${w.message}${suggestion}`
    })
    .join("\n")
}
