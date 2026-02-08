import { describe, expect, test } from "bun:test"
import {
  canTransitionTaskState,
  deriveTaskReadiness,
  wouldCreateDependencyCycle,
  type TaskNode,
} from "./domain"

describe("task-system/domain", () => {
  test("allows expected lifecycle transitions", () => {
    // #given
    const transitions: Array<[string, string, boolean]> = [
      ["open", "in_progress", true],
      ["open", "completed", true],
      ["in_progress", "open", true],
      ["failed", "cancelled", true],
      ["completed", "open", false],
      ["cancelled", "in_progress", false],
    ]

    // #when / #then
    for (const [from, to, expected] of transitions) {
      expect(
        canTransitionTaskState(
          from as TaskNode["state"],
          to as TaskNode["state"]
        )
      ).toBe(expected)
    }
  })

  test("derives blocked readiness from unresolved dependencies", () => {
    // #given
    const task = {
      depends_on: ["task_a", "task_b"],
    }

    // #when
    const readiness = deriveTaskReadiness(task, (taskId) => {
      if (taskId === "task_a") return "completed"
      if (taskId === "task_b") return "in_progress"
      return undefined
    })

    // #then
    expect(readiness.readiness).toBe("blocked")
    expect(readiness.blocked_by_unresolved).toEqual(["task_b"])
  })

  test("detects dependency cycles", () => {
    // #given
    const adjacency: Record<string, string[]> = {
      task_a: ["task_b"],
      task_b: ["task_c"],
      task_c: [],
    }

    // #when
    const cycle = wouldCreateDependencyCycle("task_c", ["task_a"], (id) => adjacency[id] ?? [])
    const noCycle = wouldCreateDependencyCycle("task_d", ["task_a"], (id) => adjacency[id] ?? [])

    // #then
    expect(cycle).toBe(true)
    expect(noCycle).toBe(false)
  })
})
