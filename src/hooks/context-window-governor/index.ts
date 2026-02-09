import type { PluginInput } from "@opencode-ai/plugin"
import type { OhMyOpenCodeConfig } from "../../config"
import type { ModelCacheState } from "../../plugin-state"
import type { ContextWindowGovernorConfigOverride, RecoveryRequest } from "./types"
import { resolveGovernorConfig } from "./policy"
import { createContextWindowStateMachine } from "./state-machine"
import { createCompactionLeaseManager } from "./lease-manager"
import { createLimitResolver } from "./limit-resolver"
import { createContextWindowProbe } from "./probe"
import { appendContextWindowWarning } from "./actions/warn"
import { runPreemptiveCompaction } from "./actions/preemptive"
import {
  parseTokenLimitError,
  runRecoveryCompaction,
} from "./actions/recovery"
import { injectCompactionContext } from "./actions/compaction-context"
import {
  type DynamicPruningResult,
  runDynamicContextPruning,
  shouldSkipRecoverySummarize,
} from "./actions/dynamic-pruning"
import { runAggressiveOutputTruncation } from "./actions/aggressive-output-truncation"

export interface ContextWindowGovernorHookOptions extends ContextWindowGovernorConfigOverride {
  modelCacheState?: ModelCacheState
  taskConfig?: Partial<Pick<OhMyOpenCodeConfig, "sisyphus">>
}

export function createContextWindowGovernorHook(
  ctx: PluginInput,
  options?: ContextWindowGovernorHookOptions
) {
  const config = resolveGovernorConfig(
    options
      ? {
          warningRatio: options.warningRatio,
          preemptiveRatio: options.preemptiveRatio,
          limitRatio: options.limitRatio,
          warningResetRatio: options.warningResetRatio,
          preemptiveResetRatio: options.preemptiveResetRatio,
          recovery: options.recovery,
          dynamicPruning: options.dynamicPruning,
        }
      : undefined
  )
  const stateMachine = createContextWindowStateMachine(config)
  const leaseManager = createCompactionLeaseManager()
  const resolveLimit = createLimitResolver({ modelCacheState: options?.modelCacheState })
  const probe = createContextWindowProbe({
    client: ctx.client,
    resolveLimit,
  })

  interface RecoveryRequestState extends RecoveryRequest {
    attempts: number
    nextAttemptAt: number
    lastToastAt: number
    dynamicPruningAttempted: boolean
    dynamicPruningTokensSaved: number
    aggressiveCharsRemoved: number
  }

  const recoveryRequests = new Map<string, RecoveryRequestState>()
  const recoveryTimers = new Map<string, ReturnType<typeof setTimeout>>()

  const showRecoverySuccessToast = async (show: boolean, message: string): Promise<void> => {
    if (!show) {
      return
    }

    await ctx.client.tui
      .showToast({
        body: {
          title: "Context Recovered",
          message,
          variant: "success",
          duration: 3000,
        },
      })
      .catch(() => undefined)
  }

  const showDynamicPruningSkipToast = async (
    show: boolean,
    pruningResult: DynamicPruningResult
  ): Promise<void> => {
    const level = config.dynamicPruning.notification
    if (!show || level === "off") {
      return
    }

    if (level === "minimal") {
      await showRecoverySuccessToast(
        true,
        "Dynamic pruning reclaimed context headroom; summarize skipped."
      )
      return
    }

    const totalPruned = pruningResult.deduplicatedCount + pruningResult.stalePrunedCount
    await showRecoverySuccessToast(
      true,
      `Dynamic pruning removed ${totalPruned} outputs (dedup ${pruningResult.deduplicatedCount}, stale ${pruningResult.stalePrunedCount}), estimated ${pruningResult.estimatedTokensSaved} tokens reclaimed; summarize skipped.`
    )
  }

  const showAggressiveSkipToast = async (
    show: boolean,
    result: {
      truncatedCount: number
      totalCharsRemoved: number
    }
  ): Promise<void> => {
    const level = config.dynamicPruning.notification
    if (!show || level === "off") {
      return
    }

    if (level === "minimal") {
      await showRecoverySuccessToast(
        true,
        "Aggressive output truncation reclaimed context headroom; summarize skipped."
      )
      return
    }

    const estimatedTokensRemoved = Math.floor(
      result.totalCharsRemoved /
        Math.max(1, config.recovery.aggressiveOutputTruncation.charsPerToken)
    )
    await showRecoverySuccessToast(
      true,
      `Aggressive output truncation removed ${result.truncatedCount} outputs (~${estimatedTokensRemoved} tokens); summarize skipped.`
    )
  }

  const resumeAfterRecoverySkip = async (sessionID: string): Promise<void> => {
    const sessionClient = ctx.client.session as unknown as {
      promptAsync?: (opts: unknown) => Promise<unknown>
      prompt?: (opts: unknown) => Promise<unknown>
    }

    if (typeof sessionClient.promptAsync === "function") {
      // Best-effort: ask the runtime to continue without emitting a new user-visible prompt.
      // Some OpenCode versions accept `{ auto: true }` in `prompt_async` despite the SDK type shape.
      await sessionClient
        .promptAsync({
          path: { id: sessionID },
          body: { auto: true },
          query: { directory: ctx.directory },
        })
        .catch(() => undefined)
      return
    }

    if (typeof sessionClient.prompt !== "function") {
      return
    }

    await sessionClient
      .prompt({
        path: { id: sessionID },
        body: { parts: [{ type: "text", text: "continue" }] },
        query: { directory: ctx.directory },
      })
      .catch(() => undefined)
  }

  const upsertRecoveryRequest = (
    sessionID: string,
    patch: Partial<RecoveryRequest>
  ): RecoveryRequestState => {
    const existing = recoveryRequests.get(sessionID)
    if (existing) {
      if (patch.providerID !== undefined) {
        existing.providerID = patch.providerID
      }
      if (patch.modelID !== undefined) {
        existing.modelID = patch.modelID
      }
      if (patch.currentTokens !== undefined) {
        existing.currentTokens = patch.currentTokens
      }
      if (patch.maxTokens !== undefined) {
        existing.maxTokens = patch.maxTokens
      }
      return existing
    }

    const next: RecoveryRequestState = {
      sessionID,
      providerID: patch.providerID,
      modelID: patch.modelID,
      currentTokens: patch.currentTokens,
      maxTokens: patch.maxTokens,
      attempts: 0,
      nextAttemptAt: 0,
      lastToastAt: 0,
      dynamicPruningAttempted: false,
      dynamicPruningTokensSaved: 0,
      aggressiveCharsRemoved: 0,
    }
    recoveryRequests.set(sessionID, next)
    return next
  }

  const clearRecoveryState = (sessionID: string): void => {
    recoveryRequests.delete(sessionID)
    const timer = recoveryTimers.get(sessionID)
    if (timer) {
      clearTimeout(timer)
      recoveryTimers.delete(sessionID)
    }
  }

  const computeRecoveryBackoffMs = (attempt: number): number => {
    const baseDelay = Math.max(0, config.recovery.initialDelayMs)
    const maxDelay = Math.max(0, config.recovery.maxDelayMs)
    if (baseDelay === 0) {
      return 0
    }

    const exponent = Math.max(0, attempt - 1)
    const delay = baseDelay * Math.pow(2, exponent)
    if (maxDelay === 0) {
      return delay
    }
    return Math.min(delay, maxDelay)
  }

  const shouldShowRecoveryToast = (request: RecoveryRequestState, now: number): boolean => {
    const cooldown = Math.max(0, config.recovery.toastCooldownMs)
    if (cooldown === 0) {
      return true
    }
    if (!request.lastToastAt) {
      return true
    }
    return now - request.lastToastAt >= cooldown
  }

  const scheduleRecoveryRetry = (sessionID: string): void => {
    const request = recoveryRequests.get(sessionID)
    if (!request || !stateMachine.isRecoveryPending(sessionID)) {
      return
    }

    const now = Date.now()
    const delay = Math.max(0, request.nextAttemptAt - now)

    const existing = recoveryTimers.get(sessionID)
    if (existing) {
      clearTimeout(existing)
      recoveryTimers.delete(sessionID)
    }

    const timer = setTimeout(() => {
      recoveryTimers.delete(sessionID)
      void runRecoveryIfNeeded(sessionID)
    }, delay)

    recoveryTimers.set(sessionID, timer)
  }

  const runRecoveryIfNeeded = async (sessionID: string): Promise<void> => {
    if (!stateMachine.isRecoveryPending(sessionID)) {
      return
    }

    const requestState = upsertRecoveryRequest(sessionID, {})
    const now = Date.now()

    if (requestState.attempts >= config.recovery.maxAttempts) {
      stateMachine.onRecoveryExhausted(sessionID)
      clearRecoveryState(sessionID)
      return
    }

    if (requestState.nextAttemptAt > now) {
      scheduleRecoveryRetry(sessionID)
      return
    }

    if (!leaseManager.tryAcquire(sessionID, "recovery")) {
      return
    }

    stateMachine.onCompactionStarted(sessionID, true)

    try {
      requestState.attempts += 1
      const attemptNumber = requestState.attempts

      const showToast = shouldShowRecoveryToast(requestState, now)
      if (showToast) {
        requestState.lastToastAt = now
      }

      const needsTokenContext = !(
        typeof requestState.currentTokens === "number" &&
        typeof requestState.maxTokens === "number" &&
        requestState.currentTokens > 0 &&
        requestState.maxTokens > 0
      )
      const needsIdentity = !(requestState.providerID && requestState.modelID)

      if (needsTokenContext || needsIdentity) {
        const knownSnapshot = probe.getLastSnapshot(sessionID)
        const latestSnapshot = knownSnapshot ?? (await probe.getSnapshot({ sessionID }))
        if (latestSnapshot) {
          requestState.providerID = requestState.providerID ?? latestSnapshot.providerID
          requestState.modelID = requestState.modelID ?? latestSnapshot.modelID

          if (
            needsTokenContext &&
            latestSnapshot.usedInputCacheTokens > 0 &&
            latestSnapshot.limitTokens > 0
          ) {
            requestState.currentTokens = latestSnapshot.usedInputCacheTokens
            requestState.maxTokens = latestSnapshot.limitTokens
          }
        }
      }

      if (!requestState.dynamicPruningAttempted) {
        requestState.dynamicPruningAttempted = true
        const pruningResult = runDynamicContextPruning(sessionID, config.dynamicPruning)
        if (pruningResult.estimatedTokensSaved > 0) {
          requestState.dynamicPruningTokensSaved += pruningResult.estimatedTokensSaved
        }

        if (shouldSkipRecoverySummarize(requestState, config.dynamicPruning, pruningResult)) {
          await showDynamicPruningSkipToast(showToast, pruningResult)
          stateMachine.onCompactionFinished(sessionID)
          clearRecoveryState(sessionID)
          probe.clearSession(sessionID)
          await resumeAfterRecoverySkip(sessionID)
          return
        }
      }

      const aggressiveResult = runAggressiveOutputTruncation(
        sessionID,
        requestState,
        config.recovery.aggressiveOutputTruncation
      )

      if (aggressiveResult.totalCharsRemoved > 0) {
        requestState.aggressiveCharsRemoved += aggressiveResult.totalCharsRemoved
      }

      const aggressiveCharsPerToken = Math.max(
        1,
        config.recovery.aggressiveOutputTruncation.charsPerToken
      )
      const aggressiveTargetRatio = config.recovery.aggressiveOutputTruncation.targetRatio
      const hasTokenContext =
        typeof requestState.currentTokens === "number" &&
        typeof requestState.maxTokens === "number" &&
        requestState.currentTokens > 0 &&
        requestState.maxTokens > 0
      const currentTokens = hasTokenContext
        ? (requestState.currentTokens as number)
        : 0
      const maxTokens = hasTokenContext ? (requestState.maxTokens as number) : 0
      const dynamicRecoveredTokens = Math.max(0, requestState.dynamicPruningTokensSaved)
      const aggressiveRecovered = hasTokenContext
        ? Math.max(
            0,
            currentTokens -
              dynamicRecoveredTokens -
              Math.floor(requestState.aggressiveCharsRemoved / aggressiveCharsPerToken)
          ) <= Math.floor(maxTokens * aggressiveTargetRatio)
        : false

      if (
        aggressiveResult.attempted &&
        requestState.aggressiveCharsRemoved > 0 &&
        aggressiveRecovered
      ) {
        await showAggressiveSkipToast(showToast, aggressiveResult)
        stateMachine.onCompactionFinished(sessionID)
        clearRecoveryState(sessionID)
        probe.clearSession(sessionID)
        await resumeAfterRecoverySkip(sessionID)
        return
      }

      let providerID = requestState.providerID
      let modelID = requestState.modelID

      if (!providerID || !modelID) {
        const knownSnapshot = probe.getLastSnapshot(sessionID)
        const latestSnapshot = knownSnapshot ?? (await probe.getSnapshot({ sessionID }))
        providerID = providerID ?? latestSnapshot?.providerID
        modelID = modelID ?? latestSnapshot?.modelID
      }

      const succeeded = await runRecoveryCompaction(
        {
          client: ctx.client,
          directory: ctx.directory,
        },
        requestState,
        {
          providerID,
          modelID,
        },
        { toast: showToast }
      )

      if (succeeded) {
        stateMachine.onCompactionFinished(sessionID)
        clearRecoveryState(sessionID)
        probe.clearSession(sessionID)
        return
      }

      if (requestState.attempts >= config.recovery.maxAttempts) {
        stateMachine.onRecoveryExhausted(sessionID)
        clearRecoveryState(sessionID)
        return
      }

      requestState.nextAttemptAt = now + computeRecoveryBackoffMs(attemptNumber)
      scheduleRecoveryRetry(sessionID)
    } catch {
      if (requestState.attempts >= config.recovery.maxAttempts) {
        stateMachine.onRecoveryExhausted(sessionID)
        clearRecoveryState(sessionID)
      } else {
        requestState.nextAttemptAt = now + computeRecoveryBackoffMs(requestState.attempts)
        scheduleRecoveryRetry(sessionID)
      }
    } finally {
      leaseManager.release(sessionID, "recovery")
    }
  }

  const toolExecuteAfter = async (
    input: { tool: string; sessionID: string; callID: string },
    output: { title: string; output: string; metadata: unknown }
  ) => {
    const snapshot = await probe.getSnapshot({ sessionID: input.sessionID, callID: input.callID })
    if (!snapshot) {
      return
    }

    const signal = stateMachine.onUsage(input.sessionID, snapshot.usageRatio)

    if (signal.shouldRecover) {
      upsertRecoveryRequest(input.sessionID, {
        providerID: snapshot.providerID,
        modelID: snapshot.modelID,
        currentTokens: snapshot.usedInputCacheTokens,
        maxTokens: snapshot.limitTokens,
      })
      stateMachine.markRecoveryPending(input.sessionID)
      await runRecoveryIfNeeded(input.sessionID)
      return
    }

    if (signal.shouldWarn) {
      appendContextWindowWarning(output, snapshot)
    }

    if (!signal.shouldPreemptiveCompact) {
      return
    }

    if (!leaseManager.tryAcquire(input.sessionID, "preemptive")) {
      return
    }

    stateMachine.onCompactionStarted(input.sessionID, false)
    try {
      const succeeded = await runPreemptiveCompaction(
        {
          client: ctx.client,
          directory: ctx.directory,
        },
        snapshot
      )

      if (succeeded) {
        stateMachine.onCompactionFinished(input.sessionID)
        probe.clearSession(input.sessionID)
      } else {
        stateMachine.onCompactionFailed(input.sessionID)
      }
    } catch {
      stateMachine.onCompactionFailed(input.sessionID)
    } finally {
      leaseManager.release(input.sessionID, "preemptive")
      // Recovery has higher priority. If it was scheduled while preemptive compaction ran,
      // run it immediately after releasing the lease (best-effort).
      await runRecoveryIfNeeded(input.sessionID)
    }
  }

  const eventHandler = async ({ event }: { event: { type: string; properties?: unknown } }) => {
    const props = event.properties as Record<string, unknown> | undefined

    if (event.type === "session.deleted") {
      const sessionInfo = props?.info as { id?: string } | undefined
      const sessionID = sessionInfo?.id
      if (!sessionID) {
        return
      }

      stateMachine.clearSession(sessionID)
      leaseManager.clear(sessionID)
      clearRecoveryState(sessionID)
      probe.clearSession(sessionID)
      return
    }

    if (event.type === "session.compacted") {
      const sessionID = props?.sessionID as string | undefined
      if (!sessionID) {
        return
      }

      stateMachine.onCompactionFinished(sessionID)
      probe.clearSession(sessionID)
      clearRecoveryState(sessionID)
      return
    }

    if (event.type === "session.error") {
      const sessionID = props?.sessionID as string | undefined
      if (!sessionID) {
        return
      }

      const parsed = parseTokenLimitError(props?.error)
      if (!parsed) {
        return
      }

      upsertRecoveryRequest(sessionID, {
        currentTokens: parsed.currentTokens,
        maxTokens: parsed.maxTokens,
      })
      stateMachine.markRecoveryPending(sessionID)
      if (
        config.dynamicPruning.enabled &&
        leaseManager.getOwner(sessionID) === "recovery"
      ) {
        const pruningResult = runDynamicContextPruning(sessionID, config.dynamicPruning)
        if (pruningResult.estimatedTokensSaved > 0) {
          const requestState = upsertRecoveryRequest(sessionID, {})
          requestState.dynamicPruningTokensSaved += pruningResult.estimatedTokensSaved
        }
      }
      if (!stateMachine.isRecoveryPending(sessionID)) {
        clearRecoveryState(sessionID)
      }
      void runRecoveryIfNeeded(sessionID)
      return
    }

    if (event.type === "message.updated") {
      const info = props?.info as Record<string, unknown> | undefined
      const sessionID = info?.sessionID as string | undefined
      if (!sessionID || info?.role !== "assistant" || !info.error) {
        return
      }

      const parsed = parseTokenLimitError(info.error)
      if (!parsed) {
        return
      }

      upsertRecoveryRequest(sessionID, {
        providerID: info.providerID as string | undefined,
        modelID: info.modelID as string | undefined,
        currentTokens: parsed.currentTokens,
        maxTokens: parsed.maxTokens,
      })
      stateMachine.markRecoveryPending(sessionID)
      if (
        config.dynamicPruning.enabled &&
        leaseManager.getOwner(sessionID) === "recovery"
      ) {
        const pruningResult = runDynamicContextPruning(sessionID, config.dynamicPruning)
        if (pruningResult.estimatedTokensSaved > 0) {
          const requestState = upsertRecoveryRequest(sessionID, {})
          requestState.dynamicPruningTokensSaved += pruningResult.estimatedTokensSaved
        }
      }
      if (!stateMachine.isRecoveryPending(sessionID)) {
        clearRecoveryState(sessionID)
      }
      void runRecoveryIfNeeded(sessionID)
      return
    }

    if (event.type === "session.idle") {
      const sessionID = props?.sessionID as string | undefined
      if (!sessionID) {
        return
      }

      await runRecoveryIfNeeded(sessionID)
    }
  }

  const compactingHandler = async (
    input: { sessionID: string },
    output?: { context: string[] }
  ) => {
    injectCompactionContext(output, {
      sessionID: input.sessionID,
      directory: ctx.directory,
      taskConfig: options?.taskConfig,
    })
  }

  return {
    "tool.execute.after": toolExecuteAfter,
    event: eventHandler,
    "experimental.session.compacting": compactingHandler,
  }
}

export { getCompactionContextPrompt } from "./actions/compaction-context"
export type {
  ContextWindowSnapshot,
  ContextWindowPhase,
  ContextWindowSignal,
  CompactionLeaseOwner,
} from "./types"
