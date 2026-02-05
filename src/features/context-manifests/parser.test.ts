import { describe, expect, test } from "bun:test"
import { parseContextManifestFromMarkdown } from "./parser"

describe("context-manifests/parser", () => {
  test("should parse manifest JSON block from markdown", () => {
    // #given
    const markdown = `# Context Manifest: demo

[CONTEXT_MANIFEST]
{
  "schemaVersion": 1,
  "planName": "demo",
  "generatedAt": "2026-02-05T00:00:00Z",
  "packs": [
    {
      "id": "global",
      "title": "Global guardrails",
      "items": [
        { "kind": "doc", "ref": "docs/guide/orchestration.md", "why": "Execution workflow" }
      ]
    }
  ]
}
[/CONTEXT_MANIFEST]
`

    // #when
    const manifest = parseContextManifestFromMarkdown(markdown)

    // #then
    expect(manifest).not.toBeNull()
    expect(manifest!.schemaVersion).toBe(1)
    expect(manifest!.planName).toBe("demo")
    expect(manifest!.packs).toHaveLength(1)
    expect(manifest!.packs[0]!.id).toBe("global")
    expect(manifest!.packs[0]!.items[0]!.kind).toBe("doc")
  })

  test("should return null when no manifest block exists", () => {
    // #given
    const markdown = `# No manifest here`

    // #when
    const manifest = parseContextManifestFromMarkdown(markdown)

    // #then
    expect(manifest).toBeNull()
  })

  test("should return null when JSON is invalid", () => {
    // #given
    const markdown = `[CONTEXT_MANIFEST]{ not-json }[/CONTEXT_MANIFEST]`

    // #when
    const manifest = parseContextManifestFromMarkdown(markdown)

    // #then
    expect(manifest).toBeNull()
  })

  test("should return null when schemaVersion is unsupported", () => {
    // #given
    const markdown = `[CONTEXT_MANIFEST]{"schemaVersion":2,"planName":"x","packs":[]}[/CONTEXT_MANIFEST]`

    // #when
    const manifest = parseContextManifestFromMarkdown(markdown)

    // #then
    expect(manifest).toBeNull()
  })

  test("should return null when pack id is invalid", () => {
    // #given
    const markdown = `# Bad pack id

[CONTEXT_MANIFEST]
{
  "schemaVersion": 1,
  "planName": "demo",
  "generatedAt": "2026-02-05T00:00:00Z",
  "packs": [
    {
      "id": "not safe id",
      "title": "Bad",
      "items": [{ "kind": "doc", "ref": "docs/a.md" }]
    }
  ]
}
[/CONTEXT_MANIFEST]
`

    // #when
    const manifest = parseContextManifestFromMarkdown(markdown)

    // #then
    expect(manifest).toBeNull()
  })
})

