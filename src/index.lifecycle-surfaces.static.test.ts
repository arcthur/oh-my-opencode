import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"

describe("lifecycle surface compatibility", () => {
  test("registers command.execute.before hook with version gating", () => {
    //#given
    const indexUrl = new URL("./index.ts", import.meta.url)
    const content = readFileSync(indexUrl, "utf-8")

    //#when
    const versionConstantIndex = content.indexOf("OPENCODE_COMMAND_EXECUTE_BEFORE_HOOK_VERSION")
    const gateIndex = content.indexOf("supportsCommandExecuteBefore")
    const hookIndex = content.indexOf('"command.execute.before"')
    const runtimePipelineIndex = content.indexOf('executeRuntimePipeline("command.execute.before"')
    const runtimeNodeIndex = content.indexOf('"auto-slash-command:command.execute.before"')

    //#then
    expect(versionConstantIndex).toBeGreaterThanOrEqual(0)
    expect(gateIndex).toBeGreaterThanOrEqual(0)
    expect(hookIndex).toBeGreaterThanOrEqual(0)
    expect(runtimePipelineIndex).toBeGreaterThanOrEqual(0)
    expect(runtimeNodeIndex).toBeGreaterThanOrEqual(0)
  })

  test("registers chat.headers hook with version gating", () => {
    //#given
    const indexUrl = new URL("./index.ts", import.meta.url)
    const content = readFileSync(indexUrl, "utf-8")

    //#when
    const versionConstantIndex = content.indexOf("OPENCODE_CHAT_HEADERS_HOOK_VERSION")
    const gateIndex = content.indexOf("supportsChatHeaders")
    const hookIndex = content.indexOf('"chat.headers"')
    const runtimePipelineIndex = content.indexOf('executeRuntimePipeline("chat.headers"')
    const betaNodeIndex = content.indexOf('"internal:copilot-anthropic-beta:chat.headers"')
    const subagentNodeIndex = content.indexOf('"internal:copilot-subagent-initiator:chat.headers"')
    const copilotProviderGuardIndex = content.indexOf('providerID.includes("github-copilot")')
    const apiNpmNormalizeIndex = content.indexOf('const apiNpm = (model.api?.npm ?? "").toLowerCase()')
    const modelIDNormalizeIndex = content.indexOf(
      'const modelID = (model.modelID ?? model.id ?? "").toLowerCase()'
    )
    const anthropicGuardIndex = content.indexOf('apiNpm === "@ai-sdk/anthropic"')
    const copilotAnthropicGuardIndex = content.indexOf(
      'apiNpm === "@ai-sdk/github-copilot" && modelID.includes("claude")'
    )
    const anthropicHeaderKeyIndex = content.indexOf('const key = "anthropic-beta"')
    const anthropicHeaderValueIndex = content.indexOf("interleaved-thinking-2025-05-14")
    const subagentGuardIndex = content.indexOf("isSubagentSession(input.sessionID)")
    const initiatorHeaderIndex = content.indexOf('output.headers["x-initiator"] = "agent"')

    //#then
    expect(versionConstantIndex).toBeGreaterThanOrEqual(0)
    expect(gateIndex).toBeGreaterThanOrEqual(0)
    expect(hookIndex).toBeGreaterThanOrEqual(0)
    expect(runtimePipelineIndex).toBeGreaterThanOrEqual(0)
    expect(betaNodeIndex).toBeGreaterThanOrEqual(0)
    expect(subagentNodeIndex).toBeGreaterThanOrEqual(0)
    expect(copilotProviderGuardIndex).toBeGreaterThanOrEqual(0)
    expect(apiNpmNormalizeIndex).toBeGreaterThanOrEqual(0)
    expect(modelIDNormalizeIndex).toBeGreaterThanOrEqual(0)
    expect(anthropicGuardIndex).toBeGreaterThanOrEqual(0)
    expect(copilotAnthropicGuardIndex).toBeGreaterThanOrEqual(0)
    expect(anthropicHeaderKeyIndex).toBeGreaterThanOrEqual(0)
    expect(anthropicHeaderValueIndex).toBeGreaterThanOrEqual(0)
    expect(subagentGuardIndex).toBeGreaterThanOrEqual(0)
    expect(initiatorHeaderIndex).toBeGreaterThanOrEqual(0)
  })

  test("registers shell.env hook with version gating", () => {
    //#given
    const indexUrl = new URL("./index.ts", import.meta.url)
    const content = readFileSync(indexUrl, "utf-8")

    //#when
    const versionConstantIndex = content.indexOf("OPENCODE_SHELL_ENV_HOOK_VERSION")
    const gateIndex = content.indexOf("supportsShellEnv")
    const hookIndex = content.indexOf('"shell.env"')
    const runtimePipelineIndex = content.indexOf('executeRuntimePipeline("shell.env"')
    const runtimeNodeIndex = content.indexOf('"internal:non-interactive-env:shell.env"')
    const envMergeIndex = content.indexOf("Object.assign(output.env, NON_INTERACTIVE_ENV)")

    //#then
    expect(versionConstantIndex).toBeGreaterThanOrEqual(0)
    expect(gateIndex).toBeGreaterThanOrEqual(0)
    expect(hookIndex).toBeGreaterThanOrEqual(0)
    expect(runtimePipelineIndex).toBeGreaterThanOrEqual(0)
    expect(runtimeNodeIndex).toBeGreaterThanOrEqual(0)
    expect(envMergeIndex).toBeGreaterThanOrEqual(0)
  })
})
