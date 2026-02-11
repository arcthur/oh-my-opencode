import type { ExecutionOwner } from "./owner"
import { EXECUTION_OWNER } from "./owner"

export const EXECUTION_POLICY_VERSION = 1

export const EXECUTION_PROMPT_REQUIRED_SECTION_NAMES = [
  "TASK",
  "EXPECTED OUTCOME",
  "REQUIRED TOOLS",
  "MUST DO",
  "MUST NOT DO",
  "CONTEXT",
] as const

export type ExecutionPromptSectionName = (typeof EXECUTION_PROMPT_REQUIRED_SECTION_NAMES)[number]

export type ExecutionPromptSection = {
  name: ExecutionPromptSectionName
  pattern: RegExp
}

export interface ExecutionPolicy {
  version: number
  owner: ExecutionOwner
  delegatePrompt: {
    minNonEmptyLines: number
    requiredSections: readonly ExecutionPromptSection[]
  }
  retry: {
    maxRetriesPerTask: number
  }
  continuation: {
    maxPromptFailures: number
  }
  commit: {
    autoCommitEnabled: boolean
  }
}

const EXECUTION_REQUIRED_SECTIONS: readonly ExecutionPromptSection[] = [
  { name: "TASK", pattern: /^(?:\s{0,3}#{1,6}\s*)?(?:\d+\.\s*)?TASK\b/im },
  { name: "EXPECTED OUTCOME", pattern: /^(?:\s{0,3}#{1,6}\s*)?(?:\d+\.\s*)?EXPECTED OUTCOME\b/im },
  { name: "REQUIRED TOOLS", pattern: /^(?:\s{0,3}#{1,6}\s*)?(?:\d+\.\s*)?REQUIRED TOOLS\b/im },
  { name: "MUST DO", pattern: /^(?:\s{0,3}#{1,6}\s*)?(?:\d+\.\s*)?MUST DO\b/im },
  { name: "MUST NOT DO", pattern: /^(?:\s{0,3}#{1,6}\s*)?(?:\d+\.\s*)?MUST NOT DO\b/im },
  { name: "CONTEXT", pattern: /^(?:\s{0,3}#{1,6}\s*)?(?:\d+\.\s*)?CONTEXT\b/im },
]

const EXECUTION_POLICY: ExecutionPolicy = {
  version: EXECUTION_POLICY_VERSION,
  owner: EXECUTION_OWNER,
  delegatePrompt: {
    minNonEmptyLines: 12,
    requiredSections: EXECUTION_REQUIRED_SECTIONS,
  },
  retry: {
    maxRetriesPerTask: 2,
  },
  continuation: {
    maxPromptFailures: 2,
  },
  commit: {
    autoCommitEnabled: false,
  },
}

export function getExecutionPolicy(): ExecutionPolicy {
  return EXECUTION_POLICY
}
