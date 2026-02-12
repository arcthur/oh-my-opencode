import { describe, expect, test } from "bun:test"
import { executeSlashCommand } from "./executor"

describe("executeSlashCommand", () => {
  test("returns marketplace plugin guidance for namespaced commands", async () => {
    // #when
    const result = await executeSlashCommand({
      command: "daplug:run-prompt",
      args: "",
      raw: "/daplug:run-prompt",
    }, {
      discoverCommands: () => [],
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
    }, {
      discoverCommands: () => [],
    })

    // #then
    expect(result.success).toBe(false)
    expect(result.error).toContain(
      'Command "/unknown-command" not found.'
    )
  })
})
