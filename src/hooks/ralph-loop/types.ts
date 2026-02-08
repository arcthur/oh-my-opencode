import type { RalphLoopConfig } from "../../config"
import type { ContinuationIntent } from "../continuation-control"

export interface RalphLoopState {
  active: boolean
  iteration: number
  max_iterations: number
  completion_promise: string
  started_at: string
  prompt: string
  session_id?: string
  ultrawork?: boolean
}

export interface RalphLoopOptions {
  config?: RalphLoopConfig
  getTranscriptPath?: (sessionId: string) => string
  apiTimeout?: number
  checkSessionExists?: (sessionId: string) => Promise<boolean>
  isContinuationStopped?: (sessionID: string) => boolean
  getContinuationRound?: (sessionID: string) => number | undefined
  reportContinuationIntent: (intent: ContinuationIntent) => Promise<void>
}
