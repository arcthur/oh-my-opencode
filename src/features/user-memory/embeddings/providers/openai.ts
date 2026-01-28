/**
 * OpenAI Embedding Provider
 *
 * Uses OpenAI's embedding API for high-quality embeddings.
 * Requires OPENAI_API_KEY environment variable.
 */

import type { EmbeddingProvider } from "../types"

// Default model and dimensions
const DEFAULT_OPENAI_MODEL = "text-embedding-3-small"
const MODEL_DIMENSIONS: Record<string, number> = {
  "text-embedding-ada-002": 1536,
  "text-embedding-3-small": 1536,
  "text-embedding-3-large": 3072,
}

/**
 * Create an OpenAI embedding provider.
 *
 * @param modelName - OpenAI model name (default: text-embedding-3-small)
 * @returns OpenAI embedding provider
 */
export async function createOpenAIProvider(
  modelName: string = DEFAULT_OPENAI_MODEL
): Promise<EmbeddingProvider> {
  const dimension = MODEL_DIMENSIONS[modelName] ?? 1536

  return {
    name: "openai",
    dimension,

    async embed(texts: string[]): Promise<number[][]> {
      const apiKey = process.env.OPENAI_API_KEY
      if (!apiKey) {
        throw new Error("OPENAI_API_KEY environment variable is not set")
      }

      const baseUrl = process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1"

      const response = await fetch(`${baseUrl}/embeddings`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: modelName,
          input: texts,
        }),
      })

      if (!response.ok) {
        const error = await response.text()
        throw new Error(`OpenAI API error: ${response.status} - ${error}`)
      }

      const data = (await response.json()) as {
        data: Array<{ embedding: number[]; index: number }>
      }

      // Sort by index and extract embeddings
      const sorted = data.data.sort((a, b) => a.index - b.index)
      return sorted.map((item) => item.embedding)
    },

    async isAvailable(): Promise<boolean> {
      return !!process.env.OPENAI_API_KEY
    },
  }
}

/**
 * Get embedding dimension for an OpenAI model.
 */
export function getOpenAIModelDimension(modelName: string): number {
  return MODEL_DIMENSIONS[modelName] ?? 1536
}
