import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { DiscoveryChannel } from "./index"

describe("DiscoveryChannel", () => {
  const dirs: string[] = []

  afterEach(() => {
    for (const dir of dirs.splice(0, dirs.length)) {
      if (existsSync(dir)) {
        rmSync(dir, { recursive: true, force: true })
      }
    }
  })

  test("captures, dedupes, and renders unresolved reminders", () => {
    const workspace = mkdtempSync(join(tmpdir(), "discovery-index-"))
    dirs.push(workspace)
    let now = 1000
    const channel = new DiscoveryChannel(
      workspace,
      {
        enabled: true,
        captureDelegateOutput: true,
        captureAssistantUpdates: true,
        markerMode: "hybrid",
        dedupeWindowMs: 30_000,
        maxOpenItems: 200,
        autoTaskCreate: false,
      },
      () => now
    )

    const first = channel.capture({
      planId: "p1",
      text: "DISCOVERY: Add regression test for timeout",
      source: "delegate_output",
      sourceEventId: "call-1",
      retrievalPath: "tool.delegate_task.output",
    })
    expect(first).toHaveLength(1)

    const duplicate = channel.capture({
      planId: "p1",
      text: "DISCOVERY: add   regression   test for timeout",
      source: "assistant_update",
      sourceEventId: "msg-1",
      retrievalPath: "event.message.updated.assistant",
    })
    expect(duplicate).toHaveLength(0)

    now += 31_000
    const second = channel.capture({
      planId: "p1",
      text: "<discovery>Investigate flaky scheduler lock</discovery>",
      source: "assistant_update",
      sourceEventId: "msg-2",
      retrievalPath: "event.message.updated.assistant",
    })
    expect(second).toHaveLength(1)

    const unresolved = channel.listUnresolved("p1", 10)
    expect(unresolved).toHaveLength(2)

    const reminder = channel.renderIdleReminder("p1", 5)
    expect(reminder).toContain("Discovery Backlog")
    expect(reminder).toContain("Investigate flaky scheduler lock")
  })
})
