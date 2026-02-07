import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"

describe("experimental.session.compacting", () => {
  test("does not hardcode model fallback and can use output.context", () => {
    //#given
    const indexUrl = new URL("./index.ts", import.meta.url)
    const content = readFileSync(indexUrl, "utf-8")
    const hookIndex = content.indexOf('"experimental.session.compacting"')

    //#when
    const outputContextPushIndex =
      hookIndex >= 0 ? content.indexOf("output.context.push", hookIndex) : -1
    const compactionPromptIndex =
      hookIndex >= 0 ? content.indexOf("getCompactionContextPrompt", hookIndex) : -1
    const legacyModelFallbackIndex =
      hookIndex >= 0
        ? content.indexOf('let modelID = "claude-opus-4-5"', hookIndex)
        : -1

    //#then
    expect(hookIndex).toBeGreaterThanOrEqual(0)
    expect(legacyModelFallbackIndex).toBe(-1)
    expect(outputContextPushIndex).toBeGreaterThanOrEqual(0)
    expect(compactionPromptIndex).toBeGreaterThanOrEqual(0)
  })
})
