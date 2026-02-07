import type { ContextWindowSnapshot } from "../types"

interface PreemptiveDeps {
  client: {
    session: {
      summarize: (opts: {
        path: { id: string }
        body: { providerID: string; modelID: string; auto: boolean }
        query: { directory: string }
      }) => Promise<unknown>
    }
  }
  directory: string
}

export async function runPreemptiveCompaction(
  deps: PreemptiveDeps,
  snapshot: ContextWindowSnapshot
): Promise<boolean> {
  if (!snapshot.modelID) {
    return false
  }

  await deps.client.session.summarize({
    path: { id: snapshot.sessionID },
    body: {
      providerID: snapshot.providerID,
      modelID: snapshot.modelID,
      auto: true,
    },
    query: { directory: deps.directory },
  })

  return true
}
