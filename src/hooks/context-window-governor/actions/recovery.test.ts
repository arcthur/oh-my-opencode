import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import { randomUUID } from "node:crypto"
import { readFileSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  MESSAGE_STORAGE,
  PART_STORAGE,
  resetOpenCodeStorageDirForTesting,
  setOpenCodeStorageDirForTesting,
} from "../../../features/hook-message-injector"
import { parseTokenLimitError, runRecoveryCompaction } from "./recovery"

describe("parseTokenLimitError", () => {
  test("parses numeric token limit from plain error string", () => {
    // #given
    const error = "prompt is too long: 250000 tokens > 200000 maximum"

    // #when
    const parsed = parseTokenLimitError(error)

    // #then
    expect(parsed).toEqual({
      currentTokens: 250000,
      maxTokens: 200000,
    })
  })

  test("parses token limit from nested responseBody payload", () => {
    // #given
    const error = {
      data: {
        responseBody: JSON.stringify({
          type: "error",
          error: {
            type: "invalid_request_error",
            message: "prompt is too long: 310000 tokens > 200000 maximum",
          },
        }),
      },
    }

    // #when
    const parsed = parseTokenLimitError(error)

    // #then
    expect(parsed).toEqual({
      currentTokens: 310000,
      maxTokens: 200000,
    })
  })

  test("parses token limit from Error instance with nested responseBody payload", () => {
    // #given
    const error = new Error("request failed")
    ;(error as unknown as { data?: { responseBody?: string } }).data = {
      responseBody: JSON.stringify({
        type: "error",
        error: {
          type: "invalid_request_error",
          message: "prompt is too long: 310000 tokens > 200000 maximum",
        },
      }),
    }

    // #when
    const parsed = parseTokenLimitError(error)

    // #then
    expect(parsed).toEqual({
      currentTokens: 310000,
      maxTokens: 200000,
    })
  })

  test("ignores thinking block structure errors", () => {
    // #given
    const error =
      "messages.31: thinking block order invalid. expected thinking, found tool_use. see docs: https://docs.anthropic.com/en/docs/build-with-claude/context-windows"

    // #when
    const parsed = parseTokenLimitError(error)

    // #then
    expect(parsed).toBeNull()
  })

  test("does not treat generic context messages as token-limit errors", () => {
    // #given
    const error = "context injection failed: missing AGENTS.md metadata"

    // #when
    const parsed = parseTokenLimitError(error)

    // #then
    expect(parsed).toBeNull()
  })

  test("treats non-empty content errors as recoverable compact errors", () => {
    // #given
    const error = "messages.31: all messages must have non-empty content"

    // #when
    const parsed = parseTokenLimitError(error)

    // #then
    expect(parsed).toEqual({
      currentTokens: 0,
      maxTokens: 0,
    })
  })
})

describe("runRecoveryCompaction", () => {
  let storageDir = ""

  beforeEach(() => {
    storageDir = join(tmpdir(), `context-governor-recovery-test-${randomUUID()}`)
    rmSync(storageDir, { recursive: true, force: true })
    setOpenCodeStorageDirForTesting(storageDir)
  })

  afterEach(() => {
    rmSync(storageDir, { recursive: true, force: true })
    resetOpenCodeStorageDirForTesting()
  })

  test("repairs non-empty content error and retries summarize once", async () => {
    // #given
    const sessionID = "session-non-empty"
    const messageID = "msg-non-empty"
    const messageDir = join(MESSAGE_STORAGE, sessionID)
    mkdirSync(messageDir, { recursive: true })
    writeFileSync(
      join(messageDir, `${messageID}.json`),
      JSON.stringify(
        {
          id: messageID,
          sessionID,
          role: "assistant",
          time: { created: 1 },
        },
        null,
        2
      )
    )

    const partDir = join(PART_STORAGE, messageID)
    mkdirSync(partDir, { recursive: true })
    const partPath = join(partDir, "prt_1.json")
    writeFileSync(
      partPath,
      JSON.stringify(
        {
          id: "prt_1",
          sessionID,
          messageID,
          type: "text",
          text: "   ",
        },
        null,
        2
      )
    )

    let summarizeCalls = 0
    const summarize = mock(async () => {
      summarizeCalls += 1
      if (summarizeCalls === 1) {
        throw new Error("messages.0: all messages must have non-empty content")
      }
      return {}
    })

    const deps = {
      directory: "/tmp/project",
      client: {
        session: {
          summarize,
        },
        tui: {
          showToast: mock(async () => ({})),
        },
      },
    } as never

    const request = {
      sessionID,
      providerID: "anthropic",
      modelID: "claude-opus-4-6",
    }

    // #when
    const success = await runRecoveryCompaction(deps, request, {}, { toast: false })

    // #then
    expect(success).toBe(true)
    expect(summarizeCalls).toBe(2)
    const repairedPart = JSON.parse(readFileSync(partPath, "utf-8")) as { text?: string }
    expect(repairedPart.text).toBe("[user interrupted]")
    const partFiles = readdirSync(partDir).filter((file) => file.endsWith(".json"))
    expect(partFiles.length).toBe(1)
  })
})
