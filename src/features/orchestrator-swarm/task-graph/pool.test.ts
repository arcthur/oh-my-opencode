import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { mkdirSync, rmSync, existsSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import type { OhMyOpenCodeConfig } from "../../../config/schema"
import {
  assignSwarmTask,
  completeSwarmTask,
  createSwarmTask,
  dependencyDepth,
  getNextSwarmTaskForAgent,
  readSwarmTaskNode,
  reassignSwarmTask,
  updateSwarmTask,
} from "./pool"

describe("task-graph/pool (swarm scope)", () => {
  let testDir: string
  let config: Partial<OhMyOpenCodeConfig>

  beforeEach(() => {
    testDir = join(tmpdir(), `swarm-task-graph-test-${Date.now()}`)
    mkdirSync(testDir, { recursive: true })

    config = {
      orchestrator: {
        tasks: {
          enabled: true,
          storage_path: testDir,
        },
      },
    }
  })

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true })
    }
  })

  test("completeSwarmTask only succeeds for current owner on in_progress task", () => {
    // #given
    const teamName = "team"
    const created = createSwarmTask(
      teamName,
      { title: "S", description: "D" },
      config
    )

    // #when - assign to worker A
    const assigned = assignSwarmTask(teamName, created.id, "workerA", config)

    // #then
    expect(assigned?.state).toBe("in_progress")
    expect(assigned?.owner).toBe("workerA")

    // #when - wrong owner cannot complete
    const wrong = completeSwarmTask(teamName, created.id, "workerB", config)

    // #then
    expect(wrong).toBeNull()
    expect(readSwarmTaskNode(teamName, created.id, config)?.state).toBe("in_progress")

    // #when - correct owner completes
    const ok = completeSwarmTask(teamName, created.id, "workerA", config)

    // #then
    expect(ok?.state).toBe("completed")
  })

  test("reassignSwarmTask respects expectedOwnerId (prevents clobbering)", () => {
    // #given
    const teamName = "team"
    const created = createSwarmTask(teamName, { title: "S", description: "D" }, config)
    assignSwarmTask(teamName, created.id, "workerA", config)

    // #when - expected owner mismatches
    const no = reassignSwarmTask(teamName, created.id, "reason", config, {
      expectedOwnerId: "workerB",
    })

    // #then
    expect(no).toBeNull()

    // #when - expected owner matches
    const yes = reassignSwarmTask(teamName, created.id, "reason", config, {
      expectedOwnerId: "workerA",
    })

    // #then
    expect(yes?.state).toBe("open")
    expect(yes?.owner).toBeUndefined()
  })

  describe("dependencyDepth", () => {
    test("returns 0 for task with no dependencies", () => {
      // #given
      const teamName = "team"
      const task = createSwarmTask(teamName, { title: "S", description: "D" }, config)

      // #when
      const depth = dependencyDepth(teamName, task.id, config)

      // #then
      expect(depth).toBe(0)
    })

    test("returns 1 for task that depends on one task with no dependencies", () => {
      // #given
      const teamName = "team"
      const taskA = createSwarmTask(teamName, { title: "A", description: "A" }, config)
      const taskB = createSwarmTask(teamName, { title: "B", description: "B" }, config)

      // #when
      updateSwarmTask(teamName, { id: taskB.id, add_depends_on: [taskA.id] }, config)

      // #then
      expect(dependencyDepth(teamName, taskA.id, config)).toBe(0)
      expect(dependencyDepth(teamName, taskB.id, config)).toBe(1)
    })

    test("returns correct depth for chain A <- B <- C", () => {
      // #given
      const teamName = "team"
      const taskA = createSwarmTask(teamName, { title: "A", description: "A" }, config)
      const taskB = createSwarmTask(teamName, { title: "B", description: "B" }, config)
      const taskC = createSwarmTask(teamName, { title: "C", description: "C" }, config)

      // #when
      updateSwarmTask(teamName, { id: taskB.id, add_depends_on: [taskA.id] }, config)
      updateSwarmTask(teamName, { id: taskC.id, add_depends_on: [taskB.id] }, config)

      // #then
      expect(dependencyDepth(teamName, taskA.id, config)).toBe(0)
      expect(dependencyDepth(teamName, taskB.id, config)).toBe(1)
      expect(dependencyDepth(teamName, taskC.id, config)).toBe(2)
    })

    test("returns max depth for diamond dependency", () => {
      // #given
      const teamName = "team"
      const taskA = createSwarmTask(teamName, { title: "A", description: "A" }, config)
      const taskB = createSwarmTask(teamName, { title: "B", description: "B" }, config)
      const taskC = createSwarmTask(teamName, { title: "C", description: "C" }, config)
      const taskD = createSwarmTask(teamName, { title: "D", description: "D" }, config)

      // #when
      updateSwarmTask(teamName, { id: taskB.id, add_depends_on: [taskA.id] }, config)
      updateSwarmTask(teamName, { id: taskC.id, add_depends_on: [taskA.id] }, config)
      updateSwarmTask(teamName, { id: taskD.id, add_depends_on: [taskB.id, taskC.id] }, config)

      // #then
      expect(dependencyDepth(teamName, taskA.id, config)).toBe(0)
      expect(dependencyDepth(teamName, taskB.id, config)).toBe(1)
      expect(dependencyDepth(teamName, taskC.id, config)).toBe(1)
      expect(dependencyDepth(teamName, taskD.id, config)).toBe(2)
    })

    test("uses memoization correctly", () => {
      // #given
      const teamName = "team"
      const taskA = createSwarmTask(teamName, { title: "A", description: "A" }, config)
      const taskB = createSwarmTask(teamName, { title: "B", description: "B" }, config)
      updateSwarmTask(teamName, { id: taskB.id, add_depends_on: [taskA.id] }, config)
      const memo = new Map<string, number>()

      // #when
      const depthA = dependencyDepth(teamName, taskA.id, config, memo)
      const depthB = dependencyDepth(teamName, taskB.id, config, memo)

      // #then
      expect(depthA).toBe(0)
      expect(depthB).toBe(1)
      expect(memo.get(taskA.id)).toBe(0)
      expect(memo.get(taskB.id)).toBe(1)
    })
  })

  describe("getNextSwarmTaskForAgent sorting", () => {
    test("prioritizes by priority first", () => {
      // #given
      const teamName = "team"
      const low = createSwarmTask(
        teamName,
        { title: "Low", description: "Low", priority: 1 },
        config
      )
      const high = createSwarmTask(
        teamName,
        { title: "High", description: "High", priority: 10 },
        config
      )

      // #when
      const next = getNextSwarmTaskForAgent(teamName, "agent", ["code"], config)

      // #then
      expect(next?.id).toBe(high.id)
      expect(next?.id).not.toBe(low.id)
    })

    test("returns null when no tasks match capabilities", () => {
      // #given
      const teamName = "team"
      createSwarmTask(
        teamName,
        {
          title: "Design Task",
          description: "Needs design",
          metadata: { requiredCapabilities: ["design"] },
        },
        config
      )

      // #when
      const next = getNextSwarmTaskForAgent(teamName, "agent", ["code"], config)

      // #then
      expect(next).toBeNull()
    })
  })
})

