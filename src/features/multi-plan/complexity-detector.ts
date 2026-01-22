/**
 * Complexity Detector Module
 *
 * Analyzes user requests to determine task complexity and whether
 * multi-model pipeline should be activated.
 *
 * Complexity levels:
 * - TRIVIAL: Single-line fixes, typos, renames → Single model
 * - SIMPLE: 1-2 files, config changes, clear scope → Single model
 * - COMPLEX: Multi-file, new features, architecture → Multi-model pipeline
 */

/**
 * Complexity level classification
 */
export type ComplexityLevel = "trivial" | "simple" | "complex"

/**
 * Result of complexity analysis
 */
export interface ComplexityAnalysis {
  /** Detected complexity level */
  level: ComplexityLevel
  /** Signals that contributed to the classification */
  signals: string[]
  /** Whether multi-model pipeline should be used */
  useMultiModel: boolean
  /** Human-readable reason for the decision */
  reason: string
}

/**
 * Signals that indicate a trivial task (definitely single model)
 */
const TRIVIAL_SIGNALS: RegExp[] = [
  /fix\s+(?:the\s+)?(?:typo|spelling|grammar)/i,
  /rename\s+(?:the\s+)?(?:variable|function|class|file)\s+\w+/i,
  /update\s+(?:the\s+)?(?:version|dependency)\s+(?:to|in)/i,
  /remove\s+(?:the\s+)?(?:unused|dead)\s+(?:code|import|variable)/i,
  /add\s+(?:a\s+)?(?:comment|TODO|FIXME)/i,
  /delete\s+(?:the\s+)?(?:line|file)\s+/i,
  /change\s+(?:the\s+)?(?:value|string|number)\s+from/i,
]

/**
 * Signals that indicate a simple task (single model sufficient)
 */
const SIMPLE_SIGNALS: RegExp[] = [
  /change\s+(?:the\s+)?(?:color|text|label|title|message)/i,
  /update\s+(?:the\s+)?(?:config|configuration|setting)/i,
  /add\s+(?:a\s+)?(?:log|logging|console)\s+(?:statement|message)/i,
  /fix\s+(?:the\s+)?(?:import|export|require)/i,
  /move\s+(?:the\s+)?(?:file|function|class)\s+(?:to|from)/i,
  /extract\s+(?:the\s+)?(?:function|method|variable)/i,
  /inline\s+(?:the\s+)?(?:function|method|variable)/i,
  /format\s+(?:the\s+)?(?:code|file)/i,
]

/**
 * Signals that indicate a complex task (multi-model recommended)
 */
const COMPLEX_SIGNALS: RegExp[] = [
  // Multi-file indicators
  /(?:across|multiple|several|all)\s+(?:files|modules|components)/i,
  /refactor(?:ing)?\s+(?:the\s+)?(?:entire|whole|all|complete)/i,
  /(?:rewrite|rebuild|redesign)\s+(?:the\s+)?/i,

  // Feature indicators
  /(?:add|implement|create|build)\s+(?:a\s+)?(?:new\s+)?(?:feature|system|module|service|component)/i,
  /(?:design|architect|structure|plan)\s+(?:the\s+)?(?:new|a)/i,

  // Integration indicators
  /(?:integrate|integration)\s+(?:with|into)/i,
  /(?:connect|hook\s+up|wire\s+up)\s+(?:to|with)/i,
  /(?:api|endpoint|backend|frontend)\s+(?:for|to)/i,

  // Domain-specific complexity
  /(?:authentication|authorization|auth|login|session)/i,
  /(?:database|schema|migration|model)\s+(?:change|update|add)/i,
  /(?:testing|test\s+suite|coverage|e2e|integration\s+test)/i,
  /(?:performance|optimization|optimize|cache|caching)/i,
  /(?:security|secure|encrypt|protect)/i,
  /(?:state\s+management|redux|context|store)/i,
  /(?:routing|navigation|route)/i,

  // Scale indicators
  /(?:large|major|significant|substantial)\s+(?:change|refactor|update)/i,
  /(?:comprehensive|complete|full)\s+(?:implementation|solution)/i,
]

/**
 * Analyze request complexity to determine single vs multi-model path
 */
export function analyzeComplexity(request: string): ComplexityAnalysis {
  const signals: string[] = []
  const normalizedRequest = request.toLowerCase()

  // Check for trivial signals
  const trivialMatches = TRIVIAL_SIGNALS.filter((pattern) => pattern.test(request))
  for (const match of trivialMatches) {
    signals.push(`trivial: ${extractPatternDescription(match)}`)
  }

  // Check for simple signals
  const simpleMatches = SIMPLE_SIGNALS.filter((pattern) => pattern.test(request))
  for (const match of simpleMatches) {
    signals.push(`simple: ${extractPatternDescription(match)}`)
  }

  // Check for complex signals
  const complexMatches = COMPLEX_SIGNALS.filter((pattern) => pattern.test(request))
  for (const match of complexMatches) {
    signals.push(`complex: ${extractPatternDescription(match)}`)
  }

  // Word count heuristic
  const wordCount = request.split(/\s+/).filter(Boolean).length
  if (wordCount < 10) {
    signals.push("short request (<10 words)")
  } else if (wordCount > 50) {
    signals.push("long request (>50 words)")
  } else if (wordCount > 30) {
    signals.push("medium-long request (30-50 words)")
  }

  // Check for explicit multi-file mentions
  const filePathCount = (request.match(/[\w\-\/]+\.\w{2,4}/g) || []).length
  if (filePathCount >= 3) {
    signals.push(`multiple file paths mentioned (${filePathCount})`)
  }

  // Determine level based on signal analysis
  return classifyFromSignals({
    trivialMatches: trivialMatches.length,
    simpleMatches: simpleMatches.length,
    complexMatches: complexMatches.length,
    wordCount,
    filePathCount,
    signals,
  })
}

interface SignalCounts {
  trivialMatches: number
  simpleMatches: number
  complexMatches: number
  wordCount: number
  filePathCount: number
  signals: string[]
}

function classifyFromSignals(counts: SignalCounts): ComplexityAnalysis {
  const { trivialMatches, simpleMatches, complexMatches, wordCount, filePathCount, signals } = counts

  // Trivial: Strong trivial signals with no complex signals
  if (trivialMatches > 0 && complexMatches === 0 && wordCount < 20) {
    return {
      level: "trivial",
      signals,
      useMultiModel: false,
      reason: "Request matches trivial task patterns (typo fix, rename, etc.)",
    }
  }

  // Complex: Multiple complex signals or strong complexity indicators
  if (complexMatches >= 2) {
    return {
      level: "complex",
      signals,
      useMultiModel: true,
      reason: `Multiple complexity indicators detected (${complexMatches} signals)`,
    }
  }

  // Complex: Single complex signal with long detailed request
  if (complexMatches === 1 && wordCount > 30) {
    return {
      level: "complex",
      signals,
      useMultiModel: true,
      reason: "Complexity indicator with detailed request",
    }
  }

  // Complex: Multiple file paths mentioned
  if (filePathCount >= 3) {
    return {
      level: "complex",
      signals,
      useMultiModel: true,
      reason: `Multi-file task detected (${filePathCount} files mentioned)`,
    }
  }

  // Simple: Simple signals dominate or no strong signals
  if (simpleMatches > 0 && complexMatches === 0) {
    return {
      level: "simple",
      signals,
      useMultiModel: false,
      reason: "Request matches simple task patterns",
    }
  }

  // Default: Conservative - treat as simple unless proven complex
  if (wordCount < 25 && complexMatches === 0) {
    return {
      level: "simple",
      signals,
      useMultiModel: false,
      reason: "Short request without complexity indicators, defaulting to single model",
    }
  }

  // Moderate complexity - still default to single model
  return {
    level: "simple",
    signals,
    useMultiModel: false,
    reason: "Moderate complexity, single model should suffice",
  }
}

/**
 * Extract a human-readable description from a regex pattern
 */
function extractPatternDescription(pattern: RegExp): string {
  // Get the source and simplify it for display
  const source = pattern.source
  // Remove regex syntax, keep keywords
  return source
    .replace(/\(\?:[^)]+\)/g, "...") // Replace non-capturing groups
    .replace(/\\s\+/g, " ") // Replace whitespace patterns
    .replace(/\\w\+/g, "*") // Replace word patterns
    .replace(/[\\^$.*+?{}[\]|()]/g, "") // Remove special chars
    .slice(0, 30) // Limit length
}

/**
 * Check if multi-model is available based on model count
 */
export function isMultiModelAvailable(modelCount: number): boolean {
  return modelCount >= 2
}

/**
 * Get the recommended action based on complexity and availability
 */
export function getRecommendedAction(
  analysis: ComplexityAnalysis,
  multiModelAvailable: boolean
): "single_model" | "multi_model" | "single_model_fallback" {
  if (!analysis.useMultiModel) {
    return "single_model"
  }

  if (multiModelAvailable) {
    return "multi_model"
  }

  // Complex task but multi-model not available
  return "single_model_fallback"
}
