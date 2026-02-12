import { describe, expect, test } from "bun:test"
import { ExpiringRequestStore } from "./expiring-request-store"

describe("runtime/expiring-request-store", () => {
  test("expires entries after TTL and invokes callback", async () => {
    // #given
    const expired: string[] = []
    const store = new ExpiringRequestStore<{ value: number }>({
      ttlMs: 80,
      maxEntries: 10,
      onExpired: (key) => expired.push(key),
    })

    // #when
    const accepted = store.set("req_a", { value: 1 })
    expect(accepted).toBe(true)
    expect(store.get("req_a")).toEqual({ value: 1 })

    await Bun.sleep(120)
    store.sweep()

    // #then
    expect(store.get("req_a")).toBeNull()
    expect(expired).toEqual(["req_a"])
  })

  test("rejects new entries when max entries reached", () => {
    // #given
    const rejected: string[] = []
    const store = new ExpiringRequestStore<{ value: number }>({
      ttlMs: 10_000,
      maxEntries: 2,
      onRejected: (key) => rejected.push(key),
    })

    // #when
    expect(store.set("req_a", { value: 1 })).toBe(true)
    expect(store.set("req_b", { value: 2 })).toBe(true)
    expect(store.set("req_c", { value: 3 })).toBe(false)

    // #then
    expect(store.size()).toBe(2)
    expect(rejected).toEqual(["req_c"])
    expect(store.get("req_c")).toBeNull()
  })
})
