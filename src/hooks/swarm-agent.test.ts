import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import type { PluginInput } from "@opencode-ai/plugin"
import { createSwarmRuntimeService } from "../features/orchestrator-swarm/runtime"
import { createSwarmAgentHook } from "./swarm-agent"

const mockCreateWorker = mock(async () => null)
const mockCreateCoordinator = mock(async () => null)

mock.module("../features/orchestrator-swarm/agent", () => ({
  WorkerAgent: class {},
  CoordinatorAgent: class {},
  createWorker: mockCreateWorker,
  createCoordinator: mockCreateCoordinator,
}))

describe("swarm-agent hook runtime lifecycle", () => {
  let previousTeam: string | undefined
  let previousName: string | undefined
  let previousRole: string | undefined

  beforeEach(() => {
    previousTeam = process.env.OPENCODE_SWARM_TEAM
    previousName = process.env.OPENCODE_SWARM_NAME
    previousRole = process.env.OPENCODE_SWARM_ROLE

    mockCreateWorker.mockReset()
    mockCreateCoordinator.mockReset()
  })

  afterEach(() => {
    if (previousTeam === undefined) delete process.env.OPENCODE_SWARM_TEAM
    else process.env.OPENCODE_SWARM_TEAM = previousTeam

    if (previousName === undefined) delete process.env.OPENCODE_SWARM_NAME
    else process.env.OPENCODE_SWARM_NAME = previousName

    if (previousRole === undefined) delete process.env.OPENCODE_SWARM_ROLE
    else process.env.OPENCODE_SWARM_ROLE = previousRole
  })

  function createCtx(): PluginInput {
    return {
      directory: "/repo",
      client: {
        session: {
          prompt: mock(async () => ({})),
        },
      },
    } as unknown as PluginInput
  }

  test("registers and unregisters worker handle on session lifecycle", async () => {
    // #given
    process.env.OPENCODE_SWARM_TEAM = "team-a"
    process.env.OPENCODE_SWARM_NAME = "worker-1"
    process.env.OPENCODE_SWARM_ROLE = "worker"

    const runtime = createSwarmRuntimeService()
    const workerStop = mock(async () => true)
    mockCreateWorker.mockImplementation(async () => ({
      isWorking: () => false,
      stop: workerStop,
      getIdentity: () => ({ id: "worker-id" }),
      getCurrentTask: () => null,
      getCurrentMode: () => "default",
      isPlanApprovedForCurrentTask: () => true,
      requestPermission: async () => ({ approved: true }),
      reportTaskComplete: () => true,
    }))

    const hook = createSwarmAgentHook(createCtx(), { config: {}, runtime })

    // #when
    await hook.event({
      event: { type: "session.created", properties: { info: { id: "sess-main" } } },
    })

    // #then
    expect(runtime.getWorker("sess-main")).toBeDefined()

    // #when
    await hook.event({
      event: { type: "session.deleted", properties: { info: { id: "sess-main" } } },
    })

    // #then
    expect(runtime.getWorker("sess-main")).toBeUndefined()
    expect(workerStop).toHaveBeenCalledTimes(1)
  })

  test("registers and unregisters coordinator handle on session lifecycle", async () => {
    // #given
    process.env.OPENCODE_SWARM_TEAM = "team-a"
    process.env.OPENCODE_SWARM_NAME = "coordinator"
    process.env.OPENCODE_SWARM_ROLE = "coordinator"

    const runtime = createSwarmRuntimeService()
    const coordinatorStop = mock(async () => true)
    mockCreateCoordinator.mockImplementation(async () => ({
      stop: coordinatorStop,
      getIdentity: () => ({ id: "coord-id" }),
    }))

    const hook = createSwarmAgentHook(createCtx(), { config: {}, runtime })

    // #when
    await hook.event({
      event: { type: "session.created", properties: { info: { id: "sess-main" } } },
    })

    // #then
    expect(runtime.getCoordinator("sess-main")).toBeDefined()

    // #when
    await hook.event({
      event: { type: "session.deleted", properties: { info: { id: "sess-main" } } },
    })

    // #then
    expect(runtime.getCoordinator("sess-main")).toBeUndefined()
    expect(coordinatorStop).toHaveBeenCalledTimes(1)
  })
})
