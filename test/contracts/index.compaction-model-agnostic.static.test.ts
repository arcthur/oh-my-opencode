import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

describe("experimental.session.compacting", () => {
  test("routes compacting event through policy-wrapped bridge path without hardcoded model fallback", () => {
    //#given
    const indexPath = resolve(import.meta.dir, "../../src/index.ts")
    const assemblyPath = resolve(
      import.meta.dir,
      "../../src/hooks/runtime/assembly/experimental-session-compacting.ts"
    )
    const indexContent = readFileSync(indexPath, "utf-8")
    const assemblyContent = readFileSync(assemblyPath, "utf-8")
    const hookIndex = indexContent.indexOf('"experimental.session.compacting"')

    //#when
    const builderCallIndex =
      hookIndex >= 0
        ? indexContent.indexOf(
          "buildExperimentalSessionCompactingNodes(",
          hookIndex
        )
        : -1
    const bridgeNodeIndex = assemblyContent.indexOf(
      '"bridge:claude-code-hooks:experimental.session.compacting"'
    )
    const observeNodeIndex = assemblyContent.indexOf(
      '"internal:policy-observe:experimental.session.compacting"'
    )
    const enforceNodeIndex = assemblyContent.indexOf(
      '"internal:policy-enforce:experimental.session.compacting"'
    )
    const bridgeInvokeIndex = assemblyContent.indexOf(
      'claudeCodeHooks?.["experimental.session.compacting"]'
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
    expect(observeNodeIndex).toBeGreaterThanOrEqual(0)
    expect(bridgeNodeIndex).toBeGreaterThanOrEqual(0)
    expect(enforceNodeIndex).toBeGreaterThanOrEqual(0)
    expect(bridgeInvokeIndex).toBeGreaterThanOrEqual(0)
    expect(directMessagesReadIndex).toBe(-1)
  })
})
