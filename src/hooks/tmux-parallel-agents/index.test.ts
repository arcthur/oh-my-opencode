import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import type { PluginInput } from "@opencode-ai/plugin"
import { createTmuxParallelAgentsHook } from "./index"

type ExecFileSyncArgs = [string, string[], Record<string, unknown> | undefined]

const mockExecFileSync = mock((_file: string, _args: string[], _opts?: Record<string, unknown>) => "")

mock.module("node:child_process", () => ({
  execFileSync: mockExecFileSync,
}))

function createMockCtx(): PluginInput {
  return {
    directory: "/repo/project-a",
    client: {},
  } as unknown as PluginInput
}

describe("tmux-parallel-agents hook", () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    process.env = { ...originalEnv }
    mockExecFileSync.mockReset()
  })

  afterEach(() => {
    process.env = { ...originalEnv }
  })

  test("returns fully no-op hook surface when not running inside tmux", async () => {
    // #given
    delete process.env.TMUX

    // #when
    const hook = createTmuxParallelAgentsHook(createMockCtx())
    const output = { args: { run_in_background: true } as Record<string, unknown> }
    await hook["tool.execute.before"]({ tool: "delegate_task", sessionID: "parent" }, output)
    await hook.event({ event: { type: "session.created", properties: {} } })
    hook.triggerRescue()
    hook.cleanup()

    // #then
    expect(hook.getActiveWindows().size).toBe(0)
    expect(hook.listWorktrees()).toEqual([])
    expect(output.args.__tmux_task_id).toBeUndefined()
    expect(mockExecFileSync).not.toHaveBeenCalled()
  })

  test("creates window metadata and uses stable tmux ids for projection and lifecycle", async () => {
    // #given
    process.env.TMUX = "/tmp/tmux-1000/default,123,0"
    mockExecFileSync.mockImplementation((file: string, args: string[]) => {
      if (file === "which" && args[0] === "tmux") return "/usr/bin/tmux"

      if (file === "tmux" && args[0] === "display-message") {
        return "main"
      }

      if (file === "tmux" && args[0] === "new-window") {
        return "@9:1:%15"
      }

      if (file === "tmux" && (args[0] === "set-option" || args[0] === "send-keys")) {
        return ""
      }

      throw new Error(`unexpected command: ${file} ${args.join(" ")}`)
    })

    const hook = createTmuxParallelAgentsHook(createMockCtx())
    const output = {
      args: {
        run_in_background: true,
        description: "Fix login flow",
      } as Record<string, unknown>,
    }

    // #when
    await hook["tool.execute.before"](
      { tool: "delegate_task", sessionID: "parent-session-1" },
      output
    )

    await hook.event({
      event: {
        type: "session.created",
        properties: {
          info: {
            id: "child-session-1",
            parentID: "parent-session-1",
            title: "Fix login flow",
          },
        },
      },
    })

    // #then
    expect(typeof output.args.__tmux_task_id).toBe("string")

    const sendKeysCalls = mockExecFileSync.mock.calls.filter((call) => {
      const [, args] = call as unknown as ExecFileSyncArgs
      return args[0] === "send-keys"
    })
    expect(sendKeysCalls.length).toBeGreaterThan(0)
    expect(
      sendKeysCalls.every((call) => {
        const [, args] = call as unknown as ExecFileSyncArgs
        return args[2] === "%15"
      })
    ).toBe(true)

    const optionCalls = mockExecFileSync.mock.calls.filter((call) => {
      const [, args] = call as unknown as ExecFileSyncArgs
      return args[0] === "set-option"
    })
    const usesWindowIdAsTarget = optionCalls.every((call) => {
      const [, args] = call as unknown as ExecFileSyncArgs
      return args[3] === "@9"
    })
    expect(usesWindowIdAsTarget).toBe(true)

    const hasSessionMetadata = optionCalls.some((call) => {
      const [, args] = call as unknown as ExecFileSyncArgs
      return args[4] === "@omo_session_id" && args[5] === "child-session-1"
    })
    expect(hasSessionMetadata).toBe(true)

    const activeWindows = hook.getActiveWindows()
    expect(activeWindows.size).toBe(1)
    const active = Array.from(activeWindows.values())[0]
    expect(active?.sessionID).toBe("child-session-1")
    expect(active?.windowId).toBe("@9")
    expect(active?.windowIndex).toBe("1")
    expect(active?.paneTarget).toBe("%15")
  })

  test("recovers orphan tmux window by @omo_session_id on session.deleted", async () => {
    // #given
    process.env.TMUX = "/tmp/tmux-1000/default,123,0"
    let killedTarget: string | undefined
    mockExecFileSync.mockImplementation((file: string, args: string[]) => {
      if (file === "which" && args[0] === "tmux") return "/usr/bin/tmux"

      if (file === "tmux" && args[0] === "display-message") {
        return "main"
      }

      if (file === "tmux" && args[0] === "list-windows") {
        return "@2:2:wm-old\n@3:3:other-window"
      }

      if (file === "tmux" && args[0] === "show-options") {
        const target = args[4]
        if (target === "@2") return "orphan-session"
        throw new Error("missing option")
      }

      if (file === "tmux" && args[0] === "kill-window") {
        killedTarget = args[2]
        return ""
      }

      throw new Error(`unexpected command: ${file} ${args.join(" ")}`)
    })

    const hook = createTmuxParallelAgentsHook(createMockCtx())

    // #when
    await hook.event({
      event: {
        type: "session.deleted",
        properties: {
          info: {
            id: "orphan-session",
          },
        },
      },
    })

    // #then
    expect(killedTarget).toBe("@2")
  })

  test("rolls back created tmux window when metadata setup fails", async () => {
    // #given
    process.env.TMUX = "/tmp/tmux-1000/default,123,0"
    let killedTarget: string | undefined
    mockExecFileSync.mockImplementation((file: string, args: string[]) => {
      if (file === "which" && args[0] === "tmux") return "/usr/bin/tmux"

      if (file === "tmux" && args[0] === "display-message") {
        return "main"
      }

      if (file === "tmux" && args[0] === "new-window") {
        return "@7:4:%42"
      }

      if (file === "tmux" && args[0] === "set-option") {
        throw new Error("set-option failed")
      }

      if (file === "tmux" && args[0] === "kill-window") {
        killedTarget = args[2]
        return ""
      }

      throw new Error(`unexpected command: ${file} ${args.join(" ")}`)
    })

    const hook = createTmuxParallelAgentsHook(createMockCtx())
    const output = {
      args: {
        run_in_background: true,
        description: "Rollback safety",
      } as Record<string, unknown>,
    }

    // #when
    await hook["tool.execute.before"](
      { tool: "delegate_task", sessionID: "parent-session-2" },
      output
    )
    await hook.event({
      event: {
        type: "session.created",
        properties: {
          info: {
            id: "child-session-2",
            parentID: "parent-session-2",
            title: "Rollback safety",
          },
        },
      },
    })

    // #then
    expect(killedTarget).toBe("@7")
    expect(hook.getActiveWindows().size).toBe(0)
  })

  test("matches pending entries by title before FIFO when session.created arrives out of order", async () => {
    // #given
    process.env.TMUX = "/tmp/tmux-1000/default,123,0"
    let windowSeq = 0
    mockExecFileSync.mockImplementation((file: string, args: string[]) => {
      if (file === "which" && args[0] === "tmux") return "/usr/bin/tmux"

      if (file === "tmux" && args[0] === "display-message") {
        return "main"
      }

      if (file === "tmux" && args[0] === "new-window") {
        windowSeq += 1
        return `@${windowSeq}:${windowSeq}:%${windowSeq}`
      }

      if (file === "tmux" && (args[0] === "set-option" || args[0] === "send-keys")) {
        return ""
      }

      throw new Error(`unexpected command: ${file} ${args.join(" ")}`)
    })

    const hook = createTmuxParallelAgentsHook(createMockCtx())
    const alphaOutput = {
      args: {
        run_in_background: true,
        description: "Task alpha",
      } as Record<string, unknown>,
    }
    const betaOutput = {
      args: {
        run_in_background: true,
        description: "Task beta",
      } as Record<string, unknown>,
    }

    await hook["tool.execute.before"](
      { tool: "delegate_task", sessionID: "parent-session-3" },
      alphaOutput
    )
    await hook["tool.execute.before"](
      { tool: "delegate_task", sessionID: "parent-session-3" },
      betaOutput
    )

    const alphaTaskId = alphaOutput.args.__tmux_task_id as string
    const betaTaskId = betaOutput.args.__tmux_task_id as string

    // #when - beta session created first (out-of-order)
    await hook.event({
      event: {
        type: "session.created",
        properties: {
          info: {
            id: "child-session-beta",
            parentID: "parent-session-3",
            title: "Background: Task beta",
          },
        },
      },
    })

    await hook.event({
      event: {
        type: "session.created",
        properties: {
          info: {
            id: "child-session-alpha",
            parentID: "parent-session-3",
            title: "Background: Task alpha",
          },
        },
      },
    })

    // #then
    const activeWindows = hook.getActiveWindows()
    expect(activeWindows.size).toBe(2)

    const betaSession = Array.from(activeWindows.values()).find((item) => item.sessionID === "child-session-beta")
    const alphaSession = Array.from(activeWindows.values()).find((item) => item.sessionID === "child-session-alpha")

    expect(betaSession?.taskId).toBe(betaTaskId)
    expect(alphaSession?.taskId).toBe(alphaTaskId)
  })

  test("uses dependency resolver to map session to exact pending task when titles collide", async () => {
    // #given
    process.env.TMUX = "/tmp/tmux-1000/default,123,0"
    let windowSeq = 10
    mockExecFileSync.mockImplementation((file: string, args: string[]) => {
      if (file === "which" && args[0] === "tmux") return "/usr/bin/tmux"
      if (file === "tmux" && args[0] === "display-message") return "main"
      if (file === "tmux" && args[0] === "new-window") {
        windowSeq += 1
        return `@${windowSeq}:${windowSeq}:%${windowSeq}`
      }
      if (file === "tmux" && (args[0] === "set-option" || args[0] === "send-keys")) return ""
      throw new Error(`unexpected command: ${file} ${args.join(" ")}`)
    })

    const firstOutput = {
      args: {
        run_in_background: true,
        description: "Duplicated title",
      } as Record<string, unknown>,
    }
    const secondOutput = {
      args: {
        run_in_background: true,
        description: "Duplicated title",
      } as Record<string, unknown>,
    }

    const taskIdBySession = new Map<string, string>()
    const hook = createTmuxParallelAgentsHook(
      createMockCtx(),
      undefined,
      { resolveTaskIdBySessionID: (sessionID) => taskIdBySession.get(sessionID) }
    )

    await hook["tool.execute.before"](
      { tool: "delegate_task", sessionID: "parent-session-4" },
      firstOutput
    )
    await hook["tool.execute.before"](
      { tool: "delegate_task", sessionID: "parent-session-4" },
      secondOutput
    )

    const firstTaskId = firstOutput.args.__tmux_task_id as string
    const secondTaskId = secondOutput.args.__tmux_task_id as string
    taskIdBySession.set("child-session-2", secondTaskId)
    taskIdBySession.set("child-session-1", firstTaskId)

    // #when - reverse creation order; both titles identical
    await hook.event({
      event: {
        type: "session.created",
        properties: {
          info: {
            id: "child-session-2",
            parentID: "parent-session-4",
            title: "Background: Duplicated title",
          },
        },
      },
    })
    await hook.event({
      event: {
        type: "session.created",
        properties: {
          info: {
            id: "child-session-1",
            parentID: "parent-session-4",
            title: "Background: Duplicated title",
          },
        },
      },
    })

    // #then
    const activeWindows = hook.getActiveWindows()
    expect(activeWindows.size).toBe(2)
    const bySession = Array.from(activeWindows.values()).reduce<Record<string, string>>((acc, value) => {
      acc[value.sessionID] = value.taskId
      return acc
    }, {})
    expect(bySession["child-session-2"]).toBe(secondTaskId)
    expect(bySession["child-session-1"]).toBe(firstTaskId)
  })
})
