import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { getSystemMcpServerNames } from "../../../src/features/claude-code-mcp-loader/loader"

describe("getSystemMcpServerNames", () => {
  let testDir: string
  let fakeHomeDir: string
  let fakeClaudeConfigDir: string

  function getNames() {
    return getSystemMcpServerNames({
      cwd: testDir,
      homeDir: fakeHomeDir,
      claudeConfigDir: fakeClaudeConfigDir,
    })
  }

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), "mcp-loader-test-"))
    fakeHomeDir = join(testDir, "home")
    fakeClaudeConfigDir = join(testDir, "claude-config")
    mkdirSync(fakeHomeDir, { recursive: true })
    mkdirSync(fakeClaudeConfigDir, { recursive: true })
  })

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true })
  })

  it("returns empty set when no mcp config files exist", () => {
    // given / when
    const names = getNames()

    // then
    expect(names).toBeInstanceOf(Set)
    expect(names.size).toBe(0)
  })

  it("returns server names from project .mcp.json", () => {
    // given
    writeFileSync(
      join(testDir, ".mcp.json"),
      JSON.stringify({
        mcpServers: {
          playwright: { command: "npx", args: ["@playwright/mcp@latest"] },
          sqlite: { command: "uvx", args: ["mcp-server-sqlite"] },
        },
      })
    )

    // when
    const names = getNames()

    // then
    expect(names.has("playwright")).toBe(true)
    expect(names.has("sqlite")).toBe(true)
    expect(names.size).toBe(2)
  })

  it("returns server names from .claude/.mcp.json", () => {
    // given
    mkdirSync(join(testDir, ".claude"), { recursive: true })
    writeFileSync(
      join(testDir, ".claude", ".mcp.json"),
      JSON.stringify({
        mcpServers: {
          memory: { command: "npx", args: ["-y", "@anthropic-ai/mcp-server-memory"] },
        },
      })
    )

    // when
    const names = getNames()

    // then
    expect(names.has("memory")).toBe(true)
  })

  it("excludes disabled MCP servers", () => {
    // given
    writeFileSync(
      join(testDir, ".mcp.json"),
      JSON.stringify({
        mcpServers: {
          disabled_server: {
            command: "npx",
            args: ["some-mcp"],
            disabled: true,
          },
          active_server: {
            command: "npx",
            args: ["some-mcp"],
          },
        },
      })
    )

    // when
    const names = getNames()

    // then
    expect(names.has("disabled_server")).toBe(false)
    expect(names.has("active_server")).toBe(true)
  })

  it("merges server names from user and project config files", () => {
    // given
    mkdirSync(join(testDir, ".claude"), { recursive: true })
    writeFileSync(
      join(fakeHomeDir, ".claude.json"),
      JSON.stringify({
        mcpServers: {
          user_server: { command: "npx", args: ["user-mcp"] },
        },
      })
    )
    writeFileSync(
      join(fakeClaudeConfigDir, ".mcp.json"),
      JSON.stringify({
        mcpServers: {
          user_local_server: { command: "npx", args: ["user-local-mcp"] },
        },
      })
    )
    writeFileSync(
      join(testDir, ".mcp.json"),
      JSON.stringify({
        mcpServers: {
          project_server: { command: "npx", args: ["project-mcp"] },
        },
      })
    )
    writeFileSync(
      join(testDir, ".claude", ".mcp.json"),
      JSON.stringify({
        mcpServers: {
          local_server: { command: "npx", args: ["local-mcp"] },
        },
      })
    )

    // when
    const names = getNames()

    // then
    expect(names.has("user_server")).toBe(true)
    expect(names.has("user_local_server")).toBe(true)
    expect(names.has("project_server")).toBe(true)
    expect(names.has("local_server")).toBe(true)
    expect(names.size).toBe(4)
  })
})
