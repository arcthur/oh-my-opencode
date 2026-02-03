import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs"
import { join } from "node:path"
import {
  setOpenCodeStorageDirForTesting,
  resetOpenCodeStorageDirForTesting,
  MESSAGE_STORAGE,
  PART_STORAGE,
} from "../../features/hook-message-injector"
import { executeDynamicContextPruning } from "./pruning-executor"

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf-8"))
}

describe("executeDynamicContextPruning (storage integration)", () => {
  const testRoot = join(process.cwd(), ".tmp", "dcp-storage-tests")
  let testStorageDir: string

  beforeEach(() => {
    const runId = `${Date.now()}-${Math.random().toString(16).slice(2)}`
    testStorageDir = join(testRoot, runId)
    mkdirSync(testStorageDir, { recursive: true })

    setOpenCodeStorageDirForTesting(testStorageDir)
    mkdirSync(MESSAGE_STORAGE, { recursive: true })
    mkdirSync(PART_STORAGE, { recursive: true })
  })

  afterEach(() => {
    resetOpenCodeStorageDirForTesting()
    rmSync(testStorageDir, { recursive: true, force: true })
  })

  test("prunes tool outputs and inputs against part storage (clear_results + supersede_writes)", async () => {
    // given: a session with message metas and part files
    const sessionID = "ses_test"
    const sessionDir = join(MESSAGE_STORAGE, sessionID)
    mkdirSync(sessionDir, { recursive: true })

    function writeMessageMeta(messageID: string, created: number): void {
      writeFileSync(
        join(sessionDir, `${messageID}.json`),
        JSON.stringify(
          {
            id: messageID,
            sessionID,
            role: "assistant",
            time: { created },
          },
          null,
          2
        )
      )
    }

    function writePart(messageID: string, part: Record<string, unknown>): void {
      const partDir = join(PART_STORAGE, messageID)
      mkdirSync(partDir, { recursive: true })
      writeFileSync(join(partDir, `${part.id as string}.json`), JSON.stringify(part, null, 2))
    }

    // Turn 1: read (should have output cleared by clear_tool_results)
    writeMessageMeta("msg_001", 1)
    writePart("msg_001", { id: "prt_001", sessionID, messageID: "msg_001", type: "step-start" })
    writePart("msg_001", {
      id: "prt_002",
      sessionID,
      messageID: "msg_001",
      type: "tool",
      callID: "c_r1",
      tool: "read",
      state: { status: "completed", input: { filePath: "a.txt" }, output: "AAA" },
    })

    // Turn 2: write (should have input cleared by supersede_writes; output preserved)
    writeMessageMeta("msg_002", 2)
    writePart("msg_002", { id: "prt_001", sessionID, messageID: "msg_002", type: "step-start" })
    writePart("msg_002", {
      id: "prt_002",
      sessionID,
      messageID: "msg_002",
      type: "tool",
      callID: "c_w1",
      tool: "write",
      state: {
        status: "completed",
        input: { filePath: "x.txt", content: "hello" },
        output: "ok",
      },
    })

    // Turn 3: read x.txt (kept; also supersedes the write)
    writeMessageMeta("msg_003", 3)
    writePart("msg_003", { id: "prt_001", sessionID, messageID: "msg_003", type: "step-start" })
    writePart("msg_003", {
      id: "prt_002",
      sessionID,
      messageID: "msg_003",
      type: "tool",
      callID: "c_r2",
      tool: "read",
      state: { status: "completed", input: { filePath: "x.txt" }, output: "contents" },
    })

    const client = {
      tui: { showToast: async () => {} },
    }

    // when: execute DCP
    await executeDynamicContextPruning(
      sessionID,
      {
        enabled: true,
        notification: "off",
        turn_protection: { enabled: false, turns: 3 },
        protected_tools: [],
        strategies: {
          deduplication: { enabled: false },
          clear_tool_results: { enabled: true, keep_recent_turns: 1 },
          supersede_writes: { enabled: true, aggressive: false },
          purge_errors: { enabled: false, turns: 5 },
        },
      },
      client
    )

    // then: old read output is pruned, input preserved
    const r1 = readJson(join(PART_STORAGE, "msg_001", "prt_002.json")) as any
    expect(r1.state.input).toEqual({ filePath: "a.txt" })
    expect(r1.state.output).toContain("Content pruned")

    // then: write input is pruned, output preserved
    const w1 = readJson(join(PART_STORAGE, "msg_002", "prt_002.json")) as any
    expect(w1.state.input).toEqual(expect.objectContaining({ __pruned: true }))
    expect(w1.state.output).toBe("ok")

    // then: recent read is preserved
    const r2 = readJson(join(PART_STORAGE, "msg_003", "prt_002.json")) as any
    expect(r2.state.output).toBe("contents")
  })
})

