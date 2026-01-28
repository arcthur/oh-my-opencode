/**
 * Governance Shared Utilities
 *
 * Common utilities used across governance modules to avoid duplication.
 */

// ============================================================================
// ID Generation
// ============================================================================

/**
 * Generate a unique ID with optional prefix
 * @param prefix - Optional prefix for the ID (e.g., "cp" for checkpoint)
 * @param randomLength - Length of random suffix (default: 8)
 */
export function generateId(prefix?: string, randomLength = 8): string {
  const timestamp = Date.now().toString(36)
  const random = Math.random().toString(36).substring(2, 2 + randomLength)
  return prefix ? `${prefix}-${timestamp}-${random}` : `${timestamp}-${random}`
}

// ============================================================================
// Data Sanitization
// ============================================================================

/**
 * Sensitive key patterns for redaction
 */
const DEFAULT_SENSITIVE_KEYS = ["password", "token", "secret", "key", "credential", "auth"]

/**
 * Options for data sanitization
 */
export interface SanitizeOptions {
  /** Whether to sanitize at all (if false, returns data unchanged) */
  enabled?: boolean
  /** Maximum string length before truncation */
  maxLength?: number
  /** Additional sensitive keys to check */
  sensitiveKeys?: string[]
  /** Truncation suffix format */
  truncationSuffix?: "simple" | "detailed"
}

const DEFAULT_SANITIZE_OPTIONS: Required<SanitizeOptions> = {
  enabled: true,
  maxLength: 1000,
  sensitiveKeys: DEFAULT_SENSITIVE_KEYS,
  truncationSuffix: "simple",
}

/**
 * Sanitize data by redacting sensitive keys and truncating long strings
 */
export function sanitizeData(
  data: Record<string, unknown>,
  options: SanitizeOptions = {}
): Record<string, unknown> {
  const opts = { ...DEFAULT_SANITIZE_OPTIONS, ...options }

  if (!opts.enabled) return data

  const allSensitiveKeys = [...DEFAULT_SENSITIVE_KEYS, ...opts.sensitiveKeys]
  const sanitized: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(data)) {
    const lowerKey = key.toLowerCase()

    if (allSensitiveKeys.some((sk) => lowerKey.includes(sk))) {
      sanitized[key] = "[REDACTED]"
    } else if (typeof value === "string" && value.length > opts.maxLength) {
      if (opts.truncationSuffix === "detailed") {
        sanitized[key] = value.slice(0, opts.maxLength) + `...[truncated: ${value.length} chars]`
      } else {
        sanitized[key] = value.slice(0, opts.maxLength) + "...[truncated]"
      }
    } else {
      sanitized[key] = value
    }
  }

  return sanitized
}

/**
 * Sanitize inputs (uses default truncation length of 1000)
 */
export function sanitizeInputs(
  inputs: Record<string, unknown>,
  enabled = true
): Record<string, unknown> {
  return sanitizeData(inputs, { enabled, maxLength: 1000 })
}

/**
 * Sanitize outputs (uses larger truncation length of 5000, detailed suffix)
 */
export function sanitizeOutputs(
  outputs: Record<string, unknown>,
  enabled = true
): Record<string, unknown> {
  return sanitizeData(outputs, { enabled, maxLength: 5000, truncationSuffix: "detailed" })
}
