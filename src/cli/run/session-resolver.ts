import pc from "picocolors"
import type { OpencodeClient } from "./types"
import { serializeError } from "./events"

const SESSION_CREATE_MAX_RETRIES = 3
const SESSION_CREATE_RETRY_DELAY_MS = 1000

export interface ResolveSessionOptions {
  client: OpencodeClient
  sessionId?: string
}

export async function resolveSession(
  options: ResolveSessionOptions
): Promise<string> {
  const { client, sessionId } = options

  if (sessionId) {
    const res = await client.session.get({ path: { id: sessionId } })
    if (res.error || !res.data) {
      throw new Error(`Session not found: ${sessionId}`)
    }
    return sessionId
  }

  for (let attempt = 1; attempt <= SESSION_CREATE_MAX_RETRIES; attempt++) {
    const body: { title: string } & Record<string, unknown> = {
      title: "oh-my-opencode run",
      permission: [
        { permission: "question", action: "deny", pattern: "*" },
      ],
    }
    const res = await client.session.create({ body })

    if (res.error) {
      console.error(
        pc.yellow(
          `Session create attempt ${attempt}/${SESSION_CREATE_MAX_RETRIES} failed:`
        )
      )
      console.error(pc.dim(`  Error: ${serializeError(res.error)}`))

      if (attempt < SESSION_CREATE_MAX_RETRIES) {
        const delay = SESSION_CREATE_RETRY_DELAY_MS * attempt
        console.log(pc.dim(`  Retrying in ${delay}ms...`))
        await new Promise((resolve) => setTimeout(resolve, delay))
      }
      continue
    }

    if (res.data?.id) {
      return res.data.id
    }

    console.error(
      pc.yellow(
        `Session create attempt ${attempt}/${SESSION_CREATE_MAX_RETRIES}: No session ID returned`
      )
    )

    if (attempt < SESSION_CREATE_MAX_RETRIES) {
      const delay = SESSION_CREATE_RETRY_DELAY_MS * attempt
      console.log(pc.dim(`  Retrying in ${delay}ms...`))
      await new Promise((resolve) => setTimeout(resolve, delay))
    }
  }

  throw new Error("Failed to create session after all retries")
}
