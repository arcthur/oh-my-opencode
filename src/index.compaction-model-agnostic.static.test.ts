import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"

describe("experimental.session.compacting", () => {
  test("delegates compacting event to context-window-governor without hardcoded model fallback", () => {
    //#given
    const indexUrl = new URL("./index.ts", import.meta.url)
    const content = readFileSync(indexUrl, "utf-8")
    const hookIndex = content.indexOf('"experimental.session.compacting"')

    //#when
    const governorNodeIndex =
      hookIndex >= 0
        ? content.indexOf('"context-window-governor:experimental.session.compacting"', hookIndex)
        : -1
    const governorInvokeIndex =
      hookIndex >= 0
        ? content.indexOf('contextWindowGovernor["experimental.session.compacting"]', hookIndex)
        : -1
    const directMessagesReadIndex =
      hookIndex >= 0 ? content.indexOf("ctx.client.session.messages", hookIndex) : -1
    const legacyModelFallbackIndex =
      hookIndex >= 0
        ? content.indexOf('let modelID = "claude-opus-4-5"', hookIndex)
        : -1

    //#then
    expect(hookIndex).toBeGreaterThanOrEqual(0)
    expect(legacyModelFallbackIndex).toBe(-1)
    expect(governorNodeIndex).toBeGreaterThanOrEqual(0)
    expect(governorInvokeIndex).toBeGreaterThanOrEqual(0)
    expect(directMessagesReadIndex).toBe(-1)
  })
})
