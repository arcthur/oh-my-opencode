interface WaitForOptions {
  timeoutMs?: number
  intervalMs?: number
  description?: string
}

export async function waitFor(
  assertion: () => void | Promise<void>,
  options: WaitForOptions = {}
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? 2_000
  const intervalMs = options.intervalMs ?? 25
  const description = options.description ?? "condition"
  const deadline = Date.now() + timeoutMs

  let lastError: unknown
  while (Date.now() < deadline) {
    try {
      await assertion()
      return
    } catch (error) {
      lastError = error
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }

  const suffix = lastError instanceof Error ? `: ${lastError.message}` : ""
  throw new Error(`Timed out waiting for ${description}${suffix}`)
}
