import { describe, expect, test } from "bun:test"
import { renderContextPacksForPrompt } from "./render"
import type { ContextManifest } from "./types"

describe("context-manifests/render", () => {
  test("should render selected packs in manifest order", () => {
    // #given
    const manifest: ContextManifest = {
      schemaVersion: 1,
      planName: "demo",
      generatedAt: "2026-02-05T00:00:00Z",
      packs: [
        {
          id: "global",
          title: "Global guardrails",
          items: [{ kind: "doc", ref: "docs/a.md", why: "A" }],
        },
        {
          id: "tooling",
          title: "Tooling",
          items: [{ kind: "code", ref: "src/x.ts", why: "X" }],
        },
      ],
    }

    // #when
    const text = renderContextPacksForPrompt(manifest, ["tooling", "global"])

    // #then
    const globalIndex = text.indexOf("pack: global")
    const toolingIndex = text.indexOf("pack: tooling")
    expect(globalIndex).toBeGreaterThanOrEqual(0)
    expect(toolingIndex).toBeGreaterThan(globalIndex)
    expect(text).toContain("docs/a.md")
    expect(text).toContain("src/x.ts")
  })

  test("should cap items per pack and mention omission", () => {
    // #given
    const manifest: ContextManifest = {
      schemaVersion: 1,
      planName: "demo",
      generatedAt: "2026-02-05T00:00:00Z",
      packs: [
        {
          id: "big",
          title: "Big pack",
          items: [
            { kind: "doc", ref: "a.md" },
            { kind: "doc", ref: "b.md" },
            { kind: "doc", ref: "c.md" },
          ],
        },
      ],
    }

    // #when
    const text = renderContextPacksForPrompt(manifest, ["big"], { maxItemsPerPack: 2 })

    // #then
    expect(text).toContain("a.md")
    expect(text).toContain("b.md")
    expect(text).not.toContain("c.md")
    expect(text.toLowerCase()).toContain("omitted")
  })
})

