/**
 * Clarity Detector Module
 *
 * Analyzes user requests to determine if the Prometheus interview phase
 * should be skipped, abbreviated, or run in full.
 *
 * Clarity levels:
 * - CLEAR: Specific target, concrete action, bounded scope → Skip interview
 * - AMBIGUOUS: Some details, needs 1-2 clarifications → Brief interview
 * - UNCLEAR: Vague goals, open-ended → Full interview
 */

/**
 * Clarity level classification
 */
export type ClarityLevel = "clear" | "ambiguous" | "unclear"

/**
 * Result of clarity analysis
 */
export interface ClarityAnalysis {
  /** Detected clarity level */
  level: ClarityLevel
  /** Whether interview can be skipped */
  skipInterview: boolean
  /** Elements that are missing or unclear */
  missingElements: string[]
  /** Human-readable reason for the decision */
  reason: string
  /** Suggested questions if brief interview is needed */
  suggestedQuestions?: string[]
}

/**
 * Checklist for evaluating request clarity
 */
interface ClarityChecklist {
  /** Mentions specific file, function, component, or location */
  hasSpecificTarget: boolean
  /** Contains clear action verb (add, remove, change, fix, etc.) */
  hasConcreteAction: boolean
  /** Has implicit or explicit scope boundary */
  hasScopeBoundary: boolean
  /** No ambiguous pronouns without clear referent */
  hasNoAmbiguousPronouns: boolean
  /** Outcome is verifiable/observable */
  hasVerifiableOutcome: boolean
}

/**
 * Patterns that indicate ambiguity (interview likely needed)
 */
const AMBIGUITY_PATTERNS: RegExp[] = [
  // Vague improvement requests
  /improve\s+(?:the\s+)?(?:code|system|app|application|performance)/i,
  /make\s+(?:it\s+)?(?:better|faster|cleaner|nicer|more\s+\w+)/i,
  /optimize\s+(?:the\s+)?(?:code|system|app)/i,

  // Open-ended help requests
  /help\s+(?:me\s+)?(?:with|figure\s+out|understand)/i,
  /(?:what\s+do\s+you\s+think|should\s+I|would\s+you)/i,
  /(?:how\s+should\s+I|what's\s+the\s+best\s+way)/i,

  // Uncertain phrasing
  /(?:something\s+like|kind\s+of|sort\s+of|maybe|perhaps)/i,
  /(?:I\s+think|I\s+guess|not\s+sure|might\s+need)/i,

  // Incomplete specifications
  /(?:etc|and\s+so\s+on|and\s+more|and\s+stuff)/i,
  /(?:general|overall|in\s+general|roughly)/i,

  // Subjective quality terms
  /(?:clean|elegant|proper|good|nice|beautiful)\s+(?:code|solution|implementation)/i,
]

/**
 * Patterns that indicate clarity (interview can be skipped)
 */
const CLARITY_PATTERNS: RegExp[] = [
  // File paths mentioned
  /(?:in\s+)?(?:file\s+)?[`"']?[\w\/\-\.]+\.\w{2,4}[`"']?/i,

  // Specific symbols mentioned
  /(?:function|class|method|component|interface|type)\s+[`"']?\w+[`"']?/i,

  // Line numbers mentioned
  /(?:line|lines)\s+\d+(?:\s*[-–]\s*\d+)?/i,

  // Concrete actions with targets
  /(?:add|remove|delete|change|update|fix|rename|move)\s+(?:the\s+)?\w+\s+(?:in|to|from|at)/i,

  // Specific transformations
  /(?:from|to)\s+[`"']?[\w\-\.]+[`"']?/i,

  // Error messages quoted
  /(?:error|exception|warning)[:"]?\s*[`"'].+[`"']/i,
]

/**
 * Analyze request clarity to determine if interview is needed
 */
export function analyzeClarity(request: string): ClarityAnalysis {
  const missingElements: string[] = []

  // Check patterns
  const clarityMatches = CLARITY_PATTERNS.filter((p) => p.test(request))
  const ambiguityMatches = AMBIGUITY_PATTERNS.filter((p) => p.test(request))

  // Build checklist
  const checklist = buildClarityChecklist(request, clarityMatches)

  // Track missing elements
  if (!checklist.hasSpecificTarget) {
    missingElements.push("specific target (file, function, component)")
  }
  if (!checklist.hasConcreteAction) {
    missingElements.push("concrete action (what exactly to do)")
  }
  if (!checklist.hasScopeBoundary) {
    missingElements.push("scope boundary (what's in/out of scope)")
  }
  if (!checklist.hasNoAmbiguousPronouns) {
    missingElements.push("clear references (ambiguous 'it'/'this'/'that')")
  }
  if (!checklist.hasVerifiableOutcome) {
    missingElements.push("verifiable outcome (how to know it's done)")
  }

  // Determine level
  return classifyClarity({
    checklist,
    clarityMatches: clarityMatches.length,
    ambiguityMatches: ambiguityMatches.length,
    missingElements,
    request,
  })
}

function buildClarityChecklist(request: string, clarityMatches: RegExp[]): ClarityChecklist {
  return {
    // Specific target: file path, function name, component name
    hasSpecificTarget:
      /(?:in|at|file|function|class|component|method)\s+[`"']?[\w\/\-\.]+/i.test(request) ||
      clarityMatches.length > 0,

    // Concrete action: clear verb + object
    hasConcreteAction:
      /(?:add|remove|delete|change|update|fix|create|rename|move|refactor|implement|extract|inline)\s+/i.test(
        request
      ),

    // Scope boundary: implicit or explicit limits
    hasScopeBoundary:
      /(?:only|just|specifically|single|this|the)\s+/i.test(request) ||
      request.split(/\s+/).length < 25 ||
      clarityMatches.length >= 2,

    // No ambiguous pronouns without referent
    hasNoAmbiguousPronouns:
      !/(?:^|\s)(?:it|this|that)(?:\s+(?:is|should|needs|doesn't|isn't))/.test(request) ||
      clarityMatches.length > 0,

    // Verifiable outcome
    hasVerifiableOutcome:
      /(?:should|will|must|to)\s+(?:be|have|show|display|return|pass|work|compile|run)/i.test(request) ||
      /(?:error|test|build|lint)/i.test(request) ||
      clarityMatches.length > 0,
  }
}

interface ClassificationInput {
  checklist: ClarityChecklist
  clarityMatches: number
  ambiguityMatches: number
  missingElements: string[]
  request: string
}

function classifyClarity(input: ClassificationInput): ClarityAnalysis {
  const { checklist, clarityMatches, ambiguityMatches, missingElements, request } = input

  // Count how many checklist items are satisfied
  const checklistScore = Object.values(checklist).filter(Boolean).length

  // CLEAR: High checklist score, no ambiguity signals
  if (checklistScore >= 4 && ambiguityMatches === 0) {
    return {
      level: "clear",
      skipInterview: true,
      missingElements: [],
      reason: "Request has specific target, concrete action, and clear scope",
    }
  }

  // CLEAR: Multiple clarity signals override minor issues
  if (clarityMatches >= 3 && ambiguityMatches <= 1) {
    return {
      level: "clear",
      skipInterview: true,
      missingElements: [],
      reason: "Multiple specific references detected, sufficient clarity",
    }
  }

  // UNCLEAR: Strong ambiguity signals
  if (ambiguityMatches >= 2 || checklistScore <= 2) {
    const suggestedQuestions = generateSuggestedQuestions(missingElements, request)
    return {
      level: "unclear",
      skipInterview: false,
      missingElements,
      reason: `Request needs clarification: ${missingElements.slice(0, 2).join(", ")}`,
      suggestedQuestions,
    }
  }

  // AMBIGUOUS: Some issues but not severe
  if (ambiguityMatches === 1 || (checklistScore === 3 && missingElements.length > 0)) {
    const suggestedQuestions = generateSuggestedQuestions(missingElements.slice(0, 2), request)
    return {
      level: "ambiguous",
      skipInterview: false,
      missingElements: missingElements.slice(0, 2),
      reason: "Brief clarification recommended",
      suggestedQuestions,
    }
  }

  // Default to clear for reasonable requests
  return {
    level: "clear",
    skipInterview: true,
    missingElements: [],
    reason: "Request is sufficiently clear to proceed",
  }
}

/**
 * Generate suggested clarifying questions based on missing elements
 */
function generateSuggestedQuestions(missingElements: string[], request: string): string[] {
  const questions: string[] = []

  for (const element of missingElements) {
    if (element.includes("specific target")) {
      questions.push("Which specific file(s) or component(s) should be modified?")
    } else if (element.includes("concrete action")) {
      questions.push("What exactly should be changed or implemented?")
    } else if (element.includes("scope boundary")) {
      questions.push("What should be in scope vs out of scope for this task?")
    } else if (element.includes("clear references")) {
      questions.push("Could you clarify what 'it' or 'this' refers to?")
    } else if (element.includes("verifiable outcome")) {
      questions.push("How will we know when this is complete? What should the end result look like?")
    }
  }

  return questions.slice(0, 3) // Max 3 questions
}

/**
 * Get interview recommendation based on clarity analysis
 */
export function getInterviewRecommendation(analysis: ClarityAnalysis): {
  action: "skip" | "brief" | "full"
  reason: string
} {
  if (analysis.skipInterview) {
    return {
      action: "skip",
      reason: "Request is clear enough to proceed directly to planning",
    }
  }

  if (analysis.level === "ambiguous") {
    return {
      action: "brief",
      reason: `Brief clarification needed: ${analysis.missingElements.join(", ")}`,
    }
  }

  return {
    action: "full",
    reason: "Full interview recommended to gather requirements",
  }
}
