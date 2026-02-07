import { describe, expect, test } from "bun:test"
import { createCompactionLeaseManager } from "./lease-manager"

describe("compaction lease manager", () => {
  test("enforces single owner per session", () => {
    // #given
    const lease = createCompactionLeaseManager()

    // #when
    const acquiredPreemptive = lease.tryAcquire("s1", "preemptive")
    const acquiredRecoveryWhileHeld = lease.tryAcquire("s1", "recovery")
    const releaseWrongOwner = lease.release("s1", "recovery")
    const releaseCorrectOwner = lease.release("s1", "preemptive")
    const acquiredRecoveryAfterRelease = lease.tryAcquire("s1", "recovery")

    // #then
    expect(acquiredPreemptive).toBe(true)
    expect(acquiredRecoveryWhileHeld).toBe(false)
    expect(releaseWrongOwner).toBe(false)
    expect(releaseCorrectOwner).toBe(true)
    expect(acquiredRecoveryAfterRelease).toBe(true)
  })
})
