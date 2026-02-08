import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { join } from "path"
import { homedir } from "os"
import { getCommandDirectories, getSkillDirectories } from "./paths"

describe("getCommandDirectories", () => {
  const originalEnv = process.env.CLAUDE_CONFIG_DIR

  beforeEach(() => {
    delete process.env.CLAUDE_CONFIG_DIR
  })

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.CLAUDE_CONFIG_DIR = originalEnv
    } else {
      delete process.env.CLAUDE_CONFIG_DIR
    }
  })

  it("returns all four command directories", () => {
    const dirs = getCommandDirectories()

    expect(dirs.user).toContain("commands")
    expect(dirs.project).toContain(".claude")
    expect(dirs.project).toContain("commands")
    expect(dirs.opencodeGlobal).toContain(".config")
    expect(dirs.opencodeGlobal).toContain("opencode")
    expect(dirs.opencodeGlobal).toContain("command")
    expect(dirs.opencodeProject).toContain(".opencode")
    expect(dirs.opencodeProject).toContain("command")
  })

  it("project directories include cwd", () => {
    const dirs = getCommandDirectories()
    const cwd = process.cwd()

    expect(dirs.project).toContain(cwd)
    expect(dirs.opencodeProject).toContain(cwd)
  })

  it("user directory uses homedir by default", () => {
    const dirs = getCommandDirectories()
    const home = homedir()

    expect(dirs.user).toContain(home)
  })

  it("user directory respects CLAUDE_CONFIG_DIR env", () => {
    const customDir = "/custom/claude/config"
    process.env.CLAUDE_CONFIG_DIR = customDir

    const dirs = getCommandDirectories()

    expect(dirs.user).toBe(join(customDir, "commands"))
    expect(dirs.user).not.toContain(homedir())
  })

  it("opencodeGlobal always uses homedir", () => {
    process.env.CLAUDE_CONFIG_DIR = "/custom/dir"
    const dirs = getCommandDirectories()

    expect(dirs.opencodeGlobal).toContain(homedir())
  })
})

describe("getSkillDirectories", () => {
  const originalEnv = process.env.CLAUDE_CONFIG_DIR

  beforeEach(() => {
    delete process.env.CLAUDE_CONFIG_DIR
  })

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.CLAUDE_CONFIG_DIR = originalEnv
    } else {
      delete process.env.CLAUDE_CONFIG_DIR
    }
  })

  it("returns all six skill directories", () => {
    const dirs = getSkillDirectories()

    expect(dirs.user).toContain("skills")
    expect(dirs.project).toContain(".claude")
    expect(dirs.project).toContain("skills")
    expect(dirs.agentsUser).toContain(".agents")
    expect(dirs.agentsUser).toContain("skills")
    expect(dirs.agentsProject).toContain(".agents")
    expect(dirs.agentsProject).toContain("skills")
    expect(dirs.opencodeGlobal).toContain(".config")
    expect(dirs.opencodeGlobal).toContain("opencode")
    expect(dirs.opencodeGlobal).toContain("skill")
    expect(dirs.opencodeProject).toContain(".opencode")
    expect(dirs.opencodeProject).toContain("skill")
  })

  it("project directories include cwd", () => {
    const dirs = getSkillDirectories()
    const cwd = process.cwd()

    expect(dirs.project).toContain(cwd)
    expect(dirs.agentsProject).toContain(cwd)
    expect(dirs.opencodeProject).toContain(cwd)
  })

  it("user directory uses homedir by default", () => {
    const dirs = getSkillDirectories()
    const home = homedir()

    expect(dirs.user).toContain(home)
    expect(dirs.agentsUser).toContain(home)
  })

  it("user directory respects CLAUDE_CONFIG_DIR env", () => {
    const customDir = "/custom/claude/config"
    process.env.CLAUDE_CONFIG_DIR = customDir

    const dirs = getSkillDirectories()

    expect(dirs.user).toBe(join(customDir, "skills"))
    expect(dirs.user).not.toContain(homedir())
    expect(dirs.agentsUser).toBe(join(homedir(), ".agents", "skills"))
  })

  it("opencodeGlobal always uses homedir", () => {
    process.env.CLAUDE_CONFIG_DIR = "/custom/dir"
    const dirs = getSkillDirectories()

    expect(dirs.opencodeGlobal).toContain(homedir())
  })
})
