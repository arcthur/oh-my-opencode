const prefixFingerprintBySession = new Map<string, string>()

export function setPrefixFingerprintForSession(sessionID: string, fingerprint: string): void {
  const normalizedSessionID = sessionID.trim()
  const normalizedFingerprint = fingerprint.trim()

  if (!normalizedSessionID) {
    return
  }

  if (!normalizedFingerprint) {
    prefixFingerprintBySession.delete(normalizedSessionID)
    return
  }

  prefixFingerprintBySession.set(normalizedSessionID, normalizedFingerprint)
}

export function getPrefixFingerprintForSession(sessionID: string): string | undefined {
  return prefixFingerprintBySession.get(sessionID.trim())
}

export function clearPrefixFingerprintForSession(sessionID: string): void {
  prefixFingerprintBySession.delete(sessionID.trim())
}

export function clearAllPrefixFingerprintsForTesting(): void {
  prefixFingerprintBySession.clear()
}
