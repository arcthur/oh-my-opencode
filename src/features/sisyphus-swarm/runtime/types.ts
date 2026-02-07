import type { CoordinatorAgent, WorkerAgent } from "../agent"
import type { SwarmOrchestrator } from "../tmux"

export interface SwarmTeamBinding {
  teamKey: string
  directory: string
  teamName: string
}

export interface SwarmRuntimeService {
  toTeamKey(directory: string, teamName: string): string

  bindSessionToTeam(sessionId: string, directory: string, teamName: string): SwarmTeamBinding
  getSessionTeam(sessionId: string): SwarmTeamBinding | undefined
  unbindSession(sessionId: string): void
  getSessionsForTeam(directory: string, teamName: string): string[]

  setOrchestrator(directory: string, teamName: string, orchestrator: SwarmOrchestrator): void
  getOrchestrator(directory: string, teamName: string): SwarmOrchestrator | undefined
  getSessionOrchestrator(sessionId: string): SwarmOrchestrator | undefined
  ensureOrchestrator(
    directory: string,
    teamName: string,
    factory: () => SwarmOrchestrator | null
  ): SwarmOrchestrator | null

  stopTeam(directory: string, teamName: string, cleanup: boolean): boolean
  clearAll(cleanup: boolean): void

  registerWorker(sessionId: string, worker: WorkerAgent): void
  unregisterWorker(sessionId: string): void
  getWorker(sessionId: string): WorkerAgent | undefined

  registerCoordinator(sessionId: string, coordinator: CoordinatorAgent): void
  unregisterCoordinator(sessionId: string): void
  getCoordinator(sessionId: string): CoordinatorAgent | undefined
}
