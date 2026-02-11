import { describe, expect, test } from "bun:test"
import {
  EXECUTION_POLICY_VERSION,
  EXECUTION_PROMPT_REQUIRED_SECTION_NAMES,
  getExecutionPolicy,
} from "./policy"

describe("execution policy", () => {
  test("exposes a stable execution policy contract", () => {
    // #given
    const policy = getExecutionPolicy()

    // #when / #then
    expect(EXECUTION_POLICY_VERSION).toBe(1)
    expect(policy.owner).toBe("atlas")
    expect(policy.delegatePrompt.minNonEmptyLines).toBe(12)
    expect(policy.retry.maxRetriesPerTask).toBe(2)
    expect(policy.continuation.maxPromptFailures).toBe(2)
    expect(policy.commit.autoCommitEnabled).toBe(false)
  })

  test("requires the six canonical delegation sections", () => {
    // #given / #when / #then
    expect(EXECUTION_PROMPT_REQUIRED_SECTION_NAMES).toEqual([
      "TASK",
      "EXPECTED OUTCOME",
      "REQUIRED TOOLS",
      "MUST DO",
      "MUST NOT DO",
      "CONTEXT",
    ])
  })
})
