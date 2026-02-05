import { describe, it, expect } from "bun:test"
import { existsSync, readFileSync, readdirSync, statSync } from "fs"
import { dirname, join, resolve } from "path"

type MarkdownLink = {
  sourceFile: string
  lineNumber: number
  rawTarget: string
}

function listMarkdownFiles(directory: string): string[] {
  const entries = readdirSync(directory)
  const files: string[] = []

  for (const entry of entries) {
    const fullPath = join(directory, entry)
    const stats = statSync(fullPath)

    if (stats.isDirectory()) {
      files.push(...listMarkdownFiles(fullPath))
      continue
    }

    if (entry.endsWith(".md")) {
      files.push(fullPath)
    }
  }

  return files
}

function stripCodeFencesLines(lines: string[]): string[] {
  const out: string[] = []
  let inFence = false

  for (const line of lines) {
    const trimmed = line.trimStart()
    if (trimmed.startsWith("```")) {
      inFence = !inFence
      continue
    }

    if (!inFence) out.push(line)
  }

  return out
}

function extractLinks(markdown: string, sourceFile: string): MarkdownLink[] {
  const lines = markdown.split("\n")
  const visibleLines = stripCodeFencesLines(lines)
  const links: MarkdownLink[] = []

  for (let i = 0; i < visibleLines.length; i++) {
    const line = visibleLines[i]
    const regex = /\[[^\]]*]\(([^)]+)\)/g
    let match: RegExpExecArray | null
    while ((match = regex.exec(line)) !== null) {
      links.push({
        sourceFile,
        lineNumber: i + 1,
        rawTarget: match[1] ?? "",
      })
    }
  }

  return links
}

function normalizeLinkTarget(rawTarget: string): string {
  const trimmed = rawTarget.trim()

  // Strip angle brackets: (<path>)
  const unwrapped = trimmed.startsWith("<") && trimmed.endsWith(">") ? trimmed.slice(1, -1) : trimmed

  // Drop optional title: (path "title")
  return unwrapped.split(/\s+/)[0] ?? ""
}

function isExternalLink(target: string): boolean {
  return (
    target.startsWith("http://") ||
    target.startsWith("https://") ||
    target.startsWith("mailto:") ||
    target.startsWith("data:")
  )
}

function slugifyHeading(text: string): string {
  const cleaned = text
    .trim()
    // Remove trailing hashes used in some markdown styles: "Title ####"
    .replace(/\s+#+\s*$/, "")
    // Remove common formatting markers
    .replace(/[`*_]/g, "")
    // Remove punctuation/symbols
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")

  return cleaned
}

function getHeadingAnchors(markdown: string): Set<string> {
  const lines = stripCodeFencesLines(markdown.split("\n"))
  const anchors = new Set<string>()
  const counts = new Map<string, number>()

  for (const line of lines) {
    const match = /^(#{1,6})\s+(.+)$/.exec(line)
    if (!match) continue

    const headingText = match[2] ?? ""
    const base = slugifyHeading(headingText)
    if (!base) continue

    const current = counts.get(base) ?? 0
    const anchor = current === 0 ? base : `${base}-${current}`
    counts.set(base, current + 1)
    anchors.add(anchor)
  }

  return anchors
}

describe("docs markdown links", () => {
  it("all local markdown links resolve", () => {
    // #given docs markdown files
    const docsDir = import.meta.dirname
    const markdownFiles = listMarkdownFiles(docsDir)

    // #when validating local links
    const errors: string[] = []
    const anchorCache = new Map<string, Set<string>>()

    for (const filePath of markdownFiles) {
      const markdown = readFileSync(filePath, "utf-8")
      const links = extractLinks(markdown, filePath)

      for (const link of links) {
        const target = normalizeLinkTarget(link.rawTarget)
        if (!target || isExternalLink(target)) continue

        const [pathPartRaw, anchorPartRaw] = target.split("#", 2)
        const anchor = anchorPartRaw ?? ""

        // Anchor-only link (same file)
        if (!pathPartRaw && target.startsWith("#")) {
          const anchors =
            anchorCache.get(filePath) ??
            (() => {
              const computed = getHeadingAnchors(markdown)
              anchorCache.set(filePath, computed)
              return computed
            })()

          if (!anchors.has(anchor)) {
            errors.push(`${filePath}:${link.lineNumber} broken anchor link "#${anchor}"`)
          }
          continue
        }

        const decodedPath = decodeURIComponent(pathPartRaw)
        const resolved = resolve(dirname(filePath), decodedPath)

        if (!existsSync(resolved)) {
          errors.push(`${filePath}:${link.lineNumber} missing link target "${target}" (resolved: ${resolved})`)
          continue
        }

        // If there is an anchor and the target is markdown, verify the anchor exists in that file.
        if (anchor && resolved.endsWith(".md")) {
          const targetMarkdown = readFileSync(resolved, "utf-8")
          const anchors =
            anchorCache.get(resolved) ??
            (() => {
              const computed = getHeadingAnchors(targetMarkdown)
              anchorCache.set(resolved, computed)
              return computed
            })()

          if (!anchors.has(anchor)) {
            errors.push(`${filePath}:${link.lineNumber} broken anchor link "${target}" (missing "#${anchor}")`)
          }
        }
      }
    }

    // #then no broken local links exist
    expect(errors, errors.join("\n")).toEqual([])
  })
})
