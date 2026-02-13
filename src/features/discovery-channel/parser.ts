function parseXmlMarkers(text: string): string[] {
  const matches: string[] = []
  const pattern = /<discovery>([\s\S]*?)<\/discovery>/gi
  let match: RegExpExecArray | null
  while ((match = pattern.exec(text)) !== null) {
    const claim = match[1]?.trim()
    if (claim) matches.push(claim)
  }
  return matches
}

function parsePrefixMarkers(text: string): string[] {
  const matches: string[] = []
  const pattern = /^\s*DISCOVERY:\s*(.+)$/gim
  let match: RegExpExecArray | null
  while ((match = pattern.exec(text)) !== null) {
    const claim = match[1]?.trim()
    if (claim) matches.push(claim)
  }
  return matches
}

function dedupeClaims(claims: string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const claim of claims) {
    const key = claim.toLowerCase().replace(/\s+/g, " ").trim()
    if (!key || seen.has(key)) continue
    seen.add(key)
    result.push(claim)
  }
  return result
}

export function parseDiscoveryMarkers(
  text: string,
  mode: "xml" | "prefix" | "hybrid"
): string[] {
  if (!text || text.trim().length === 0) return []

  try {
    if (mode === "xml") {
      return dedupeClaims(parseXmlMarkers(text))
    }
    if (mode === "prefix") {
      return dedupeClaims(parsePrefixMarkers(text))
    }
    return dedupeClaims([
      ...parseXmlMarkers(text),
      ...parsePrefixMarkers(text),
    ])
  } catch {
    return []
  }
}
