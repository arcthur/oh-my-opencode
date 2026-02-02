import type { WorkerAgent, CoordinatorAgent } from "../agent"

/**
 * Runtime registry for Swarm worker/coordinator instances within a single process.
 *
 * Motivation:
 * - Tools (e.g. /swarm plan submit) need to call methods on the currently running
 *   WorkerAgent/CoordinatorAgent for the current session.
 * - The SwarmAgent hook owns the lifecycle of these instances.
 */

const workersBySession = new Map<string, WorkerAgent>()
const coordinatorsBySession = new Map<string, CoordinatorAgent>()

export function registerWorker(sessionId: string, worker: WorkerAgent): void {
  workersBySession.set(sessionId, worker)
}

export function unregisterWorker(sessionId: string): void {
  workersBySession.delete(sessionId)
}

export function getWorker(sessionId: string): WorkerAgent | undefined {
  return workersBySession.get(sessionId)
}

export function registerCoordinator(sessionId: string, coordinator: CoordinatorAgent): void {
  coordinatorsBySession.set(sessionId, coordinator)
}

export function unregisterCoordinator(sessionId: string): void {
  coordinatorsBySession.delete(sessionId)
}

export function getCoordinator(sessionId: string): CoordinatorAgent | undefined {
  return coordinatorsBySession.get(sessionId)
}

export function clearSwarmRuntimeRegistry(): void {
  workersBySession.clear()
  coordinatorsBySession.clear()
}

