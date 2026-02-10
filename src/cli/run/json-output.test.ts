import { describe, it, expect, beforeEach } from "bun:test"
import type { RunResult } from "./types"
import { createJsonOutputManager } from "./json-output"

interface MockWriteStream {
  write: (chunk: string) => boolean
  writes: string[]
}

function createMockWriteStream(): MockWriteStream {
  const stream: MockWriteStream = {
    writes: [],
    write: function (this: MockWriteStream, chunk: string): boolean {
      this.writes.push(chunk)
      return true
    },
  }
  return stream
}

describe("createJsonOutputManager", () => {
  let mockStdout: MockWriteStream
  let mockStderr: MockWriteStream

  beforeEach(() => {
    mockStdout = createMockWriteStream()
    mockStderr = createMockWriteStream()
  })

  it("causes stdout writes to go to stderr", () => {
    const manager = createJsonOutputManager({
      stdout: mockStdout as unknown as NodeJS.WriteStream,
      stderr: mockStderr as unknown as NodeJS.WriteStream,
    })
    manager.redirectToStderr()

    mockStdout.write("test message")

    expect(mockStdout.writes).toHaveLength(0)
    expect(mockStderr.writes).toEqual(["test message"])
  })

  it("restores stdout write after restore", () => {
    const manager = createJsonOutputManager({
      stdout: mockStdout as unknown as NodeJS.WriteStream,
      stderr: mockStderr as unknown as NodeJS.WriteStream,
    })
    manager.redirectToStderr()

    manager.restore()
    mockStdout.write("restored message")

    expect(mockStdout.writes).toEqual(["restored message"])
    expect(mockStderr.writes).toHaveLength(0)
  })

  it("writes valid JSON to stdout", () => {
    const result: RunResult = {
      sessionId: "test-session",
      success: true,
      durationMs: 1234,
      messageCount: 42,
      summary: "Test summary",
    }
    const manager = createJsonOutputManager({
      stdout: mockStdout as unknown as NodeJS.WriteStream,
      stderr: mockStderr as unknown as NodeJS.WriteStream,
    })

    manager.emitResult(result)

    expect(mockStdout.writes).toHaveLength(1)
    const emitted = mockStdout.writes[0]!
    expect(() => JSON.parse(emitted)).not.toThrow()
  })

  it("restores stdout when emitting with active redirect", () => {
    const result: RunResult = {
      sessionId: "test-session",
      success: true,
      durationMs: 100,
      messageCount: 1,
      summary: "Test",
    }
    const manager = createJsonOutputManager({
      stdout: mockStdout as unknown as NodeJS.WriteStream,
      stderr: mockStderr as unknown as NodeJS.WriteStream,
    })
    manager.redirectToStderr()

    manager.emitResult(result)

    expect(mockStdout.writes).toHaveLength(1)
    expect(mockStdout.writes[0]!).toBe(JSON.stringify(result) + "\n")

    mockStdout.write("after emit")
    expect(mockStdout.writes).toHaveLength(2)
    expect(mockStderr.writes).toHaveLength(0)
  })
})
