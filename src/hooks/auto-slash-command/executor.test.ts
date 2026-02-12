import { describe, expect, test, mock } from "bun:test"

mock.module("../../shared/slash-command-catalog", () => ({
  discoverSlashCommandsSync: () => [],
}))

const { executeSlashCommand } = await import("./executor")

describe("executeSlashCommand", () => {
  test("returns marketplace plugin guidance for namespaced commands", async () => {
    // #when
    const result = await executeSlashCommand({
      command: "daplug:run-prompt",
      args: "",
      raw: "/daplug:run-prompt",
    })

    // #then
    expect(result.success).toBe(false)
    expect(result.error).toContain(
      'Marketplace plugin commands like "/daplug:run-prompt" are not supported.'
    )
  })

  test("keeps generic not-found message for normal commands", async () => {
    // #when
    const result = await executeSlashCommand({
      command: "unknown-command",
      args: "",
      raw: "/unknown-command",
    })

    // #then
    expect(result.success).toBe(false)
    expect(result.error).toContain(
      'Command "/unknown-command" not found.'
    )
  })
})
