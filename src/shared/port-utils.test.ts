import { describe, it, expect } from "bun:test"
import { createServer, type Server } from "node:net"
import {
  isPortAvailable,
  findAvailablePort,
  getAvailableServerPort,
  DEFAULT_SERVER_PORT,
} from "./port-utils"

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error)
        return
      }
      resolve()
    })
  })
}

async function reservePort(hostname: string = "127.0.0.1"): Promise<{ port: number; server: Server }> {
  return await new Promise((resolve, reject) => {
    const server = createServer()
    const onError = (error: Error) => {
      reject(error)
    }
    server.once("error", onError)
    server.listen(0, hostname, () => {
      const address = server.address()
      if (!address || typeof address === "string") {
        reject(new Error("Failed to reserve ephemeral port"))
        return
      }
      server.removeListener("error", onError)
      resolve({ port: address.port, server })
    })
  })
}

async function getUnusedPort(hostname: string = "127.0.0.1"): Promise<number> {
  const { port, server } = await reservePort(hostname)
  await closeServer(server)
  return port
}

describe("port-utils", () => {
  it("returns true for an unused port", async () => {
    const port = await getUnusedPort()
    const result = await isPortAvailable(port)
    expect(result).toBe(true)
  })

  it("returns false for a used port", async () => {
    const { port, server } = await reservePort()

    try {
      const result = await isPortAvailable(port)
      expect(result).toBe(false)
    } finally {
      await closeServer(server)
    }
  })

  it("findAvailablePort returns first available port", async () => {
    const startPort = await getUnusedPort()
    const result = await findAvailablePort(startPort)
    expect(result).toBe(startPort)
  })

  it("getAvailableServerPort marks auto selection when preferred port is blocked", async () => {
    const { port: preferredPort, server } = await reservePort()

    try {
      const result = await getAvailableServerPort(preferredPort)
      expect(result.port).not.toBe(preferredPort)
      expect(result.wasAutoSelected).toBe(true)
    } finally {
      await closeServer(server)
    }
  })

  it("exports default server port 4096", () => {
    expect(DEFAULT_SERVER_PORT).toBe(4096)
  })
})
