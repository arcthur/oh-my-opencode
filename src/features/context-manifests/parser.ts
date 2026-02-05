import { ContextManifestSchema, type ContextManifest } from "./types"

const MANIFEST_BLOCK_REGEX =
  /\[CONTEXT_MANIFEST\]\s*([\s\S]*?)\s*\[\/CONTEXT_MANIFEST\]/i

export function parseContextManifestFromMarkdown(markdown: string): ContextManifest | null {
  const match = markdown.match(MANIFEST_BLOCK_REGEX)
  if (!match) return null

  const rawJson = match[1]?.trim()
  if (!rawJson) return null

  try {
    const parsed = JSON.parse(rawJson) as unknown
    const result = ContextManifestSchema.safeParse(parsed)
    if (!result.success) return null
    return result.data
  } catch {
    return null
  }
}

