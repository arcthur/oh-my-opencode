import { describe, expect, test } from "bun:test"
import { HookServiceContainer } from "./service-container"

describe("HookServiceContainer", () => {
  test("resolves providers lazily and memoizes", async () => {
    const container = new HookServiceContainer()
    let count = 0

    container.registerProvider("value", async () => {
      count++
      return { ok: true }
    })

    const a = await container.resolve<{ ok: boolean }>("value")
    const b = await container.resolve<{ ok: boolean }>("value")

    expect(a).toBe(b)
    expect(count).toBe(1)
  })

  test("detects cyclic dependency", async () => {
    const container = new HookServiceContainer()

    container.registerProvider("a", async (c) => c.resolve("b"))
    container.registerProvider("b", async (c) => c.resolve("a"))

    await expect(container.resolve("a")).rejects.toThrow("Cyclic service dependency")
  })

  test("supports direct value registration", async () => {
    const container = new HookServiceContainer()
    container.registerValue("x", 42)

    await expect(container.resolve<number>("x")).resolves.toBe(42)
  })
})
