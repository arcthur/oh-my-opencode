import * as path from "path"

/**
 * Characters that are unsafe in file/directory names across platforms
 */
const UNSAFE_CHARS = /[<>:"/\\|?*\x00-\x1f]/g

/**
 * Patterns that could lead to path traversal
 */
const PATH_TRAVERSAL_PATTERNS = /(?:^|[/\\])\.\.(?:[/\\]|$)/

/**
 * Sanitize a name for safe use in file paths.
 *
 * This function:
 * - Removes/replaces unsafe characters
 * - Prevents path traversal attacks (../, ..\)
 * - Ensures the result is a valid basename (no directory separators)
 * - Returns undefined if the input cannot be safely sanitized
 *
 * @param name - The name to sanitize (e.g., planId, modelName)
 * @param options - Sanitization options
 * @returns Sanitized name or undefined if invalid
 */
export function sanitizePathSegment(
  name: string,
  options: {
    /** Maximum length for the sanitized name (default: 100) */
    maxLength?: number
    /** Replacement character for unsafe chars (default: "-") */
    replacement?: string
    /** Allow dots in the name (default: true, but ".." is always blocked) */
    allowDots?: boolean
  } = {}
): string | undefined {
  const { maxLength = 100, replacement = "-", allowDots = true } = options

  if (!name || typeof name !== "string") {
    return undefined
  }

  // Trim whitespace
  let sanitized = name.trim()

  if (sanitized.length === 0) {
    return undefined
  }

  // Check for path traversal attempts
  if (PATH_TRAVERSAL_PATTERNS.test(sanitized)) {
    return undefined
  }

  // Remove path separators - we only want a single segment
  sanitized = path.basename(sanitized)

  // Replace unsafe characters
  sanitized = sanitized.replace(UNSAFE_CHARS, replacement)

  // Handle dots
  if (!allowDots) {
    sanitized = sanitized.replace(/\./g, replacement)
  } else {
    // Still block consecutive dots (potential path traversal)
    sanitized = sanitized.replace(/\.{2,}/g, replacement)
  }

  // Remove leading/trailing dots and dashes
  sanitized = sanitized.replace(/^[.-]+|[.-]+$/g, "")

  // Collapse multiple replacement characters
  const escapedReplacement = replacement.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  sanitized = sanitized.replace(new RegExp(`${escapedReplacement}{2,}`, "g"), replacement)

  // Truncate to max length
  if (sanitized.length > maxLength) {
    sanitized = sanitized.slice(0, maxLength).replace(/[.-]+$/, "")
  }

  // Final validation - must have some content
  if (sanitized.length === 0 || sanitized === replacement) {
    return undefined
  }

  return sanitized
}
