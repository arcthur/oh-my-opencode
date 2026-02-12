import { afterEach, describe, expect, test } from "bun:test"
import {
  clearAllPrefixFingerprintsForTesting,
  setPrefixFingerprintForSession,
} from "../../../features/context-injector/prefix-fingerprint"
import { resolvePrefixFingerprint } from "./tool-execute-after"

describe("resolvePrefixFingerprint", () => {
  afterEach(() => {
    clearAllPrefixFingerprintsForTesting()
  })

  test("uses metadata prefix fingerprint when present", () => {
    // #given
    setPrefixFingerprintForSession("session-1", "fp_from_session")

    // #when
    const value = resolvePrefixFingerprint(
      { prefixFingerprint: "fp_from_metadata" },
      "session-1"
    )

    // #then
    expect(value).toBe("fp_from_metadata")
  })

  test("falls back to session prefix fingerprint when metadata is missing", () => {
    // #given
    setPrefixFingerprintForSession("session-2", "fp_from_session")

    // #when
    const value = resolvePrefixFingerprint({}, "session-2")

    // #then
    expect(value).toBe("fp_from_session")
  })
})
