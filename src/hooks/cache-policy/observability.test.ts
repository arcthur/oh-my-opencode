import { beforeEach, describe, expect, mock, test } from "bun:test"

const logMock = mock(() => undefined)

mock.module("../../shared/logger", () => ({
  log: logMock,
}))

describe("cache-policy observability logging", () => {
  beforeEach(() => {
    logMock.mockClear()
  })

  const createInput = (providerID: string) => ({
    sessionID: "session-cache-policy-observe",
    agent: { name: "sisyphus" },
    model: { providerID, modelID: "test-model" },
    provider: { id: providerID },
    message: { variant: "max" },
  })

  test("does not emit log when emit_log is false", async () => {
    // #given
    const { createCachePolicyHook } = await import("./index")
    const hook = createCachePolicyHook({
      observability: {
        enabled: true,
        emit_log: false,
      },
      provider_policy: {
        mode: "observe",
      },
    })

    // #when
    await hook["chat.params"](createInput("openai"), { options: {} })

    // #then
    expect(logMock).toHaveBeenCalledTimes(0)
  })

  test("emits log by default when observability is enabled", async () => {
    // #given
    const { createCachePolicyHook } = await import("./index")
    const hook = createCachePolicyHook({
      observability: {
        enabled: true,
      },
      provider_policy: {
        mode: "observe",
      },
    })

    // #when
    await hook["chat.params"](createInput("openai"), { options: {} })

    // #then
    expect(logMock).toHaveBeenCalledTimes(1)
  })
})
