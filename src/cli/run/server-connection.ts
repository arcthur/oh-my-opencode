import { createOpencode, createOpencodeClient } from "@opencode-ai/sdk"
import pc from "picocolors"
import type { ServerConnection } from "./types"
import {
  getAvailableServerPort,
  isPortAvailable,
  DEFAULT_SERVER_PORT,
} from "../../shared/port-utils"

const WILDCARD_HOSTNAMES = new Set(["0.0.0.0", "::", "[::]"])

function resolveAttachHostname(hostname: string): string {
  return WILDCARD_HOSTNAMES.has(hostname) ? "127.0.0.1" : hostname
}

export interface ServerConnectionOptions {
  port?: number
  attach?: string
  signal: AbortSignal
  hostname?: string
}

export async function createServerConnection(
  options: ServerConnectionOptions
): Promise<ServerConnection> {
  const { port, attach, signal, hostname = "127.0.0.1" } = options

  if (attach !== undefined) {
    console.log(pc.dim("Attaching to existing server at"), pc.cyan(attach))
    const client = createOpencodeClient({ baseUrl: attach })
    return { client, cleanup: () => {} }
  }

  if (port !== undefined) {
    if (port < 1 || port > 65535) {
      throw new Error("Port must be between 1 and 65535")
    }

    const available = await isPortAvailable(port, hostname)
    if (available) {
      console.log(pc.dim("Starting server on port"), pc.cyan(port.toString()))
      const { client, server } = await createOpencode({ signal, port, hostname })
      console.log(pc.dim("Server listening at"), pc.cyan(server.url))
      return { client, cleanup: () => server.close() }
    }

    console.log(
      pc.dim("Port"),
      pc.cyan(port.toString()),
      pc.dim("is occupied, attaching to existing server")
    )
    const attachHostname = resolveAttachHostname(hostname)
    const client = createOpencodeClient({
      baseUrl: `http://${attachHostname}:${port}`,
    })
    return { client, cleanup: () => {} }
  }

  const { port: selectedPort, wasAutoSelected } = await getAvailableServerPort(
    DEFAULT_SERVER_PORT,
    hostname
  )
  if (wasAutoSelected) {
    console.log(pc.dim("Auto-selected port"), pc.cyan(selectedPort.toString()))
  } else {
    console.log(pc.dim("Starting server on port"), pc.cyan(selectedPort.toString()))
  }

  const { client, server } = await createOpencode({
    signal,
    port: selectedPort,
    hostname,
  })
  console.log(pc.dim("Server listening at"), pc.cyan(server.url))
  return { client, cleanup: () => server.close() }
}
