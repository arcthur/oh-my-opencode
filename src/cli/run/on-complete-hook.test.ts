import { describe, it, expect, spyOn, beforeEach, afterEach } from "bun:test"
import { executeOnCompleteHook } from "./on-complete-hook"

describe("executeOnCompleteHook", () => {
  function createProc(exitCode: number) {
    return {
      exited: Promise.resolve(exitCode),
      exitCode,
    } as unknown as ReturnType<typeof Bun.spawn>
  }

  let consoleErrorSpy: ReturnType<typeof spyOn<typeof console, "error">>

  beforeEach(() => {
    consoleErrorSpy = spyOn(console, "error").mockImplementation(() => {})
  })

  afterEach(() => {
    consoleErrorSpy.mockRestore()
  })

  it("executes command with expected env vars", async () => {
    const spawnSpy = spyOn(Bun, "spawn").mockReturnValue(createProc(0))

    try {
      await executeOnCompleteHook({
        command: "echo test",
        sessionId: "session-123",
        exitCode: 0,
        durationMs: 5000,
        messageCount: 10,
      })

      expect(spawnSpy).toHaveBeenCalledTimes(1)
      const [args, options] = spawnSpy.mock.calls[0] as Parameters<typeof Bun.spawn>

      expect(args).toEqual(["sh", "-c", "echo test"])
      expect(options?.env?.SESSION_ID).toBe("session-123")
      expect(options?.env?.EXIT_CODE).toBe("0")
      expect(options?.env?.DURATION_MS).toBe("5000")
      expect(options?.env?.MESSAGE_COUNT).toBe("10")
      expect(options?.stdout).toBe("inherit")
      expect(options?.stderr).toBe("inherit")
    } finally {
      spawnSpy.mockRestore()
    }
  })

  it("supports silencing stdout for json mode", async () => {
    const spawnSpy = spyOn(Bun, "spawn").mockReturnValue(createProc(0))

    try {
      await executeOnCompleteHook({
        command: "echo test",
        sessionId: "session-123",
        exitCode: 0,
        durationMs: 5000,
        messageCount: 10,
        silenceStdout: true,
      })

      const [_, options] = spawnSpy.mock.calls[0] as Parameters<typeof Bun.spawn>
      expect(options?.stdout).toBe("ignore")
      expect(options?.stderr).toBe("inherit")
    } finally {
      spawnSpy.mockRestore()
    }
  })

  it("empty command string is no-op", async () => {
    const spawnSpy = spyOn(Bun, "spawn").mockReturnValue(createProc(0))

    try {
      await executeOnCompleteHook({
        command: "",
        sessionId: "session-123",
        exitCode: 0,
        durationMs: 5000,
        messageCount: 10,
      })

      expect(spawnSpy).not.toHaveBeenCalled()
    } finally {
      spawnSpy.mockRestore()
    }
  })

  it("command failure logs warning but does not throw", async () => {
    const spawnSpy = spyOn(Bun, "spawn").mockReturnValue(createProc(1))

    try {
      await expect(
        executeOnCompleteHook({
          command: "false",
          sessionId: "session-123",
          exitCode: 0,
          durationMs: 5000,
          messageCount: 10,
        })
      ).resolves.toBeUndefined()

      expect(consoleErrorSpy).toHaveBeenCalled()
    } finally {
      spawnSpy.mockRestore()
    }
  })
})
