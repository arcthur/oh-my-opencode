import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, rmSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import type { OhMyOpenCodeConfig } from "../../../config/schema"
import type { ProtocolMessage } from "../mailbox"
import {
  signControlMessage,
  verifyControlMessageSignature,
} from "./control-message-signature"

describe("security/control-message-signature", () => {
  let projectRoot: string
  let config: Partial<OhMyOpenCodeConfig>

  beforeEach(() => {
    projectRoot = join(
      tmpdir(),
      `swarm-signature-${Date.now()}-${Math.random().toString(16).slice(2)}`
    )
    mkdirSync(projectRoot, { recursive: true })
    config = {
      sisyphus: {
        swarm: {
          enabled: true,
          storage_path: join(projectRoot, "teams"),
          ui_mode: "toast",
        },
      },
    }
  })

  afterEach(() => {
    if (existsSync(projectRoot)) {
      rmSync(projectRoot, { recursive: true })
    }
  })

  test("signs and verifies privileged control messages", () => {
    // #given
    const payload: ProtocolMessage = {
      type: "permission_response",
      requestId: "perm_1",
      decision: "approved",
    }

    // #when
    const auth = signControlMessage({
      teamName: "team-a",
      fromAgentId: "coord-1",
      toAgentId: "worker-1",
      payload,
      epoch: 3,
      config,
    })

    // #then
    expect(auth).toBeDefined()
    const verified = verifyControlMessageSignature({
      teamName: "team-a",
      fromAgentId: "coord-1",
      toAgentId: "worker-1",
      payload,
      epoch: 3,
      auth,
      config,
    })
    expect(verified.ok).toBe(true)
  })

  test("rejects tampered envelope context even with copied signature", () => {
    // #given
    const payload: ProtocolMessage = {
      type: "mode_set_request",
      mode: "acceptEdits",
    }
    const auth = signControlMessage({
      teamName: "team-a",
      fromAgentId: "coord-1",
      toAgentId: "worker-1",
      payload,
      epoch: 10,
      config,
    })
    expect(auth).toBeDefined()

    // #when
    const wrongRecipient = verifyControlMessageSignature({
      teamName: "team-a",
      fromAgentId: "coord-1",
      toAgentId: "worker-2",
      payload,
      epoch: 10,
      auth,
      config,
    })
    const wrongPayload = verifyControlMessageSignature({
      teamName: "team-a",
      fromAgentId: "coord-1",
      toAgentId: "worker-1",
      payload: {
        type: "mode_set_request",
        mode: "bypassPermissions",
      },
      epoch: 10,
      auth,
      config,
    })

    // #then
    expect(wrongRecipient.ok).toBe(false)
    expect(wrongPayload.ok).toBe(false)
  })

  test("skips auth requirement for non-privileged messages", () => {
    // #given
    const payload: ProtocolMessage = {
      type: "task_assignment",
      taskId: "task_1",
      title: "Task",
      description: "Desc",
      assignedBy: "coord-1",
      timestamp: Date.now(),
    }

    // #when
    const auth = signControlMessage({
      teamName: "team-a",
      fromAgentId: "coord-1",
      toAgentId: "worker-1",
      payload,
      epoch: 1,
      config,
    })
    const verified = verifyControlMessageSignature({
      teamName: "team-a",
      fromAgentId: "coord-1",
      toAgentId: "worker-1",
      payload,
      epoch: 1,
      config,
    })

    // #then
    expect(auth).toBeUndefined()
    expect(verified.ok).toBe(true)
  })
})
