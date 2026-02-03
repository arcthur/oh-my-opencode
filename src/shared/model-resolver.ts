import { log } from "./logger"
import { fuzzyMatchModel } from "./model-availability"
import type { FallbackEntry } from "./model-requirements"

/**
 * Input for model resolution.
 * All model strings are optional except systemDefault which is the terminal fallback.
 */
export type ModelResolutionInput = {
  /** Model from user category config */
  userModel?: string
  /** Model inherited from parent task/session */
  inheritedModel?: string
  /** System default model from OpenCode config - always required */
  systemDefault: string
}

export type ModelSource = "override" | "category-default" | "provider-fallback" | "system-default"

export type ModelResolutionResult = {
  model: string
  source: ModelSource
}

export type ExtendedModelResolutionInput = {
  userModel?: string
  fallbackChain?: FallbackEntry[]
  availableModels: Set<string>
  systemDefaultModel: string
}

/**
 * Normalizes a model string.
 * Trims whitespace and treats empty/whitespace-only as undefined.
 */
function normalizeModel(model?: string): string | undefined {
  const trimmed = model?.trim()
  return trimmed || undefined
}

/**
 * Resolves the effective model using priority chain:
 * userModel → inheritedModel → systemDefault
 *
 * Empty strings and whitespace-only strings are treated as unset.
 */
export function resolveModel(input: ModelResolutionInput): string {
  return (
    normalizeModel(input.userModel) ??
    normalizeModel(input.inheritedModel) ??
    input.systemDefault
  )
}

/**
 * Resolves a model using 3-step fallback:
 * 1. User override (if provided)
 * 2. Provider fallback chain (first available match)
 * 3. System default
 */
export function resolveModelWithFallback(
  input: ExtendedModelResolutionInput
): ModelResolutionResult {
  const { userModel, fallbackChain, availableModels, systemDefaultModel } = input

  // Step 1: Override
  const normalizedUserModel = normalizeModel(userModel)
  if (normalizedUserModel) {
    log("Model resolved via override", { model: normalizedUserModel })
    return { model: normalizedUserModel, source: "override" }
  }

  // Step 2: Provider fallback chain (with availability check)
  if (fallbackChain && fallbackChain.length > 0) {
    for (const entry of fallbackChain) {
      for (const provider of entry.providers) {
        const fullModel = `${provider}/${entry.model}`
        const match = fuzzyMatchModel(fullModel, availableModels, [provider])
        if (match) {
          log("Model resolved via fallback chain", {
            provider,
            model: entry.model,
            match,
          })
          return { model: match, source: "provider-fallback" }
        }
      }
    }
  }

  // Step 3: System default
  log("Model resolved via system default", { model: systemDefaultModel })
  return { model: systemDefaultModel, source: "system-default" }
}
