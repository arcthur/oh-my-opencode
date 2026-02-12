import type { CategoriesConfig, CategoryConfig } from "../config/schema"
import { DEFAULT_CATEGORIES } from "../tools/delegate-task/constants"

/**
 * Merge builtin + user categories and drop entries explicitly disabled by users.
 * This is the single source of truth for category visibility across prompts/tools.
 */
export function mergeCategories(
  userCategories?: CategoriesConfig
): Record<string, CategoryConfig> {
  const merged = userCategories
    ? { ...DEFAULT_CATEGORIES, ...userCategories }
    : { ...DEFAULT_CATEGORIES }

  return Object.fromEntries(
    Object.entries(merged).filter(([, config]) => config.disable !== true),
  )
}
