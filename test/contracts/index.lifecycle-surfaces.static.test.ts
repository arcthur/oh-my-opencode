import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

describe("lifecycle surface compatibility", () => {
  test("registers command.execute.before hook with version gating", () => {
    //#given
    const indexPath = resolve(import.meta.dir, "../../src/index.ts")
    const builderPath = resolve(
      import.meta.dir,
      "../../src/hooks/runtime/assembly/command-execute-before.ts"
    )
    const content = readFileSync(indexPath, "utf-8")
    const builderContent = readFileSync(builderPath, "utf-8")

    //#when
    const versionConstantIndex = content.indexOf("OPENCODE_COMMAND_EXECUTE_BEFORE_HOOK_VERSION")
    const gateIndex = content.indexOf("supportsCommandExecuteBefore")
    const hookIndex = content.indexOf('"command.execute.before"')
    const runtimePipelineIndex = content.indexOf('executeRuntimePipeline("command.execute.before"')
    const runtimeBuilderIndex = content.indexOf("buildCommandExecuteBeforeNodes(")
    const runtimeNodeIndex = builderContent.indexOf('"auto-slash-command:command.execute.before"')

    //#then
    expect(versionConstantIndex).toBeGreaterThanOrEqual(0)
    expect(gateIndex).toBeGreaterThanOrEqual(0)
    expect(hookIndex).toBeGreaterThanOrEqual(0)
    expect(runtimePipelineIndex).toBeGreaterThanOrEqual(0)
    expect(runtimeBuilderIndex).toBeGreaterThanOrEqual(0)
    expect(runtimeNodeIndex).toBeGreaterThanOrEqual(0)
  })

  test("registers chat.headers hook with version gating", () => {
    //#given
    const indexPath = resolve(import.meta.dir, "../../src/index.ts")
    const builderPath = resolve(
      import.meta.dir,
      "../../src/hooks/runtime/assembly/chat-headers.ts"
    )
    const content = readFileSync(indexPath, "utf-8")
    const builderContent = readFileSync(builderPath, "utf-8")

    //#when
    const versionConstantIndex = content.indexOf("OPENCODE_CHAT_HEADERS_HOOK_VERSION")
    const gateIndex = content.indexOf("supportsChatHeaders")
    const hookIndex = content.indexOf('"chat.headers"')
    const runtimePipelineIndex = content.indexOf('executeRuntimePipeline("chat.headers"')
    const runtimeBuilderIndex = content.indexOf("buildChatHeadersNodes(")
    const betaNodeIndex = builderContent.indexOf('"internal:copilot-anthropic-beta:chat.headers"')
    const subagentNodeIndex = builderContent.indexOf('"internal:copilot-subagent-initiator:chat.headers"')
    const copilotProviderGuardIndex = builderContent.indexOf('providerID.includes("github-copilot")')
    const apiNpmNormalizeIndex = builderContent.indexOf(
      'const apiNpm = (model.api?.npm ?? "").toLowerCase()'
    )
    const modelIDNormalizeIndex = builderContent.indexOf(
      'const modelID = (model.modelID ?? model.id ?? "").toLowerCase()'
    )
    const anthropicGuardIndex = builderContent.indexOf('apiNpm === "@ai-sdk/anthropic"')
    const copilotAnthropicGuardIndex = builderContent.indexOf(
      'apiNpm === "@ai-sdk/github-copilot" && modelID.includes("claude")'
    )
    const anthropicHeaderKeyIndex = builderContent.indexOf('const key = "anthropic-beta"')
    const anthropicHeaderValueIndex = builderContent.indexOf("interleaved-thinking-2025-05-14")
    const subagentGuardIndex = builderContent.indexOf("isSubagentSession(input.sessionID)")
    const initiatorHeaderIndex = builderContent.indexOf('output.headers["x-initiator"] = "agent"')

    //#then
    expect(versionConstantIndex).toBeGreaterThanOrEqual(0)
    expect(gateIndex).toBeGreaterThanOrEqual(0)
    expect(hookIndex).toBeGreaterThanOrEqual(0)
    expect(runtimePipelineIndex).toBeGreaterThanOrEqual(0)
    expect(runtimeBuilderIndex).toBeGreaterThanOrEqual(0)
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
    const indexPath = resolve(import.meta.dir, "../../src/index.ts")
    const builderPath = resolve(import.meta.dir, "../../src/hooks/runtime/assembly/shell-env.ts")
    const content = readFileSync(indexPath, "utf-8")
    const builderContent = readFileSync(builderPath, "utf-8")

    //#when
    const versionConstantIndex = content.indexOf("OPENCODE_SHELL_ENV_HOOK_VERSION")
    const gateIndex = content.indexOf("supportsShellEnv")
    const hookIndex = content.indexOf('"shell.env"')
    const runtimePipelineIndex = content.indexOf('executeRuntimePipeline("shell.env"')
    const runtimeBuilderIndex = content.indexOf("buildShellEnvNodes(")
    const runtimeNodeIndex = builderContent.indexOf('"internal:non-interactive-env:shell.env"')
    const envMergeIndex = builderContent.indexOf("Object.assign(output.env, NON_INTERACTIVE_ENV)")

    //#then
    expect(versionConstantIndex).toBeGreaterThanOrEqual(0)
    expect(gateIndex).toBeGreaterThanOrEqual(0)
    expect(hookIndex).toBeGreaterThanOrEqual(0)
    expect(runtimePipelineIndex).toBeGreaterThanOrEqual(0)
    expect(runtimeBuilderIndex).toBeGreaterThanOrEqual(0)
    expect(runtimeNodeIndex).toBeGreaterThanOrEqual(0)
    expect(envMergeIndex).toBeGreaterThanOrEqual(0)
  })
})
