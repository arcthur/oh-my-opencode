import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdirSync, writeFileSync, rmSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import { discoverCommandsFromDir } from "./command-discovery"

describe("discoverCommandsFromDir", () => {
  let testDir: string

  beforeEach(() => {
    testDir = join(tmpdir(), `command-discovery-test-${Date.now()}`)
    mkdirSync(testDir, { recursive: true })
  })

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true })
  })

  it("returns empty array for non-existent directory", () => {
    const result = discoverCommandsFromDir("/non/existent/path", "user")
    expect(result).toEqual([])
  })

  it("returns empty array for empty directory", () => {
    const result = discoverCommandsFromDir(testDir, "user")
    expect(result).toEqual([])
  })

  it("discovers commands from markdown files", () => {
    const commandContent = `---
description: A test command
argument-hint: <file>
---
Command body.`
    writeFileSync(join(testDir, "test-command.md"), commandContent)

    const result = discoverCommandsFromDir(testDir, "user")

    expect(result).toHaveLength(1)
    expect(result[0].name).toBe("test-command")
    expect(result[0].metadata.description).toBe("A test command")
    expect(result[0].metadata.argumentHint).toBe("<file>")
    expect(result[0].content).toBe("Command body.")
    expect(result[0].scope).toBe("user")
  })

  it("ignores non-markdown files", () => {
    writeFileSync(join(testDir, "not-a-command.txt"), "Some text")
    writeFileSync(join(testDir, "also-not.json"), "{}")

    const result = discoverCommandsFromDir(testDir, "project")
    expect(result).toEqual([])
  })

  it("parses model field for opencode scope", () => {
    const commandContent = `---
description: A command
model: sonnet
---
Body.`
    writeFileSync(join(testDir, "cmd.md"), commandContent)

    const result = discoverCommandsFromDir(testDir, "opencode")

    expect(result[0].metadata.model).toBe("sonnet")
  })

  it("ignores model field for claude-code scope", () => {
    const commandContent = `---
description: A command
model: sonnet
---
Body.`
    writeFileSync(join(testDir, "cmd.md"), commandContent)

    const result = discoverCommandsFromDir(testDir, "user")

    expect(result[0].metadata.model).toBeUndefined()
  })

  it("discovers multiple commands", () => {
    writeFileSync(join(testDir, "cmd1.md"), "---\ndescription: First\n---\nBody 1")
    writeFileSync(join(testDir, "cmd2.md"), "---\ndescription: Second\n---\nBody 2")

    const result = discoverCommandsFromDir(testDir, "project")

    expect(result).toHaveLength(2)
    const names = result.map(r => r.name).sort()
    expect(names).toEqual(["cmd1", "cmd2"])
  })

  it("skips files that fail to parse", () => {
    writeFileSync(join(testDir, "good.md"), "---\ndescription: Good\n---\nBody")
    // Create a file that will cause read error (directory with .md extension)
    mkdirSync(join(testDir, "bad.md"))

    const result = discoverCommandsFromDir(testDir, "user")

    expect(result).toHaveLength(1)
    expect(result[0].name).toBe("good")
  })
})
