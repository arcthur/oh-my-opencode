import type { ContextManifest, ContextManifestItem, ContextPack } from "./types"

export interface RenderContextPacksOptions {
  maxItemsPerPack?: number
  maxCharsPerPack?: number
  maxTotalChars?: number
}

function truncateWithEllipsis(input: string, maxChars: number): string {
  if (maxChars <= 0) return "..."
  if (input.length <= maxChars) return input
  if (maxChars <= 3) return ".".repeat(maxChars)
  return input.slice(0, maxChars - 3) + "..."
}

function formatItem(item: ContextManifestItem): string {
  const kindTag = `[${item.kind}]`
  const why = item.why ? ` — ${item.why}` : ""
  return `- ${item.ref} ${kindTag}${why}`
}

function renderPack(pack: ContextPack, options: Required<Pick<RenderContextPacksOptions, "maxItemsPerPack" | "maxCharsPerPack">>): string {
  const header = `### pack: ${pack.id} — ${pack.title}`
  const maxItems = options.maxItemsPerPack
  const visibleItems = pack.items.slice(0, maxItems)
  const lines: string[] = [header]

  for (const item of visibleItems) {
    lines.push(formatItem(item))
  }

  const omitted = pack.items.length - visibleItems.length
  if (omitted > 0) {
    lines.push(`- ... (${omitted} items omitted)`)
  }

  const section = lines.join("\n")
  if (section.length <= options.maxCharsPerPack) {
    return section
  }

  return truncateWithEllipsis(section, options.maxCharsPerPack)
}

/**
 * Render selected context packs as a stable markdown snippet suitable for delegate_task prompts.
 *
 * Ordering: packs are always rendered in manifest order, regardless of request order.
 */
export function renderContextPacksForPrompt(
  manifest: ContextManifest,
  requestedPackIds: string[],
  options: RenderContextPacksOptions = {}
): string {
  const normalizedRequested = requestedPackIds
    .map((id) => id.trim())
    .filter((id) => id.length > 0)

  const requestedSet = new Set<string>(normalizedRequested)
  if (requestedSet.size === 0) return ""

  const maxItemsPerPack = options.maxItemsPerPack ?? 20
  const maxCharsPerPack = options.maxCharsPerPack ?? 2500
  const maxTotalChars = options.maxTotalChars ?? 6000

  const selectedPacks = manifest.packs.filter((p) => requestedSet.has(p.id))
  if (selectedPacks.length === 0) {
    const missing = [...requestedSet].sort().join(", ")
    return truncateWithEllipsis(
      `## CONTEXT PACKS (auto-injected)\n\n_Note: missing packs: ${missing}_`,
      maxTotalChars
    )
  }

  const sections: string[] = ["## CONTEXT PACKS (auto-injected)"]
  const foundIds = new Set<string>()

  for (const pack of selectedPacks) {
    foundIds.add(pack.id)
    sections.push(
      renderPack(pack, {
        maxItemsPerPack,
        maxCharsPerPack,
      })
    )
  }

  const missingIds = [...requestedSet].filter((id) => !foundIds.has(id))
  if (missingIds.length > 0) {
    sections.push(`_Note: missing packs: ${missingIds.sort().join(", ")}_`)
  }

  const combined = sections.join("\n\n")
  return truncateWithEllipsis(combined, maxTotalChars)
}

