import type { CompactionLeaseOwner } from "./types"

interface CompactionLeaseManager {
  tryAcquire: (sessionID: string, owner: CompactionLeaseOwner) => boolean
  release: (sessionID: string, owner: CompactionLeaseOwner) => boolean
  clear: (sessionID: string) => void
  getOwner: (sessionID: string) => CompactionLeaseOwner | undefined
}

export function createCompactionLeaseManager(): CompactionLeaseManager {
  const ownerBySession = new Map<string, CompactionLeaseOwner>()

  return {
    tryAcquire(sessionID, owner) {
      const existing = ownerBySession.get(sessionID)
      if (existing) {
        return false
      }
      ownerBySession.set(sessionID, owner)
      return true
    },

    release(sessionID, owner) {
      const existing = ownerBySession.get(sessionID)
      if (!existing || existing !== owner) {
        return false
      }
      ownerBySession.delete(sessionID)
      return true
    },

    clear(sessionID) {
      ownerBySession.delete(sessionID)
    },

    getOwner(sessionID) {
      return ownerBySession.get(sessionID)
    },
  }
}
