/**
 * Local Embedding Provider
 *
 * Uses @huggingface/transformers (ONNX runtime) for offline embeddings.
 * Model: all-MiniLM-L6-v2 (384 dimensions, ~23MB)
 */

import type { EmbeddingProvider } from "../types"

// Default model for local embeddings
const DEFAULT_LOCAL_MODEL = "Xenova/all-MiniLM-L6-v2"
const DEFAULT_DIMENSION = 384

// Singleton pattern for lazy loading
let extractor: any = null
let currentModel: string | null = null

/**
 * Initialize the feature extraction pipeline.
 * Lazy loads the model on first use.
 */
async function initPipeline(modelName: string): Promise<void> {
  if (extractor && currentModel === modelName) {
    return // Already initialized with same model
  }

  // Dynamic import to avoid loading transformers.js until needed
  const { pipeline: createPipeline } = await import("@huggingface/transformers")

  // Create feature extraction pipeline
  extractor = await createPipeline("feature-extraction", modelName, {
    quantized: true, // Use quantized model for smaller size
  })

  currentModel = modelName
}

/**
 * Create a local embedding provider using transformers.js.
 *
 * @param modelName - HuggingFace model name (default: Xenova/all-MiniLM-L6-v2)
 * @returns Local embedding provider
 */
export async function createLocalProvider(
  modelName: string = DEFAULT_LOCAL_MODEL
): Promise<EmbeddingProvider> {
  // Determine dimension based on model
  const dimension = getModelDimension(modelName)

  return {
    name: "local",
    dimension,

    async embed(texts: string[]): Promise<number[][]> {
      // Lazy init on first use
      await initPipeline(modelName)

      const results: number[][] = []

      for (const text of texts) {
        // Get embeddings with mean pooling and normalization
        const output = await extractor(text, {
          pooling: "mean",
          normalize: true,
        })

        // Convert tensor to array
        const embedding = Array.from(output.data as Float32Array)
        results.push(embedding)
      }

      return results
    },

    async isAvailable(): Promise<boolean> {
      try {
        // Try to import the module - if it fails, provider is not available
        await import("@huggingface/transformers")
        return true
      } catch {
        return false
      }
    },
  }
}

/**
 * Get embedding dimension for a model.
 */
export function getModelDimension(modelName: string): number {
  if (modelName.includes("MiniLM-L6")) return 384
  if (modelName.includes("MiniLM-L12")) return 384
  if (modelName.includes("mpnet")) return 768
  if (modelName.includes("bge-small")) return 384
  if (modelName.includes("bge-base")) return 768
  return DEFAULT_DIMENSION
}
