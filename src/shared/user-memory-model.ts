import type { CategoriesConfig } from "../config/schema"
import { resolveModel } from "./model-resolver"

const AGGREGATION_MODEL_TO_CATEGORY = {
  haiku: "quick",
  sonnet: "unspecified-low",
  opus: "unspecified-high",
} as const

const DEFAULT_CATEGORY_MODELS: Record<string, string> = {
  quick: "anthropic/claude-haiku-4-5",
  "unspecified-low": "anthropic/claude-sonnet-4-5",
  "unspecified-high": "anthropic/claude-opus-4-5",
}

const parseModelString = (model: string): { providerID: string; modelID: string } | undefined => {
  const parts = model.split("/")
  if (parts.length >= 2) {
    return { providerID: parts[0], modelID: parts.slice(1).join("/") }
  }
  return undefined
}

export function resolveUserMemoryAggregationModel(
  aggregationModel: keyof typeof AGGREGATION_MODEL_TO_CATEGORY,
  categories?: CategoriesConfig
): { providerID: string; modelID: string } | undefined {
  const categoryName = AGGREGATION_MODEL_TO_CATEGORY[aggregationModel]
  const defaultModel = DEFAULT_CATEGORY_MODELS[categoryName]
  if (!defaultModel) return undefined

  const userModel = categories?.[categoryName]?.model
  const resolved = resolveModel({
    userModel,
    inheritedModel: defaultModel,
    systemDefault: defaultModel,
  })

  return parseModelString(resolved)
}
