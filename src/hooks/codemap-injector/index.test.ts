import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import type { PluginInput } from "@opencode-ai/plugin"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { contextBudgetArbiter } from "../../features/context-view"
import { createCodemapInjectorHook } from "./index"

function createTempProject(): string {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "omo-codemap-injector-"))
  const srcDir = path.join(projectRoot, "src")

  fs.mkdirSync(srcDir, { recursive: true })
  fs.writeFileSync(path.join(srcDir, "index.ts"), "export const value = 1\n", "utf8")
  fs.writeFileSync(
    path.join(srcDir, "codemap.md"),
    [
      "# CODEMAP: src",
      "> Generated: 2026-02-01T00:00:00.000Z",
      "",
      "## RESPONSIBILITY",
      "",
      "Owns source module bootstrap responsibilities.",
      "",
      "## DESIGN",
      "",
      "- Functional core.",
      "",
    ].join("\n"),
    "utf8"
  )
  fs.writeFileSync(
    path.join(projectRoot, "project-map.md"),
    ["src/", "  index.ts", "docs/", "  index.md", ""].join("\n"),
    "utf8"
  )

  return projectRoot
}

function createMockCtx(directory: string): PluginInput {
  return { directory } as unknown as PluginInput
}

function createReadInput(sessionID = "session-1", callID = "call-1") {
  return { tool: "Read", sessionID, callID }
}

function createReadOutput(filePath = "src/index.ts") {
  return { title: filePath, output: "file-content", metadata: {} }
}

describe("createCodemapInjectorHook", () => {
  let projectRoot: string

  beforeEach(() => {
    contextBudgetArbiter.resetForTesting()
    projectRoot = createTempProject()
  })

  afterEach(() => {
    if (projectRoot && fs.existsSync(projectRoot)) {
      fs.rmSync(projectRoot, { recursive: true, force: true })
    }
  })

  test("does not inject root project map when inject_root_project_map is disabled", async () => {
    // #given
    const hook = createCodemapInjectorHook(createMockCtx(projectRoot), {
      enabled: true,
      inject_root_project_map: false,
      suggest_cartography: false,
    })
    await hook["user.prompt.submit"]({
      sessionID: "session-1",
      message: { content: "Please explain architecture flow" },
    } as never)
    const output = createReadOutput()

    // #when
    await hook["tool.execute.after"](createReadInput(), output as never)

    // #then
    expect(output.output).not.toContain("[Project Map]")
    expect(output.output).toContain("[Codemap Context: src]")
  })

  test("injects root project map once when enabled and architecture prompt is detected", async () => {
    // #given
    const hook = createCodemapInjectorHook(createMockCtx(projectRoot), {
      enabled: true,
      inject_root_project_map: true,
      suggest_cartography: false,
    })
    await hook["user.prompt.submit"]({
      sessionID: "session-1",
      message: { content: "Can you explain the architecture?" },
    } as never)
    const firstOutput = createReadOutput()
    const secondOutput = createReadOutput()

    // #when
    await hook["tool.execute.after"](createReadInput("session-1", "call-1"), firstOutput as never)
    await hook["tool.execute.after"](createReadInput("session-1", "call-2"), secondOutput as never)

    // #then
    expect(firstOutput.output).toContain("[Project Map]")
    expect(secondOutput.output).not.toContain("[Project Map]")
  })

  test("resets session state on session.deleted and allows project map injection again", async () => {
    // #given
    const hook = createCodemapInjectorHook(createMockCtx(projectRoot), {
      enabled: true,
      inject_root_project_map: true,
      suggest_cartography: false,
    })

    await hook["user.prompt.submit"]({
      sessionID: "session-1",
      message: { content: "architecture overview" },
    } as never)
    const firstOutput = createReadOutput()
    await hook["tool.execute.after"](createReadInput("session-1", "call-1"), firstOutput as never)

    await hook.event?.({
      event: {
        type: "session.deleted",
        properties: { info: { id: "session-1" } },
      },
    } as never)

    await hook["user.prompt.submit"]({
      sessionID: "session-1",
      message: { content: "architecture overview again" },
    } as never)
    const secondOutput = createReadOutput()

    // #when
    await hook["tool.execute.after"](createReadInput("session-1", "call-2"), secondOutput as never)

    // #then
    expect(firstOutput.output).toContain("[Project Map]")
    expect(secondOutput.output).toContain("[Project Map]")
  })
})
