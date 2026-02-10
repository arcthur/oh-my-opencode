export function normalizePluginList(rawPluginValue: unknown): string[] {
  if (!Array.isArray(rawPluginValue)) {
    return []
  }

  return rawPluginValue.filter((item): item is string => typeof item === "string")
}
