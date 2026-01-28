/**
 * Type declarations for @huggingface/transformers
 *
 * This module is optional and only loaded when local embeddings are used.
 * The actual types are inferred at runtime.
 */

declare module "@huggingface/transformers" {
  export interface PipelineOptions {
    quantized?: boolean
  }

  export interface EmbeddingOptions {
    pooling?: "mean" | "cls" | "max"
    normalize?: boolean
  }

  export interface EmbeddingOutput {
    data: Float32Array
  }

  export type FeatureExtractionPipeline = (
    text: string,
    options?: EmbeddingOptions
  ) => Promise<EmbeddingOutput>

  export function pipeline(
    task: "feature-extraction",
    model: string,
    options?: PipelineOptions
  ): Promise<FeatureExtractionPipeline>
}
