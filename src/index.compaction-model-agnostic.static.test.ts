import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"

describe("experimental.session.compacting", () => {
  test("delegates compacting event to context-window-governor without hardcoded model fallback", () => {
    //#given
    const indexUrl = new URL("./index.ts", import.meta.url)
    const assemblyUrl = new URL(
      "./hooks/runtime/assembly/experimental-session-compacting.ts",
      import.meta.url
    )
    const indexContent = readFileSync(indexUrl, "utf-8")
    const assemblyContent = readFileSync(assemblyUrl, "utf-8")
    const hookIndex = indexContent.indexOf('"experimental.session.compacting"')

    //#when
    const builderCallIndex =
      hookIndex >= 0
        ? indexContent.indexOf(
          "buildExperimentalSessionCompactingNodes(",
          hookIndex
        )
        : -1
    const governorNodeIndex = assemblyContent.indexOf(
      '"context-window-governor:experimental.session.compacting"'
    )
    const governorInvokeIndex = assemblyContent.indexOf(
      'contextWindowGovernor?.["experimental.session.compacting"]'
    )
    const directMessagesReadIndex =
      hookIndex >= 0
        ? indexContent.indexOf("ctx.client.session.messages", hookIndex)
        : -1
    const legacyModelFallbackIndex = assemblyContent.indexOf(
      'let modelID = "claude-opus-4-5"'
    )

    //#then
    expect(hookIndex).toBeGreaterThanOrEqual(0)
    expect(legacyModelFallbackIndex).toBe(-1)
    expect(builderCallIndex).toBeGreaterThanOrEqual(0)
    expect(governorNodeIndex).toBeGreaterThanOrEqual(0)
    expect(governorInvokeIndex).toBeGreaterThanOrEqual(0)
    expect(directMessagesReadIndex).toBe(-1)
  })
})
