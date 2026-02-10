import { describe, it, expect } from "bun:test"
import {
  isPortAvailable,
  findAvailablePort,
  getAvailableServerPort,
  DEFAULT_SERVER_PORT,
} from "./port-utils"

describe("port-utils", () => {
  it("returns true for an unused port", async () => {
    const port = 59999
    const result = await isPortAvailable(port)
    expect(result).toBe(true)
  })

  it("returns false for a used port", async () => {
    const port = 59998
    const blocker = Bun.serve({
      port,
      hostname: "127.0.0.1",
      fetch: () => new Response("blocked"),
    })

    try {
      const result = await isPortAvailable(port)
      expect(result).toBe(false)
    } finally {
      blocker.stop(true)
    }
  })

  it("findAvailablePort returns first available port", async () => {
    const startPort = 59997
    const result = await findAvailablePort(startPort)
    expect(result).toBe(startPort)
  })

  it("getAvailableServerPort marks auto selection when preferred port is blocked", async () => {
    const preferredPort = 59996
    const blocker = Bun.serve({
      port: preferredPort,
      hostname: "127.0.0.1",
      fetch: () => new Response("blocked"),
    })

    try {
      const result = await getAvailableServerPort(preferredPort)
      expect(result.port).toBeGreaterThan(preferredPort)
      expect(result.wasAutoSelected).toBe(true)
    } finally {
      blocker.stop(true)
    }
  })

  it("exports default server port 4096", () => {
    expect(DEFAULT_SERVER_PORT).toBe(4096)
  })
})
