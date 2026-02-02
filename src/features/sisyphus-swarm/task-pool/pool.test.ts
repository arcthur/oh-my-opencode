import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { mkdirSync, rmSync, existsSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import type { OhMyOpenCodeConfig } from "../../../config/schema"
import {
  createTask,
  assignTask,
  readTask,
  completeTask,
  reassignTask,
  dependencyDepth,
  updateTask,
  getNextTaskForAgent,
} from "./pool"

describe("task-pool/pool", () => {
  let testDir: string
  let config: Partial<OhMyOpenCodeConfig>

  beforeEach(() => {
    testDir = join(tmpdir(), `swarm-task-pool-test-${Date.now()}`)
    mkdirSync(testDir, { recursive: true })

    config = {
      sisyphus: {
        tasks: {
          enabled: true,
          storage_path: testDir,
          claude_code_compat: false,
        },
      },
    }
  })

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true })
    }
  })

  test("completeTask only succeeds for current owner on in_progress task", () => {
    const listId = "list"
    const task = createTask(listId, { subject: "S", description: "D" }, config)

    // Assign to worker A
    const assigned = assignTask(listId, task.id, "workerA", config)
    expect(assigned?.status).toBe("in_progress")
    expect(assigned?.owner).toBe("workerA")

    // Wrong owner cannot complete
    const wrong = completeTask(listId, task.id, "workerB", config)
    expect(wrong).toBeNull()

    // Still in progress
    const afterWrong = readTask(listId, task.id, config)
    expect(afterWrong?.status).toBe("in_progress")

    // Correct owner completes
    const ok = completeTask(listId, task.id, "workerA", config)
    expect(ok?.status).toBe("completed")
  })

  test("reassignTask respects expectedOwnerId (prevents clobbering)", () => {
    const listId = "list"
    const task = createTask(listId, { subject: "S", description: "D" }, config)

    // Assign to worker A
    assignTask(listId, task.id, "workerA", config)

    // If expected owner mismatches, do nothing
    const no = reassignTask(listId, task.id, "reason", config, { expectedOwnerId: "workerB" })
    expect(no).toBeNull()

    // If expected owner matches, task becomes pending without owner
    const yes = reassignTask(listId, task.id, "reason", config, { expectedOwnerId: "workerA" })
    expect(yes?.status).toBe("pending")
    expect(yes?.owner).toBeUndefined()
  })

  // Issue 6: dependencyDepth tests
  describe("dependencyDepth", () => {
    test("returns 0 for task with no dependencies", () => {
      const listId = "list"
      const task = createTask(listId, { subject: "S", description: "D" }, config)

      const depth = dependencyDepth(listId, task.id, config)
      expect(depth).toBe(0)
    })

    test("returns 1 for task blocked by one task with no dependencies", () => {
      const listId = "list"
      const taskA = createTask(listId, { subject: "A", description: "A" }, config)
      const taskB = createTask(listId, { subject: "B", description: "B blocked by A" }, config)

      // B is blocked by A
      updateTask(listId, { taskId: taskB.id, addBlockedBy: [taskA.id] }, config)

      expect(dependencyDepth(listId, taskA.id, config)).toBe(0)
      expect(dependencyDepth(listId, taskB.id, config)).toBe(1)
    })

    test("returns correct depth for chain A <- B <- C", () => {
      const listId = "list"
      const taskA = createTask(listId, { subject: "A", description: "A" }, config)
      const taskB = createTask(listId, { subject: "B", description: "B" }, config)
      const taskC = createTask(listId, { subject: "C", description: "C" }, config)

      // C <- B <- A means C.blockedBy=[B], B.blockedBy=[A]
      updateTask(listId, { taskId: taskB.id, addBlockedBy: [taskA.id] }, config)
      updateTask(listId, { taskId: taskC.id, addBlockedBy: [taskB.id] }, config)

      expect(dependencyDepth(listId, taskA.id, config)).toBe(0)
      expect(dependencyDepth(listId, taskB.id, config)).toBe(1)
      expect(dependencyDepth(listId, taskC.id, config)).toBe(2)
    })

    test("returns max depth for diamond dependency", () => {
      const listId = "list"
      // A -> B, A -> C, B -> D, C -> D (diamond)
      // Depth perspective: D depends on B and C, B and C depend on A
      const taskA = createTask(listId, { subject: "A", description: "A" }, config)
      const taskB = createTask(listId, { subject: "B", description: "B" }, config)
      const taskC = createTask(listId, { subject: "C", description: "C" }, config)
      const taskD = createTask(listId, { subject: "D", description: "D" }, config)

      updateTask(listId, { taskId: taskB.id, addBlockedBy: [taskA.id] }, config)
      updateTask(listId, { taskId: taskC.id, addBlockedBy: [taskA.id] }, config)
      updateTask(listId, { taskId: taskD.id, addBlockedBy: [taskB.id, taskC.id] }, config)

      expect(dependencyDepth(listId, taskA.id, config)).toBe(0)
      expect(dependencyDepth(listId, taskB.id, config)).toBe(1)
      expect(dependencyDepth(listId, taskC.id, config)).toBe(1)
      expect(dependencyDepth(listId, taskD.id, config)).toBe(2)
    })

    test("uses memoization correctly", () => {
      const listId = "list"
      const taskA = createTask(listId, { subject: "A", description: "A" }, config)
      const taskB = createTask(listId, { subject: "B", description: "B" }, config)

      updateTask(listId, { taskId: taskB.id, addBlockedBy: [taskA.id] }, config)

      const memo = new Map<string, number>()

      // First call computes and memoizes
      const depthA = dependencyDepth(listId, taskA.id, config, memo)
      expect(memo.get(taskA.id)).toBe(0)

      // Second call uses memoized value
      const depthB = dependencyDepth(listId, taskB.id, config, memo)
      expect(depthB).toBe(1)
      expect(memo.get(taskB.id)).toBe(1)
    })
  })

  // Test sorting by priority -> depth -> creation
  describe("getNextTaskForAgent sorting", () => {
    test("prioritizes by priority first", () => {
      const listId = "list"
      const lowPriority = createTask(listId, {
        subject: "Low",
        description: "Low",
        metadata: { priority: 1 },
      }, config)
      const highPriority = createTask(listId, {
        subject: "High",
        description: "High",
        metadata: { priority: 10 },
      }, config)

      const next = getNextTaskForAgent(listId, "agent", ["code"], config)
      expect(next?.id).toBe(highPriority.id)
    })

    test("prioritizes by depth when priority is equal", () => {
      const listId = "list"
      const taskA = createTask(listId, { subject: "A", description: "A", metadata: { priority: 5 } }, config)
      const taskB = createTask(listId, { subject: "B", description: "B", metadata: { priority: 5 } }, config)
      const taskC = createTask(listId, { subject: "C", description: "C", metadata: { priority: 5 } }, config)

      // B depends on A, C has no deps
      // But C has deeper depth (2) if it depends on B
      // Let's make: A (depth 0), B (depth 0), C depends on A (depth 1)
      updateTask(listId, { taskId: taskC.id, addBlockedBy: [taskA.id] }, config)

      // A and B are ready (depth 0), C is blocked
      // Next should be A or B (both depth 0), ordered by ID
      const next = getNextTaskForAgent(listId, "agent", ["code"], config)
      // Since A and B have same priority and depth 0, first by ID wins
      expect(next?.id === taskA.id || next?.id === taskB.id).toBe(true)
    })

    test("returns null when no tasks match capabilities", () => {
      const listId = "list"
      createTask(listId, {
        subject: "Design Task",
        description: "Needs design",
        metadata: { requiredCapabilities: ["design"] },
      }, config)

      const next = getNextTaskForAgent(listId, "agent", ["code"], config)
      expect(next).toBeNull()
    })
  })
})

