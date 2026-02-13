import { describe, expect, test } from "bun:test"
import { runChatParamsPolicyPipeline } from "./chat-params-policy-pipeline"

describe("chat.params policy order", () => {
  test("runs observe -> existing hooks -> enforce in deterministic order", async () => {
    const calls: string[] = []
    const output = { temperature: 0, topP: 1, topK: 0, options: {} as Record<string, unknown> }

    await runChatParamsPolicyPipeline({
      input: {
        sessionID: "s1",
        agent: "orchestrator",
        model: { providerID: "openai", modelID: "gpt-5.3-codex" },
        provider: { id: "openai" },
        message: { variant: "max" },
      },
      output,
      observe: async () => {
        calls.push("observe")
      },
      runExisting: async () => {
        calls.push("existing")
      },
      enforce: async () => {
        calls.push("enforce")
      },
    })

    expect(calls).toEqual(["observe", "existing", "enforce"])
  })
})
