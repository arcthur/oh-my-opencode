import type { CategoriesConfig } from "../config/schema"
import { resolveModel } from "./model-resolver"

const AGGREGATION_MODEL_TO_CATEGORY = {
  haiku: "quick",
  sonnet: "unspecified-low",
  opus: "unspecified-high",
} as const

// No hardcoded default models - use systemDefaultModel

const parseModelString = (model: string): { providerID: string; modelID: string } | undefined => {
  const parts = model.split("/")
  if (parts.length >= 2) {
    return { providerID: parts[0], modelID: parts.slice(1).join("/") }
  }
  return undefined
}

export function resolveUserMemoryAggregationModel(
  aggregationModel: keyof typeof AGGREGATION_MODEL_TO_CATEGORY,
  categories?: CategoriesConfig,
  systemDefaultModel?: string
): { providerID: string; modelID: string } | undefined {
  const categoryName = AGGREGATION_MODEL_TO_CATEGORY[aggregationModel]

  const userModel = categories?.[categoryName]?.model

  // If we have neither userModel nor systemDefaultModel, we can't resolve a model
  if (!userModel && !systemDefaultModel) {
    return undefined
  }

  // resolveModel requires systemDefault, so use userModel as fallback if systemDefaultModel is missing
  const resolved = resolveModel({
    userModel,
    systemDefault: systemDefaultModel ?? userModel ?? "",
  })

  if (!resolved) return undefined
  return parseModelString(resolved)
}
