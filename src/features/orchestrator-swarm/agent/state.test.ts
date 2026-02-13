import { describe, test, expect } from "bun:test"
import {
  createInitialState,
  isValidTransition,
  applyEvent,
  AgentStateMachine,
} from "./state"

describe("agent/state", () => {
  test("createInitialState returns joining state", () => {
    const state = createInitialState()

    expect(state.status).toBe("joining")
    expect(state.tasksCompleted).toBe(0)
    expect(state.tasksFailed).toBe(0)
    expect(state.lastStatusChange).toBeGreaterThan(0)
  })

  describe("isValidTransition", () => {
    test("joining can transition to idle or dead", () => {
      expect(isValidTransition("joining", "idle")).toBe(true)
      expect(isValidTransition("joining", "dead")).toBe(true)
      expect(isValidTransition("joining", "working")).toBe(false)
    })

    test("idle can transition to working, leaving, or dead", () => {
      expect(isValidTransition("idle", "working")).toBe(true)
      expect(isValidTransition("idle", "leaving")).toBe(true)
      expect(isValidTransition("idle", "dead")).toBe(true)
      expect(isValidTransition("idle", "paused")).toBe(false)
    })

    test("working can transition to idle, paused, leaving, or dead", () => {
      expect(isValidTransition("working", "idle")).toBe(true)
      expect(isValidTransition("working", "paused")).toBe(true)
      expect(isValidTransition("working", "leaving")).toBe(true)
      expect(isValidTransition("working", "dead")).toBe(true)
    })

    test("paused can transition to working, idle, leaving, or dead", () => {
      expect(isValidTransition("paused", "working")).toBe(true)
      expect(isValidTransition("paused", "idle")).toBe(true)
      expect(isValidTransition("paused", "leaving")).toBe(true)
      expect(isValidTransition("paused", "dead")).toBe(true)
    })

    test("leaving can only transition to dead", () => {
      expect(isValidTransition("leaving", "dead")).toBe(true)
      expect(isValidTransition("leaving", "idle")).toBe(false)
    })

    test("dead can transition to joining (rejoin)", () => {
      expect(isValidTransition("dead", "joining")).toBe(true)
      expect(isValidTransition("dead", "idle")).toBe(false)
    })
  })

  describe("applyEvent", () => {
    test("JOIN_APPROVED transitions to idle", () => {
      const state = createInitialState()
      const newState = applyEvent(state, { type: "JOIN_APPROVED" })

      expect(newState.status).toBe("idle")
      expect(newState.error).toBeUndefined()
    })

    test("JOIN_REJECTED transitions to dead with error", () => {
      const state = createInitialState()
      const newState = applyEvent(state, { type: "JOIN_REJECTED", reason: "Team full" })

      expect(newState.status).toBe("dead")
      expect(newState.error).toBe("Team full")
    })

    test("TASK_ASSIGNED transitions to working", () => {
      let state = createInitialState()
      state = applyEvent(state, { type: "JOIN_APPROVED" })
      state = applyEvent(state, { type: "TASK_ASSIGNED", taskId: "task_1", title: "Test task" })

      expect(state.status).toBe("working")
      expect(state.currentTaskId).toBe("task_1")
      expect(state.currentTaskTitle).toBe("Test task")
    })

    test("TASK_COMPLETED transitions to idle and increments counter", () => {
      let state = createInitialState()
      state = applyEvent(state, { type: "JOIN_APPROVED" })
      state = applyEvent(state, { type: "TASK_ASSIGNED", taskId: "task_1", title: "Test task" })
      state = applyEvent(state, { type: "TASK_COMPLETED" })

      expect(state.status).toBe("idle")
      expect(state.currentTaskId).toBeUndefined()
      expect(state.tasksCompleted).toBe(1)
    })

    test("TASK_FAILED transitions to idle and increments failed counter", () => {
      let state = createInitialState()
      state = applyEvent(state, { type: "JOIN_APPROVED" })
      state = applyEvent(state, { type: "TASK_ASSIGNED", taskId: "task_1", title: "Test task" })
      state = applyEvent(state, { type: "TASK_FAILED", error: "Out of memory" })

      expect(state.status).toBe("idle")
      expect(state.tasksFailed).toBe(1)
      expect(state.error).toBe("Out of memory")
    })

    test("PAUSE transitions to paused with context", () => {
      let state = createInitialState()
      state = applyEvent(state, { type: "JOIN_APPROVED" })
      state = applyEvent(state, { type: "TASK_ASSIGNED", taskId: "task_1", title: "Test task" })
      state = applyEvent(state, {
        type: "PAUSE",
        reason: "Awaiting permission",
        resumeOn: "permission_response",
        requestId: "req_1",
      })

      expect(state.status).toBe("paused")
      expect(state.pauseContext?.reason).toBe("Awaiting permission")
      expect(state.pauseContext?.resumeOn).toBe("permission_response")
      expect(state.pauseContext?.requestId).toBe("req_1")
      expect(state.pauseContext?.savedTaskId).toBe("task_1")
    })

    test("RESUME transitions back to working and clears pauseContext", () => {
      let state = createInitialState()
      state = applyEvent(state, { type: "JOIN_APPROVED" })
      state = applyEvent(state, { type: "TASK_ASSIGNED", taskId: "task_1", title: "Test task" })
      state = applyEvent(state, {
        type: "PAUSE",
        reason: "Awaiting permission",
        resumeOn: "permission_response",
      })
      state = applyEvent(state, { type: "RESUME" })

      expect(state.status).toBe("working")
      expect(state.pauseContext).toBeUndefined()
    })

    test("PAUSE_TIMEOUT transitions to idle and increments failed counter", () => {
      let state = createInitialState()
      state = applyEvent(state, { type: "JOIN_APPROVED" })
      state = applyEvent(state, { type: "TASK_ASSIGNED", taskId: "task_1", title: "Test task" })
      state = applyEvent(state, {
        type: "PAUSE",
        reason: "Awaiting permission",
        resumeOn: "permission_response",
      })
      state = applyEvent(state, { type: "PAUSE_TIMEOUT" })

      expect(state.status).toBe("idle")
      expect(state.pauseContext).toBeUndefined()
      expect(state.tasksFailed).toBe(1)
      expect(state.error).toContain("Pause timeout")
    })

    test("SHUTDOWN_REQUESTED transitions to leaving", () => {
      let state = createInitialState()
      state = applyEvent(state, { type: "JOIN_APPROVED" })
      state = applyEvent(state, { type: "SHUTDOWN_REQUESTED" })

      expect(state.status).toBe("leaving")
    })

    test("SHUTDOWN_APPROVED transitions to dead", () => {
      let state = createInitialState()
      state = applyEvent(state, { type: "JOIN_APPROVED" })
      state = applyEvent(state, { type: "SHUTDOWN_REQUESTED" })
      state = applyEvent(state, { type: "SHUTDOWN_APPROVED" })

      expect(state.status).toBe("dead")
    })

    test("HEARTBEAT_TIMEOUT transitions to dead", () => {
      let state = createInitialState()
      state = applyEvent(state, { type: "JOIN_APPROVED" })
      state = applyEvent(state, { type: "HEARTBEAT_TIMEOUT" })

      expect(state.status).toBe("dead")
      expect(state.error).toBe("Heartbeat timeout")
    })

    test("RESET returns initial state", () => {
      let state = createInitialState()
      state = applyEvent(state, { type: "JOIN_APPROVED" })
      state = applyEvent(state, { type: "TASK_ASSIGNED", taskId: "task_1", title: "Test" })
      state = applyEvent(state, { type: "TASK_COMPLETED" })
      state = applyEvent(state, { type: "RESET" })

      expect(state.status).toBe("joining")
      expect(state.tasksCompleted).toBe(0)
    })

    test("throws on invalid transition", () => {
      const state = createInitialState()

      expect(() => {
        applyEvent(state, { type: "TASK_ASSIGNED", taskId: "task_1", title: "Test" })
      }).toThrow("Invalid transition")
    })
  })

  describe("AgentStateMachine", () => {
    test("getState returns current state", () => {
      const machine = new AgentStateMachine()
      const state = machine.getState()

      expect(state.status).toBe("joining")
    })

    test("getStatus returns current status", () => {
      const machine = new AgentStateMachine()
      expect(machine.getStatus()).toBe("joining")
    })

    test("is() checks current status", () => {
      const machine = new AgentStateMachine()

      expect(machine.is("joining")).toBe(true)
      expect(machine.is("idle")).toBe(false)
    })

    test("canTransitionTo checks valid transitions", () => {
      const machine = new AgentStateMachine()

      expect(machine.canTransitionTo("idle")).toBe(true)
      expect(machine.canTransitionTo("working")).toBe(false)
    })

    test("dispatch updates state", () => {
      const machine = new AgentStateMachine()

      machine.dispatch({ type: "JOIN_APPROVED" })
      expect(machine.getStatus()).toBe("idle")

      machine.dispatch({ type: "TASK_ASSIGNED", taskId: "t1", title: "Test" })
      expect(machine.getStatus()).toBe("working")
    })

    test("subscribe receives state changes", () => {
      const machine = new AgentStateMachine()
      const events: string[] = []

      machine.subscribe((state, event) => {
        events.push(event.type)
      })

      machine.dispatch({ type: "JOIN_APPROVED" })
      machine.dispatch({ type: "TASK_ASSIGNED", taskId: "t1", title: "Test" })

      expect(events).toContain("JOIN_APPROVED")
      expect(events).toContain("TASK_ASSIGNED")
    })

    test("unsubscribe stops notifications", () => {
      const machine = new AgentStateMachine()
      const events: string[] = []

      const unsub = machine.subscribe((state, event) => {
        events.push(event.type)
      })

      machine.dispatch({ type: "JOIN_APPROVED" })
      unsub()
      machine.dispatch({ type: "TASK_ASSIGNED", taskId: "t1", title: "Test" })

      expect(events.length).toBe(1)
      expect(events[0]).toBe("JOIN_APPROVED")
    })

    test("getSummary returns formatted string", () => {
      const machine = new AgentStateMachine()
      machine.dispatch({ type: "JOIN_APPROVED" })
      machine.dispatch({ type: "TASK_ASSIGNED", taskId: "t1", title: "Build feature" })

      const summary = machine.getSummary()

      expect(summary).toContain("working")
      expect(summary).toContain("Build feature")
    })
  })
})
