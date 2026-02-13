import { describe, it, expect } from "bun:test"
import type { OhMyOpenCodeConfig } from "../../config"
import { createSafeEventProcessor, resolveRunAgent } from "./runner"

const createConfig = (overrides: Partial<OhMyOpenCodeConfig> = {}): OhMyOpenCodeConfig => ({
  ...overrides,
})

describe("resolveRunAgent", () => {
  it("uses CLI agent over env and config", () => {
    // given
    const config = createConfig({ default_run_agent: "planner" })
    const env = { OPENCODE_DEFAULT_AGENT: "planner" }

    // when
    const agent = resolveRunAgent(
      { message: "test", agent: "executor" },
      config,
      env
    )

    // then
    expect(agent).toBe("executor")
  })

  it("uses env agent over config", () => {
    // given
    const config = createConfig({ default_run_agent: "planner" })
    const env = { OPENCODE_DEFAULT_AGENT: "planner" }

    // when
    const agent = resolveRunAgent({ message: "test" }, config, env)

    // then
    expect(agent).toBe("planner")
  })

  it("uses config agent over default", () => {
    // given
    const config = createConfig({ default_run_agent: "planner" })

    // when
    const agent = resolveRunAgent({ message: "test" }, config, {})

    // then
    expect(agent).toBe("planner")
  })

  it("falls back to orchestrator when none set", () => {
    // given
    const config = createConfig()

    // when
    const agent = resolveRunAgent({ message: "test" }, config, {})

    // then
    expect(agent).toBe("orchestrator")
  })

  it("skips disabled orchestrator for next available core agent", () => {
    // given
    const config = createConfig({ disabled_agents: ["orchestrator"] })

    // when
    const agent = resolveRunAgent({ message: "test" }, config, {})

    // then
    expect(agent).toBe("executor")
  })
})

describe("createSafeEventProcessor", () => {
  it("resolves when event processor succeeds", async () => {
    // given
    const processor = Promise.resolve()

    // when
    const result = await createSafeEventProcessor(processor)

    // then
    expect(result).toBeUndefined()
  })

  it("swallows event processor rejection", async () => {
    // given
    const processor = Promise.reject(new Error("stream failed"))

    // when
    const result = await createSafeEventProcessor(processor)

    // then
    expect(result).toBeUndefined()
  })
})
