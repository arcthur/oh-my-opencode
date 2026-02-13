import { describe, test, expect } from "bun:test"
import type { PluginInput } from "@opencode-ai/plugin"
import { createDelegationValidateDecisionHook } from "./index"

function createMockCtx(payload: unknown): PluginInput {
  return {
    directory: "/test",
    client: {
      session: {
        messages: async () => payload,
      },
    },
  } as unknown as PluginInput
}

describe("delegation-validate-decision hook", () => {
  test("injects missing decision warning when session.messages returns an array", async () => {
    // #given
    const ctx = createMockCtx([
      { info: { role: "user" }, parts: [{ type: "text", text: "do it" }] },
      { info: { role: "assistant" }, parts: [{ type: "text", text: "no decision here" }] },
    ])
    const hook = createDelegationValidateDecisionHook(ctx)
    const output = { args: {} as Record<string, unknown> }

    // #when
    await hook["tool.execute.before"]?.({ tool: "delegate_task", sessionID: "s1" }, output)

    // #then
    expect(output.message).toContain("No `<delegation-decision>` block found")
  })

  test("injects validation warnings when decision is present but suboptimal", async () => {
    // #given
    const ctx = createMockCtx({
      data: [
        { info: { role: "assistant" }, parts: [{ type: "text", text: "prep" }] },
        {
          info: { role: "assistant" },
          parts: [
            {
              type: "text",
              text: `<delegation-decision>
{
  "agent": "advisor",
  "taskType": "exploration",
  "complexity": "trivial",
  "domain": "general",
  "reason": "test",
  "signals": ["s1"]
}
</delegation-decision>`,
            },
          ],
        },
      ],
    })
    const hook = createDelegationValidateDecisionHook(ctx)
    const output = { args: {} as Record<string, unknown> }

    // #when
    await hook["tool.execute.before"]?.({ tool: "delegate_task", sessionID: "s2" }, output)

    // #then
    expect(output.message).toContain("Potential issues with delegation choice")
    expect(output.message).toContain("task_type_mismatch")
    expect(output.message).toContain("overkill")
  })
})

