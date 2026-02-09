import { describe, expect, it } from "bun:test"
import { TaskStateManager } from "./state"
import type { BackgroundTask } from "./types"

function createTask(id: string, status: BackgroundTask["status"]): BackgroundTask {
  return {
    id,
    status,
    description: `task-${id}`,
    prompt: "run",
    agent: "explore",
    parentSessionID: "parent-session",
    parentMessageID: "parent-message",
  }
}

describe("TaskStateManager task status selectors", () => {
  it("returns only running tasks via getRunningTasks", () => {
    // #given
    const state = new TaskStateManager()
    state.addTask(createTask("pending", "pending"))
    state.addTask(createTask("running", "running"))
    state.addTask(createTask("completed", "completed"))

    // #when
    const running = state.getRunningTasks().map((task) => task.id)

    // #then
    expect(running).toEqual(["running"])
  })

  it("returns all non-running tasks via getNonRunningTasks", () => {
    // #given
    const state = new TaskStateManager()
    state.addTask(createTask("pending", "pending"))
    state.addTask(createTask("running", "running"))
    state.addTask(createTask("completed", "completed"))
    state.addTask(createTask("interrupt", "interrupt"))

    // #when
    const nonRunning = state.getNonRunningTasks().map((task) => task.id).sort()

    // #then
    expect(nonRunning).toEqual(["completed", "interrupt", "pending"])
  })

  it("getCompletedTasks returns only tasks with status completed", () => {
    // #given
    const state = new TaskStateManager()
    state.addTask(createTask("pending", "pending"))
    state.addTask(createTask("running", "running"))
    state.addTask(createTask("completed", "completed"))
    state.addTask(createTask("interrupt", "interrupt"))
    state.addTask(createTask("error", "error"))

    // #when
    const completed = state.getCompletedTasks().map((task) => task.id)

    // #then
    expect(completed).toEqual(["completed"])
  })
})
