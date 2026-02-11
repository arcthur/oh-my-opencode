import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { initConfigContext, resetConfigContext } from "./config-context"
import { runBunInstallWithDetails } from "./bun-install"

function createProc(exitCode: number | null, exited: Promise<number>) {
  return {
    exited,
    exitCode,
    kill: mock(() => {}),
  } as unknown as ReturnType<typeof Bun.spawn>
}

describe("runBunInstallWithDetails", () => {
  let configDir = ""
  const originalConfigDir = process.env.OPENCODE_CONFIG_DIR

  beforeEach(() => {
    configDir = mkdtempSync(join(tmpdir(), "omo-bun-install-"))
    process.env.OPENCODE_CONFIG_DIR = configDir
    resetConfigContext()
    initConfigContext("opencode", null)
  })

  afterEach(() => {
    if (originalConfigDir === undefined) {
      delete process.env.OPENCODE_CONFIG_DIR
    } else {
      process.env.OPENCODE_CONFIG_DIR = originalConfigDir
    }
    resetConfigContext()
    rmSync(configDir, { recursive: true, force: true })
  })

  test("spawns bun install with inherited stdio", async () => {
    // #given
    const spawnSpy = spyOn(Bun, "spawn").mockReturnValue(
      createProc(0, Promise.resolve(0))
    )

    try {
      // #when
      const result = await runBunInstallWithDetails()

      // #then
      expect(result).toEqual({ success: true })
      expect(spawnSpy).toHaveBeenCalledTimes(1)
      const [, options] = spawnSpy.mock.calls[0] as Parameters<typeof Bun.spawn>
      expect(options?.stdout).toBe("inherit")
      expect(options?.stderr).toBe("inherit")
    } finally {
      spawnSpy.mockRestore()
    }
  })

  test("returns generic exit code error when bun install fails", async () => {
    // #given
    const spawnSpy = spyOn(Bun, "spawn").mockReturnValue(
      createProc(2, Promise.resolve(2))
    )

    try {
      // #when
      const result = await runBunInstallWithDetails()

      // #then
      expect(result.success).toBe(false)
      expect(result.error).toBe("bun install failed with exit code 2")
    } finally {
      spawnSpy.mockRestore()
    }
  })

  test("kills process and returns timeout result when install hangs", async () => {
    // #given
    const proc = createProc(null, new Promise<number>(() => {}))
    const spawnSpy = spyOn(Bun, "spawn").mockReturnValue(proc)
    const setTimeoutSpy = spyOn(globalThis, "setTimeout").mockImplementation(
      ((handler: TimerHandler) => {
        if (typeof handler === "function") {
          handler()
        }
        return 1 as unknown as ReturnType<typeof setTimeout>
      }) as typeof setTimeout,
    )

    try {
      // #when
      const result = await runBunInstallWithDetails()

      // #then
      expect(result.success).toBe(false)
      expect(result.timedOut).toBe(true)
      expect(proc.kill).toHaveBeenCalledTimes(1)
      expect(spawnSpy).toHaveBeenCalledTimes(1)
    } finally {
      setTimeoutSpy.mockRestore()
      spawnSpy.mockRestore()
    }
  })
})
