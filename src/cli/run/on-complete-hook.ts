import pc from "picocolors"

export interface OnCompleteHookOptions {
  command: string
  sessionId: string
  exitCode: number
  durationMs: number
  messageCount: number
  silenceStdout?: boolean
}

export async function executeOnCompleteHook(
  options: OnCompleteHookOptions
): Promise<void> {
  const {
    command,
    sessionId,
    exitCode,
    durationMs,
    messageCount,
    silenceStdout = false,
  } = options

  const trimmedCommand = command.trim()
  if (!trimmedCommand) {
    return
  }

  console.error(pc.dim(`Running on-complete hook: ${trimmedCommand}`))

  try {
    const proc = Bun.spawn(["sh", "-c", trimmedCommand], {
      env: {
        ...process.env,
        SESSION_ID: sessionId,
        EXIT_CODE: String(exitCode),
        DURATION_MS: String(durationMs),
        MESSAGE_COUNT: String(messageCount),
      },
      stdout: silenceStdout ? "ignore" : "inherit",
      stderr: "inherit",
    })

    const hookExitCode = await proc.exited
    if (hookExitCode !== 0) {
      console.error(
        pc.yellow(`Warning: on-complete hook exited with code ${hookExitCode}`)
      )
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(
      pc.yellow(`Warning: Failed to execute on-complete hook: ${message}`)
    )
  }
}
