import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import { randomUUID } from "node:crypto"
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  MESSAGE_STORAGE,
  PART_STORAGE,
  resetOpenCodeStorageDirForTesting,
  setOpenCodeStorageDirForTesting,
} from "../../features/hook-message-injector"
import { createContextWindowGovernorHook } from "./index"

function createCtx(overrides?: {
  messages?: ReturnType<typeof mock>
  summarize?: ReturnType<typeof mock>
  showToast?: ReturnType<typeof mock>
  prompt?: ReturnType<typeof mock>
  promptAsync?: ReturnType<typeof mock>
}) {
  return {
    directory: "/tmp/project",
    client: {
      session: {
        messages:
          overrides?.messages ??
          mock(() =>
            Promise.resolve({
              data: [
                {
                  info: {
                    role: "assistant",
                    providerID: "anthropic",
                    modelID: "claude-opus-4-5",
                    tokens: {
                      input: 190000,
                      output: 1000,
                      reasoning: 0,
                      cache: { read: 0, write: 0 },
                    },
                  },
                },
              ],
            })
          ),
        summarize: overrides?.summarize ?? mock(() => Promise.resolve()),
        prompt: overrides?.prompt ?? mock(() => Promise.resolve()),
        promptAsync: overrides?.promptAsync ?? mock(() => Promise.resolve()),
      },
      tui: {
        showToast: overrides?.showToast ?? mock(() => Promise.resolve()),
      },
    },
  } as never
}

function writeToolOutput(params: {
  sessionID: string
  messageID: string
  callID: string
  tool: string
  input: Record<string, unknown>
  output: string
  createdAt: number
}): string {
  const messageDir = join(MESSAGE_STORAGE, params.sessionID)
  mkdirSync(messageDir, { recursive: true })

  const messageMeta = {
    id: params.messageID,
    sessionID: params.sessionID,
    role: "assistant",
    time: {
      created: params.createdAt,
    },
  }
  writeFileSync(join(messageDir, `${params.messageID}.json`), JSON.stringify(messageMeta, null, 2))

  const partDir = join(PART_STORAGE, params.messageID)
  mkdirSync(partDir, { recursive: true })

  const partPath = join(partDir, `prt_${params.callID}.json`)
  const toolPart = {
    id: `prt_${params.callID}`,
    sessionID: params.sessionID,
    messageID: params.messageID,
    type: "tool",
    callID: params.callID,
    tool: params.tool,
    state: {
      status: "completed",
      input: params.input,
      output: params.output,
    },
  }
  writeFileSync(partPath, JSON.stringify(toolPart, null, 2))

  return partPath
}

async function waitFor(
  predicate: () => boolean,
  opts?: { timeoutMs?: number; label?: string }
): Promise<void> {
  const timeoutMs = opts?.timeoutMs ?? 1000
  const label = opts?.label ?? "condition"
  const deadline = Date.now() + timeoutMs

  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error(`Timed out waiting for ${label}`)
    }
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

describe("context-window-governor dynamic pruning", () => {
  let storageDir = ""

  beforeEach(() => {
    storageDir = join(tmpdir(), `context-window-governor-dcp-${randomUUID()}`)
    setOpenCodeStorageDirForTesting(storageDir)
  })

  afterEach(() => {
    rmSync(storageDir, { recursive: true, force: true })
    resetOpenCodeStorageDirForTesting()
  })

  test("skips recovery summarize when pruning recovers below target ratio", async () => {
    // #given
    const sessionID = "s-dcp-skip"
    const showToast = mock(() => Promise.resolve())
    const promptAsync = mock(() => Promise.resolve())
    const firstPartPath = writeToolOutput({
      sessionID,
      messageID: "msg_001",
      callID: "call_001",
      tool: "Read",
      input: { filePath: "/tmp/project/README.md" },
      output: "A".repeat(340),
      createdAt: 100,
    })

    writeToolOutput({
      sessionID,
      messageID: "msg_002",
      callID: "call_002",
      tool: "Read",
      input: { filePath: "/tmp/project/README.md" },
      output: "B".repeat(320),
      createdAt: 200,
    })

    const summarize = mock(() => Promise.resolve())
    const hook = createContextWindowGovernorHook(createCtx({ summarize, showToast, promptAsync }), {
      recovery: {
        maxAttempts: 1,
        initialDelayMs: 0,
        maxDelayMs: 0,
        toastCooldownMs: 0,
      },
      dynamicPruning: {
        enabled: true,
        notification: "off",
        recoveryTargetRatio: 0.95,
        charsPerToken: 1,
        skipSummarizeIfRecovered: true,
        protectedTools: [],
        turnProtection: {
          enabled: false,
          turns: 1,
        },
        strategies: {
          deduplication: { enabled: true },
          staleToolOutputs: {
            enabled: false,
            keepRecentTurns: 0,
            minOutputChars: 10,
            maxOutputs: 1,
          },
        },
      },
    })

    await hook.event({
      event: {
        type: "session.error",
        properties: {
          sessionID,
          error: "prompt is too long: 1200 tokens > 1000 maximum",
        },
      },
    })

    // #when
    await hook.event({
      event: {
        type: "session.idle",
        properties: { sessionID },
      },
    })
    await waitFor(() => promptAsync.mock.calls.length === 1, {
      label: "session.promptAsync to resume",
    })

    // #then
    expect(summarize).toHaveBeenCalledTimes(0)
    expect(promptAsync).toHaveBeenCalledTimes(1)
    expect(showToast).toHaveBeenCalledTimes(0)

    const prunedPart = JSON.parse(readFileSync(firstPartPath, "utf-8")) as {
      truncated?: boolean
      state?: { output?: string }
    }
    expect(prunedPart.truncated).toBe(true)
    expect(prunedPart.state?.output).toContain("TOOL RESULT TRUNCATED")
  })

  test("shows minimal notification when dynamic pruning recovers and summarize is skipped", async () => {
    // #given
    const sessionID = "s-dcp-minimal-toast"
    const showToast = mock(() => Promise.resolve())
    writeToolOutput({
      sessionID,
      messageID: "msg_101",
      callID: "call_101",
      tool: "Read",
      input: { filePath: "/tmp/project/README.md" },
      output: "A".repeat(340),
      createdAt: 100,
    })

    writeToolOutput({
      sessionID,
      messageID: "msg_102",
      callID: "call_102",
      tool: "Read",
      input: { filePath: "/tmp/project/README.md" },
      output: "B".repeat(320),
      createdAt: 200,
    })

    const summarize = mock(() => Promise.resolve())
    const hook = createContextWindowGovernorHook(createCtx({ summarize, showToast }), {
      recovery: {
        maxAttempts: 1,
        initialDelayMs: 0,
        maxDelayMs: 0,
        toastCooldownMs: 0,
      },
      dynamicPruning: {
        enabled: true,
        notification: "minimal",
        recoveryTargetRatio: 0.95,
        charsPerToken: 1,
        skipSummarizeIfRecovered: true,
        protectedTools: [],
        turnProtection: {
          enabled: false,
          turns: 1,
        },
        strategies: {
          deduplication: { enabled: true },
          staleToolOutputs: {
            enabled: false,
            keepRecentTurns: 0,
            minOutputChars: 10,
            maxOutputs: 1,
          },
        },
      },
    })

    await hook.event({
      event: {
        type: "session.error",
        properties: {
          sessionID,
          error: "prompt is too long: 1200 tokens > 1000 maximum",
        },
      },
    })

    // #when
    await hook.event({
      event: {
        type: "session.idle",
        properties: { sessionID },
      },
    })
    await waitFor(() => showToast.mock.calls.length === 1, { label: "recovery toast" })

    // #then
    expect(summarize).toHaveBeenCalledTimes(0)
    expect(showToast).toHaveBeenCalledTimes(1)
    const toastCall = showToast.mock.calls[0]?.[0] as {
      body?: { title?: string; message?: string; variant?: string; duration?: number }
    }
    expect(toastCall.body?.title).toBe("Context Recovered")
    expect(toastCall.body?.message).toBe(
      "Dynamic pruning reclaimed context headroom; summarize skipped."
    )
    expect(toastCall.body?.variant).toBe("success")
    expect(toastCall.body?.duration).toBe(3000)
  })

  test("falls back to summarize when pruning cannot recover enough tokens", async () => {
    // #given
    const sessionID = "s-dcp-fallback"
    writeToolOutput({
      sessionID,
      messageID: "msg_010",
      callID: "call_010",
      tool: "Read",
      input: { filePath: "/tmp/project/README.md" },
      output: "tiny-output",
      createdAt: 100,
    })

    const summarize = mock(() => Promise.resolve())
    const hook = createContextWindowGovernorHook(createCtx({ summarize }), {
      recovery: {
        maxAttempts: 1,
        initialDelayMs: 0,
        maxDelayMs: 0,
        toastCooldownMs: 0,
      },
      dynamicPruning: {
        enabled: true,
        notification: "off",
        recoveryTargetRatio: 0.75,
        charsPerToken: 1,
        skipSummarizeIfRecovered: true,
        protectedTools: [],
        turnProtection: {
          enabled: false,
          turns: 1,
        },
        strategies: {
          deduplication: { enabled: true },
          staleToolOutputs: {
            enabled: false,
            keepRecentTurns: 0,
            minOutputChars: 10,
            maxOutputs: 1,
          },
        },
      },
    })

    await hook.event({
      event: {
        type: "session.error",
        properties: {
          sessionID,
          error: "prompt is too long: 1200 tokens > 1000 maximum",
        },
      },
    })

    // #when
    await hook.event({
      event: {
        type: "session.idle",
        properties: { sessionID },
      },
    })
    await waitFor(() => summarize.mock.calls.length === 1, { label: "session.summarize fallback" })

    // #then
    expect(summarize).toHaveBeenCalledTimes(1)
  })

  test("skips summarize when aggressive truncation alone recovers enough tokens", async () => {
    // #given
    const sessionID = "s-aggressive-skip"
    const showToast = mock(() => Promise.resolve())
    const promptAsync = mock(() => Promise.resolve())
    const targetPartPath = writeToolOutput({
      sessionID,
      messageID: "msg_020",
      callID: "call_020",
      tool: "Read",
      input: { filePath: "/tmp/project/big.log" },
      output: "X".repeat(650),
      createdAt: 100,
    })

    const summarize = mock(() => Promise.resolve())
    const hook = createContextWindowGovernorHook(
      createCtx({ summarize, showToast, promptAsync }),
      {
      recovery: {
        maxAttempts: 1,
        initialDelayMs: 0,
        maxDelayMs: 0,
        toastCooldownMs: 0,
        aggressiveOutputTruncation: {
          enabled: true,
          targetRatio: 0.8,
          charsPerToken: 1,
          maxOutputs: 10,
          minOutputChars: 10,
          keepRecentTurns: 0,
          protectedTools: [],
        },
      },
      dynamicPruning: {
        enabled: false,
        notification: "detailed",
        recoveryTargetRatio: 0.9,
        charsPerToken: 4,
        skipSummarizeIfRecovered: true,
        protectedTools: [],
        turnProtection: {
          enabled: false,
          turns: 1,
        },
        strategies: {
          deduplication: { enabled: false },
          staleToolOutputs: {
            enabled: false,
            keepRecentTurns: 0,
            minOutputChars: 10,
            maxOutputs: 1,
          },
        },
      },
      }
    )

    await hook.event({
      event: {
        type: "session.error",
        properties: {
          sessionID,
          error: "prompt is too long: 1200 tokens > 1000 maximum",
        },
      },
    })

    // #when
    await hook.event({
      event: {
        type: "session.idle",
        properties: { sessionID },
      },
    })
    await waitFor(() => promptAsync.mock.calls.length === 1, {
      label: "session.promptAsync to resume",
    })
    await waitFor(() => showToast.mock.calls.length === 1, { label: "recovery toast" })

    // #then
    expect(summarize).toHaveBeenCalledTimes(0)
    expect(promptAsync).toHaveBeenCalledTimes(1)
    expect(showToast).toHaveBeenCalledTimes(1)
    const toastCall = showToast.mock.calls[0]?.[0] as {
      body?: { title?: string; message?: string; variant?: string }
    }
    expect(toastCall.body?.title).toBe("Context Recovered")
    expect(toastCall.body?.message).toContain("Aggressive output truncation removed 1 outputs")
    expect(toastCall.body?.message).toContain("summarize skipped")
    expect(toastCall.body?.variant).toBe("success")
    const truncatedPart = JSON.parse(readFileSync(targetPartPath, "utf-8")) as {
      truncated?: boolean
    }
    expect(truncatedPart.truncated).toBe(true)
  })

  test("skips summarize when dynamic pruning plus aggressive truncation recover enough together", async () => {
    // #given
    const sessionID = "s-dcp-aggressive-combined-skip"
    const showToast = mock(() => Promise.resolve())
    const promptAsync = mock(() => Promise.resolve())

    const dedupPartPath = writeToolOutput({
      sessionID,
      messageID: "msg_021",
      callID: "call_021",
      tool: "Read",
      input: { filePath: "/tmp/project/README.md" },
      output: "A".repeat(200),
      createdAt: 100,
    })
    writeToolOutput({
      sessionID,
      messageID: "msg_022",
      callID: "call_022",
      tool: "Read",
      input: { filePath: "/tmp/project/README.md" },
      output: "B".repeat(200),
      createdAt: 200,
    })
    const aggressivePartPath = writeToolOutput({
      sessionID,
      messageID: "msg_023",
      callID: "call_023",
      tool: "Read",
      input: { filePath: "/tmp/project/build.log" },
      output: "C".repeat(250),
      createdAt: 300,
    })

    const summarize = mock(() => Promise.resolve())
    const hook = createContextWindowGovernorHook(
      createCtx({ summarize, showToast, promptAsync }),
      {
      recovery: {
        maxAttempts: 1,
        initialDelayMs: 0,
        maxDelayMs: 0,
        toastCooldownMs: 0,
        aggressiveOutputTruncation: {
          enabled: true,
          targetRatio: 0.8,
          charsPerToken: 1,
          maxOutputs: 1,
          minOutputChars: 10,
          keepRecentTurns: 0,
          protectedTools: [],
        },
      },
      dynamicPruning: {
        enabled: true,
        notification: "off",
        recoveryTargetRatio: 0.8,
        charsPerToken: 1,
        skipSummarizeIfRecovered: true,
        protectedTools: [],
        turnProtection: {
          enabled: false,
          turns: 1,
        },
        strategies: {
          deduplication: { enabled: true },
          staleToolOutputs: {
            enabled: false,
            keepRecentTurns: 0,
            minOutputChars: 10,
            maxOutputs: 1,
          },
        },
      },
      }
    )

    await hook.event({
      event: {
        type: "session.error",
        properties: {
          sessionID,
          error: "prompt is too long: 1200 tokens > 1000 maximum",
        },
      },
    })

    // #when
    await hook.event({
      event: {
        type: "session.idle",
        properties: { sessionID },
      },
    })
    await waitFor(() => promptAsync.mock.calls.length === 1, {
      label: "session.promptAsync to resume",
    })

    // #then
    expect(summarize).toHaveBeenCalledTimes(0)
    expect(promptAsync).toHaveBeenCalledTimes(1)
    expect(showToast).toHaveBeenCalledTimes(0)

    const dedupPart = JSON.parse(readFileSync(dedupPartPath, "utf-8")) as {
      truncated?: boolean
    }
    const aggressivePart = JSON.parse(readFileSync(aggressivePartPath, "utf-8")) as {
      truncated?: boolean
    }

    expect(dedupPart.truncated).toBe(true)
    expect(aggressivePart.truncated).toBe(true)
  })

  test("falls back to summarize when aggressive truncation is insufficient", async () => {
    // #given
    const sessionID = "s-aggressive-fallback"
    const targetPartPath = writeToolOutput({
      sessionID,
      messageID: "msg_030",
      callID: "call_030",
      tool: "Read",
      input: { filePath: "/tmp/project/small.log" },
      output: "small-output",
      createdAt: 100,
    })

    const summarize = mock(() => Promise.resolve())
    const hook = createContextWindowGovernorHook(createCtx({ summarize }), {
      recovery: {
        maxAttempts: 1,
        initialDelayMs: 0,
        maxDelayMs: 0,
        toastCooldownMs: 0,
        aggressiveOutputTruncation: {
          enabled: true,
          targetRatio: 0.8,
          charsPerToken: 1,
          maxOutputs: 10,
          minOutputChars: 1,
          keepRecentTurns: 0,
          protectedTools: [],
        },
      },
      dynamicPruning: {
        enabled: false,
        notification: "off",
        recoveryTargetRatio: 0.9,
        charsPerToken: 4,
        skipSummarizeIfRecovered: true,
        protectedTools: [],
        turnProtection: {
          enabled: false,
          turns: 1,
        },
        strategies: {
          deduplication: { enabled: false },
          staleToolOutputs: {
            enabled: false,
            keepRecentTurns: 0,
            minOutputChars: 10,
            maxOutputs: 1,
          },
        },
      },
    })

    await hook.event({
      event: {
        type: "session.error",
        properties: {
          sessionID,
          error: "prompt is too long: 1200 tokens > 1000 maximum",
        },
      },
    })

    // #when
    await hook.event({
      event: {
        type: "session.idle",
        properties: { sessionID },
      },
    })
    await waitFor(() => summarize.mock.calls.length === 1, { label: "session.summarize fallback" })

    // #then
    expect(summarize).toHaveBeenCalledTimes(1)
    const truncatedPart = JSON.parse(readFileSync(targetPartPath, "utf-8")) as {
      truncated?: boolean
    }
    expect(truncatedPart.truncated).toBe(true)
  })

  test("retries aggressive truncation across recovery attempts and skips summarize once cumulative trim is enough", async () => {
    // #given
    const sessionID = "s-aggressive-retry-cumulative"
    const firstPartPath = writeToolOutput({
      sessionID,
      messageID: "msg_040",
      callID: "call_040",
      tool: "Read",
      input: { filePath: "/tmp/project/big-1.log" },
      output: "A".repeat(350),
      createdAt: 100,
    })
    const secondPartPath = writeToolOutput({
      sessionID,
      messageID: "msg_041",
      callID: "call_041",
      tool: "Read",
      input: { filePath: "/tmp/project/big-2.log" },
      output: "B".repeat(350),
      createdAt: 200,
    })

    const showToast = mock(() => Promise.resolve())
    const promptAsync = mock(() => Promise.resolve())
    let summarizeCalls = 0
    const summarize = mock(async () => {
      summarizeCalls += 1
      if (summarizeCalls === 1) {
        throw new Error("simulated summarize failure")
      }
      return Promise.resolve()
    })

    const hook = createContextWindowGovernorHook(
      createCtx({ summarize, showToast, promptAsync }),
      {
      recovery: {
        maxAttempts: 2,
        initialDelayMs: 0,
        maxDelayMs: 0,
        toastCooldownMs: 0,
        aggressiveOutputTruncation: {
          enabled: true,
          targetRatio: 0.7,
          charsPerToken: 1,
          maxOutputs: 1,
          minOutputChars: 10,
          keepRecentTurns: 0,
          protectedTools: [],
        },
      },
      dynamicPruning: {
        enabled: false,
        notification: "off",
        recoveryTargetRatio: 0.9,
        charsPerToken: 4,
        skipSummarizeIfRecovered: true,
        protectedTools: [],
        turnProtection: {
          enabled: false,
          turns: 1,
        },
        strategies: {
          deduplication: { enabled: false },
          staleToolOutputs: {
            enabled: false,
            keepRecentTurns: 0,
            minOutputChars: 10,
            maxOutputs: 1,
          },
        },
      },
      }
    )

    await hook.event({
      event: {
        type: "session.error",
        properties: {
          sessionID,
          error: "prompt is too long: 1200 tokens > 1000 maximum",
        },
      },
    })

    // #when
    await hook.event({
      event: {
        type: "session.idle",
        properties: { sessionID },
      },
    })
    await waitFor(() => promptAsync.mock.calls.length === 1, {
      label: "session.promptAsync to resume",
    })

    // #then
    expect(summarize).toHaveBeenCalledTimes(1)
    expect(promptAsync).toHaveBeenCalledTimes(1)
    expect(showToast).toHaveBeenCalledTimes(1)

    const firstPart = JSON.parse(readFileSync(firstPartPath, "utf-8")) as { truncated?: boolean }
    const secondPart = JSON.parse(readFileSync(secondPartPath, "utf-8")) as { truncated?: boolean }
    expect(firstPart.truncated).toBe(true)
    expect(secondPart.truncated).toBe(true)
  })

  test("applies dynamic pruning immediately when token-limit errors arrive during in-flight recovery", async () => {
    // #given
    const sessionID = "s-dcp-inflight"
    writeToolOutput({
      sessionID,
      messageID: "msg_050",
      callID: "call_050",
      tool: "Read",
      input: { filePath: "/tmp/project/old.log" },
      output: "A".repeat(240),
      createdAt: 100,
    })

    let releaseSummarize: (() => void) | null = null
    let summarizeCalls = 0
    const summarize = mock(async () => {
      summarizeCalls += 1
      return await new Promise<void>((resolve) => {
        releaseSummarize = resolve
      })
    })

    const hook = createContextWindowGovernorHook(createCtx({ summarize }), {
      recovery: {
        maxAttempts: 1,
        initialDelayMs: 0,
        maxDelayMs: 0,
        toastCooldownMs: 0,
      },
      dynamicPruning: {
        enabled: true,
        notification: "off",
        recoveryTargetRatio: 0.9,
        charsPerToken: 4,
        skipSummarizeIfRecovered: false,
        protectedTools: [],
        turnProtection: {
          enabled: false,
          turns: 1,
        },
        strategies: {
          deduplication: { enabled: false },
          staleToolOutputs: {
            enabled: true,
            keepRecentTurns: 0,
            minOutputChars: 10,
            maxOutputs: 1,
          },
        },
      },
    })

    await hook.event({
      event: {
        type: "session.error",
        properties: {
          sessionID,
          error: "prompt is too long: 1200 tokens > 1000 maximum",
        },
      },
    })

    const idlePromise = hook.event({
      event: {
        type: "session.idle",
        properties: { sessionID },
      },
    })

    const startDeadline = Date.now() + 1000
    while (summarizeCalls !== 1) {
      if (Date.now() > startDeadline) {
        throw new Error("Recovery summarize did not start within 1s.")
      }
      await new Promise((resolve) => setTimeout(resolve, 0))
    }

    const inFlightPartPath = writeToolOutput({
      sessionID,
      messageID: "msg_051",
      callID: "call_051",
      tool: "Read",
      input: { filePath: "/tmp/project/new.log" },
      output: "B".repeat(260),
      createdAt: 200,
    })

    // #when
    await hook.event({
      event: {
        type: "session.error",
        properties: {
          sessionID,
          error: "prompt is too long: 1400 tokens > 1000 maximum",
        },
      },
    })

    // #then
    const inFlightPart = JSON.parse(readFileSync(inFlightPartPath, "utf-8")) as {
      truncated?: boolean
      state?: { output?: string }
    }
    expect(inFlightPart.truncated).toBe(true)
    expect(inFlightPart.state?.output).toContain("TOOL RESULT TRUNCATED")

    releaseSummarize?.()
    await idlePromise
  })
})
