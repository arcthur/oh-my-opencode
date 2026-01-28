/**
 * Embedding Provider Module
 *
 * Factory and utilities for creating embedding providers.
 */

import type { EmbeddingProvider, EmbeddingConfig } from "./types"

/**
 * Create an embedding provider based on configuration.
 *
 * @param config - Embedding configuration
 * @returns Promise resolving to embedding provider
 */
export async function createEmbeddingProvider(
  config: EmbeddingConfig
): Promise<EmbeddingProvider> {
  if (config.provider === "openai") {
    const { createOpenAIProvider } = await import("./providers/openai")
    return createOpenAIProvider(config.openai_model)
  }

  // Default to local provider
  const { createLocalProvider } = await import("./providers/local")
  return createLocalProvider(config.local_model)
}

/**
 * Check if a provider is available without creating it.
 *
 * @param providerType - Provider type to check
 * @returns True if provider is available
 */
export async function isProviderAvailable(
  providerType: "local" | "openai"
): Promise<boolean> {
  try {
    if (providerType === "openai") {
      // OpenAI is available if API key is set
      return !!process.env.OPENAI_API_KEY
    }

    // Local provider is always available (will download model on first use)
    return true
  } catch {
    return false
  }
}

/**
 * Get provider with fallback chain.
 * Tries configured provider first, falls back to local.
 *
 * @param config - Embedding configuration
 * @returns Provider and whether fallback was used
 */
export async function getProviderWithFallback(
  config: EmbeddingConfig
): Promise<{ provider: EmbeddingProvider; usedFallback: boolean }> {
  try {
    const provider = await createEmbeddingProvider(config)
    const available = await provider.isAvailable()

    if (available) {
      return { provider, usedFallback: false }
    }
  } catch {
    // Primary provider failed, try fallback
  }

  // Fallback to local if configured provider is not available
  if (config.provider !== "local") {
    const { createLocalProvider } = await import("./providers/local")
    const localProvider = await createLocalProvider()
    return { provider: localProvider, usedFallback: true }
  }

  // If local was configured and failed, throw error
  throw new Error("No embedding provider available")
}
