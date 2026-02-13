import type { CoordinatorAgent, WorkerAgent } from "../agent"
import type { SwarmOrchestrator } from "../tmux"
import type {
  SwarmRuntimeService,
  SwarmTeamBinding,
} from "./types"

interface SwarmTeamRuntimeRecord extends SwarmTeamBinding {
  orchestrator?: SwarmOrchestrator
}

export class InMemorySwarmRuntimeService implements SwarmRuntimeService {
  private readonly teamsByKey = new Map<string, SwarmTeamRuntimeRecord>()
  private readonly sessionToTeamKey = new Map<string, string>()
  private readonly workersBySession = new Map<string, WorkerAgent>()
  private readonly coordinatorsBySession = new Map<string, CoordinatorAgent>()

  toTeamKey(directory: string, teamName: string): string {
    return `${directory}::${teamName}`
  }

  private ensureTeamRecord(directory: string, teamName: string): SwarmTeamRuntimeRecord {
    const teamKey = this.toTeamKey(directory, teamName)
    const existing = this.teamsByKey.get(teamKey)
    if (existing) {
      return existing
    }

    const created: SwarmTeamRuntimeRecord = {
      teamKey,
      directory,
      teamName,
    }
    this.teamsByKey.set(teamKey, created)
    return created
  }

  bindSessionToTeam(sessionId: string, directory: string, teamName: string): SwarmTeamBinding {
    const record = this.ensureTeamRecord(directory, teamName)
    this.sessionToTeamKey.set(sessionId, record.teamKey)
    return {
      teamKey: record.teamKey,
      directory: record.directory,
      teamName: record.teamName,
    }
  }

  getSessionTeam(sessionId: string): SwarmTeamBinding | undefined {
    const teamKey = this.sessionToTeamKey.get(sessionId)
    if (!teamKey) return undefined

    const record = this.teamsByKey.get(teamKey)
    if (!record) {
      this.sessionToTeamKey.delete(sessionId)
      return undefined
    }

    return {
      teamKey: record.teamKey,
      directory: record.directory,
      teamName: record.teamName,
    }
  }

  unbindSession(sessionId: string): void {
    this.sessionToTeamKey.delete(sessionId)
  }

  getSessionsForTeam(directory: string, teamName: string): string[] {
    const teamKey = this.toTeamKey(directory, teamName)
    const sessions: string[] = []
    for (const [sessionId, boundTeamKey] of this.sessionToTeamKey.entries()) {
      if (boundTeamKey === teamKey) {
        sessions.push(sessionId)
      }
    }
    return sessions
  }

  setOrchestrator(directory: string, teamName: string, orchestrator: SwarmOrchestrator): void {
    const record = this.ensureTeamRecord(directory, teamName)
    record.orchestrator = orchestrator
  }

  getOrchestrator(directory: string, teamName: string): SwarmOrchestrator | undefined {
    const teamKey = this.toTeamKey(directory, teamName)
    return this.teamsByKey.get(teamKey)?.orchestrator
  }

  getSessionOrchestrator(sessionId: string): SwarmOrchestrator | undefined {
    const binding = this.getSessionTeam(sessionId)
    if (!binding) return undefined
    return this.getOrchestrator(binding.directory, binding.teamName)
  }

  ensureOrchestrator(
    directory: string,
    teamName: string,
    factory: () => SwarmOrchestrator | null
  ): SwarmOrchestrator | null {
    const existing = this.getOrchestrator(directory, teamName)
    if (existing) {
      return existing
    }

    const created = factory()
    if (!created) {
      return null
    }

    this.setOrchestrator(directory, teamName, created)
    return created
  }

  stopTeam(directory: string, teamName: string, cleanup: boolean): boolean {
    const teamKey = this.toTeamKey(directory, teamName)
    const record = this.teamsByKey.get(teamKey)
    if (!record) {
      return false
    }

    if (record.orchestrator) {
      record.orchestrator.cleanup(cleanup)
    }

    this.teamsByKey.delete(teamKey)

    for (const [sessionId, boundKey] of this.sessionToTeamKey.entries()) {
      if (boundKey === teamKey) {
        this.sessionToTeamKey.delete(sessionId)
      }
    }

    return true
  }

  clearAll(cleanup: boolean): void {
    for (const record of this.teamsByKey.values()) {
      record.orchestrator?.cleanup(cleanup)
    }

    this.teamsByKey.clear()
    this.sessionToTeamKey.clear()
    this.workersBySession.clear()
    this.coordinatorsBySession.clear()
  }

  registerWorker(sessionId: string, worker: WorkerAgent): void {
    this.workersBySession.set(sessionId, worker)
  }

  unregisterWorker(sessionId: string): void {
    this.workersBySession.delete(sessionId)
  }

  getWorker(sessionId: string): WorkerAgent | undefined {
    return this.workersBySession.get(sessionId)
  }

  registerCoordinator(sessionId: string, coordinator: CoordinatorAgent): void {
    this.coordinatorsBySession.set(sessionId, coordinator)
  }

  unregisterCoordinator(sessionId: string): void {
    this.coordinatorsBySession.delete(sessionId)
  }

  getCoordinator(sessionId: string): CoordinatorAgent | undefined {
    return this.coordinatorsBySession.get(sessionId)
  }
}

export function createSwarmRuntimeService(): SwarmRuntimeService {
  return new InMemorySwarmRuntimeService()
}
