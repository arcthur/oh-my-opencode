import { describe, test, expect } from "bun:test"
import { createCallOmoAgent } from "./tools"

describe("call_omo_agent", () => {
  test("tool description documents session_id limitation in background mode", () => {
    // #given
    const tool = createCallOmoAgent(
      { client: {}, directory: "/project" } as any,
      { launch: async () => ({}) } as any
    )

    // #then
    expect(tool.description).toContain("session_id")
    expect(tool.description).toContain("ONLY supported with run_in_background=false")
  })

  test("background mode returns session_id in <task_metadata>", async () => {
    // #given
    const tool = createCallOmoAgent(
      { client: {}, directory: "/project" } as any,
      {
        launch: async () => ({
          id: "bg_123",
          sessionID: "ses_abc",
          description: "Explore task",
          agent: "explore",
          status: "pending",
        }),
      } as any
    )

    const toolContext = {
      sessionID: "parent-session",
      messageID: "parent-message",
      agent: "sisyphus",
      abort: new AbortController().signal,
    }

    // #when
    const result = await tool.execute(
      {
        description: "Explore",
        prompt: "Find relevant files",
        subagent_type: "Explore",
        run_in_background: true,
      } as any,
      toolContext as any
    )

    // #then
    expect(result).toContain("Task ID: bg_123")
    expect(result).toContain("Session ID: ses_abc")
    expect(result).toContain("<task_metadata>")
    expect(result).toContain("session_id: ses_abc")
    expect(result).toContain("</task_metadata>")
  })
})
