import type { PluginInput } from "@opencode-ai/plugin"
import { log } from "../../shared/logger"

export type ContinuationSource =
  | "execution-orchestrator"
  | "ralph-loop"
  | "todo-auto-continuation"
  | "planning-with-files"

export type ContinuationRejectReason =
  | "stop_guard"
  | "post_compaction_grace"
  | "stale_round"
  | "round_already_written"
  | "lower_priority"

export interface ContinuationPromptModel {
  providerID: string
  modelID: string
}

export interface ContinuationPromptPayload {
  text: string
  agent?: string
  model?: ContinuationPromptModel
  variant?: string
}

export interface ContinuationIntentOutcome {
  status: "accepted" | "rejected"
  rejectReason?: ContinuationRejectReason
  error?: unknown
}

export interface ContinuationIntent {
  sessionID: string
  source: ContinuationSource
  reason: string
  prompt: ContinuationPromptPayload
  round?: number
  onResult?: (outcome: ContinuationIntentOutcome) => void | Promise<void>
}

export interface ContinuationControlPriority {
  "execution-orchestrator": number
  "ralph-loop": number
  "todo-auto-continuation": number
  "planning-with-files": number
}

export interface ContinuationControlConfig {
  post_compaction_grace_ms: number
  priority: ContinuationControlPriority
}

interface SessionPromptArgs {
  path: { id: string }
  body: {
    parts: Array<{ type: "text"; text: string }>
    agent?: string
    model?: ContinuationPromptModel
    variant?: string
  }
  query: { directory: string }
}

interface ContinuationControlOptions {
  config: ContinuationControlConfig
  isContinuationStopped?: (sessionID: string) => boolean
}

interface QueuedIntent {
  intent: ContinuationIntent
  round: number
  seq: number
}

interface ActiveEventState {
  type: string
  roundBySession: Map<string, number>
  pendingBySession: Map<string, QueuedIntent[]>
}

const HOOK_NAME = "continuation-control"

function extractSessionID(input: { event: { type: string; properties?: unknown } }): string | undefined {
  const props = input.event.properties as Record<string, unknown> | undefined
  return (props?.sessionID as string | undefined) ??
    ((props?.info as { id?: string } | undefined)?.id as string | undefined)
}

async function notifyOutcome(
  intent: ContinuationIntent,
  outcome: ContinuationIntentOutcome
): Promise<void> {
  if (!intent.onResult) return
  try {
    await intent.onResult(outcome)
  } catch (err) {
    log(`[${HOOK_NAME}] onResult callback failed`, {
      sessionID: intent.sessionID,
      source: intent.source,
      error: String(err),
    })
  }
}

function getPriority(config: ContinuationControlConfig, source: ContinuationSource): number {
  return config.priority[source] ?? 0
}

async function sendSessionPrompt(
  ctx: Pick<PluginInput, "client" | "directory">,
  sessionID: string,
  prompt: ContinuationPromptPayload
): Promise<void> {
  const body: {
    parts: Array<{ type: "text"; text: string }>
    agent?: string
    model?: ContinuationPromptModel
    variant?: string
  } = {
    parts: [{ type: "text", text: prompt.text }],
    ...(prompt.agent !== undefined ? { agent: prompt.agent } : {}),
    ...(prompt.model !== undefined ? { model: prompt.model } : {}),
    ...(prompt.variant !== undefined ? { variant: prompt.variant } : {}),
  }

  const args = {
    path: { id: sessionID },
    body,
    query: { directory: ctx.directory },
  } satisfies SessionPromptArgs

  const sessionClient = ctx.client.session as unknown as {
    promptAsync?: (args: SessionPromptArgs) => Promise<unknown>
    prompt?: (args: SessionPromptArgs) => Promise<unknown>
  }

  if (typeof sessionClient.promptAsync === "function") {
    await sessionClient.promptAsync(args)
    return
  }

  if (typeof sessionClient.prompt === "function") {
    await sessionClient.prompt(args)
    return
  }

  throw new Error("session.prompt/session.promptAsync is unavailable")
}

export function createDirectContinuationReporterForTesting(
  ctx: Pick<PluginInput, "client" | "directory">
): (intent: ContinuationIntent) => Promise<void> {
  return async (intent: ContinuationIntent): Promise<void> => {
    try {
      await sendSessionPrompt(ctx, intent.sessionID, intent.prompt)
      await notifyOutcome(intent, { status: "accepted" })
    } catch (err) {
      await notifyOutcome(intent, { status: "accepted", error: err })
    }
  }
}

export function createContinuationControl(
  ctx: Pick<PluginInput, "client" | "directory">,
  options: ContinuationControlOptions
) {
  const { config, isContinuationStopped } = options

  const sessionRounds = new Map<string, number>()
  const acceptedRoundBySession = new Map<string, number>()
  const lastCompactedAt = new Map<string, number>()

  const immediatePendingBySession = new Map<string, QueuedIntent[]>()
  const immediateFlushScheduled = new Set<string>()
  const dispatchChainBySession = new Map<string, Promise<void>>()

  let activeEvent: ActiveEventState | null = null
  let seq = 0

  const withSessionDispatchLock = async (
    sessionID: string,
    fn: () => Promise<void>
  ): Promise<void> => {
    const existing = dispatchChainBySession.get(sessionID)

    if (!existing) {
      const running = (async () => {
        await fn()
      })()
      dispatchChainBySession.set(sessionID, running)

      try {
        await running
      } finally {
        if (dispatchChainBySession.get(sessionID) === running) {
          dispatchChainBySession.delete(sessionID)
        }
      }

      return
    }

    const next = existing.catch(() => {}).then(fn)
    dispatchChainBySession.set(sessionID, next)

    try {
      await next
    } finally {
      if (dispatchChainBySession.get(sessionID) === next) {
        dispatchChainBySession.delete(sessionID)
      }
    }
  }

  const flushImmediate = async (sessionID: string): Promise<void> => {
    immediateFlushScheduled.delete(sessionID)

    const pending = immediatePendingBySession.get(sessionID)
    if (!pending || pending.length === 0) return
    immediatePendingBySession.delete(sessionID)

    await withSessionDispatchLock(sessionID, async () => {
      await dispatchBatch(sessionID, pending)
    })
  }

  const scheduleImmediateFlush = (sessionID: string): void => {
    if (immediateFlushScheduled.has(sessionID)) return
    immediateFlushScheduled.add(sessionID)
    queueMicrotask(() => {
      void flushImmediate(sessionID).catch((err) => {
        log(`[${HOOK_NAME}] immediate flush failed`, {
          sessionID,
          error: String(err),
        })
      })
    })
  }

  const enqueueImmediate = (queued: QueuedIntent): void => {
    const sessionID = queued.intent.sessionID
    const list = immediatePendingBySession.get(sessionID) ?? []
    list.push(queued)
    immediatePendingBySession.set(sessionID, list)
    scheduleImmediateFlush(sessionID)
  }

  const rejectAll = async (
    intents: QueuedIntent[],
    rejectReason: ContinuationRejectReason
  ): Promise<void> => {
    for (const queued of intents) {
      await notifyOutcome(queued.intent, {
        status: "rejected",
        rejectReason,
      })
    }
  }

  const dispatchBatch = async (sessionID: string, intents: QueuedIntent[]): Promise<void> => {
    if (intents.length === 0) return

    if (isContinuationStopped?.(sessionID)) {
      await rejectAll(intents, "stop_guard")
      return
    }

    const compactedAt = lastCompactedAt.get(sessionID)
    if (
      compactedAt !== undefined &&
      Date.now() - compactedAt < config.post_compaction_grace_ms
    ) {
      await rejectAll(intents, "post_compaction_grace")
      return
    }

    const currentRound = sessionRounds.get(sessionID) ?? 0
    const acceptedRound = acceptedRoundBySession.get(sessionID)

    const candidates: QueuedIntent[] = []

    for (const queued of intents) {
      if (queued.round < currentRound) {
        await notifyOutcome(queued.intent, {
          status: "rejected",
          rejectReason: "stale_round",
        })
        continue
      }

      if (acceptedRound !== undefined && queued.round <= acceptedRound) {
        await notifyOutcome(queued.intent, {
          status: "rejected",
          rejectReason: "round_already_written",
        })
        continue
      }

      candidates.push(queued)
    }

    if (candidates.length === 0) return

    const ordered = [...candidates].sort((a, b) => {
      const priorityDiff = getPriority(config, b.intent.source) - getPriority(config, a.intent.source)
      if (priorityDiff !== 0) return priorityDiff
      return a.seq - b.seq
    })

    const winner = ordered[0]
    const losers = ordered.slice(1)

    for (const loser of losers) {
      await notifyOutcome(loser.intent, {
        status: "rejected",
        rejectReason: "lower_priority",
      })
    }

    acceptedRoundBySession.set(sessionID, winner.round)

    try {
      await sendSessionPrompt(ctx, winner.intent.sessionID, winner.intent.prompt)
      await notifyOutcome(winner.intent, {
        status: "accepted",
      })
    } catch (err) {
      await notifyOutcome(winner.intent, {
        status: "accepted",
        error: err,
      })
    }
  }

  const getCurrentRound = (sessionID: string): number | undefined => {
    return sessionRounds.get(sessionID)
  }

  const beginEvent = (input: { event: { type: string; properties?: unknown } }): void => {
    const sessionID = extractSessionID(input)

    if (input.event.type === "session.deleted" && sessionID) {
      sessionRounds.delete(sessionID)
      acceptedRoundBySession.delete(sessionID)
      lastCompactedAt.delete(sessionID)
      immediatePendingBySession.delete(sessionID)
      immediateFlushScheduled.delete(sessionID)
      dispatchChainBySession.delete(sessionID)
    }

    if (input.event.type === "session.compacted" && sessionID) {
      lastCompactedAt.set(sessionID, Date.now())
    }

    activeEvent = {
      type: input.event.type,
      roundBySession: new Map<string, number>(),
      pendingBySession: new Map<string, QueuedIntent[]>(),
    }

    if (input.event.type === "session.idle" && sessionID) {
      const round = (sessionRounds.get(sessionID) ?? 0) + 1
      sessionRounds.set(sessionID, round)
      activeEvent.roundBySession.set(sessionID, round)
    }
  }

  const reportIntent = async (intent: ContinuationIntent): Promise<void> => {
    const round = intent.round ?? sessionRounds.get(intent.sessionID) ?? 0

    const queued: QueuedIntent = {
      intent,
      round,
      seq: seq++,
    }

    const activeRound = activeEvent?.roundBySession.get(intent.sessionID)
    const shouldQueueInActiveIdleRound =
      activeEvent?.type === "session.idle" && activeRound !== undefined && activeRound === round

    if (shouldQueueInActiveIdleRound && activeEvent) {
      const list = activeEvent.pendingBySession.get(intent.sessionID) ?? []
      list.push(queued)
      activeEvent.pendingBySession.set(intent.sessionID, list)
      return
    }

    enqueueImmediate(queued)
  }

  const flushEvent = async (_input: { event: { type: string; properties?: unknown } }): Promise<void> => {
    const currentActiveEvent = activeEvent
    activeEvent = null

    if (!currentActiveEvent) return
    if (currentActiveEvent.type !== "session.idle") return

    for (const [sessionID, intents] of currentActiveEvent.pendingBySession.entries()) {
      await withSessionDispatchLock(sessionID, async () => {
        await dispatchBatch(sessionID, intents)
      })
    }
  }

  return {
    beginEvent,
    reportIntent,
    flushEvent,
    getCurrentRound,
  }
}
