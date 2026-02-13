import { contextViewAssembler, type ContextViewAssembler } from "./assembler"
import type { BudgetDecision, BudgetPriority, ContextChannel } from "./types"

export interface BudgetedOutputAppendOptions {
  output: { output: string }
  sessionID: string
  source: string
  id: string
  content: string
  priority?: BudgetPriority
  channel?: ContextChannel
  oncePerSession?: boolean
  estimatedTokens?: number
}

export function appendBudgetedOutput(
  options: BudgetedOutputAppendOptions,
  arbiter: ContextViewAssembler = contextViewAssembler
): BudgetDecision {
  const decision = arbiter.decide({
    sessionID: options.sessionID,
    source: options.source,
    channel: options.channel ?? "tool-output",
    id: options.id,
    priority: options.priority ?? "normal",
    content: options.content,
    oncePerSession: options.oncePerSession,
    estimatedTokens: options.estimatedTokens,
  })

  if (decision.accepted) {
    options.output.output += decision.finalContent
  }

  return decision
}

export interface BudgetedContextPushOptions {
  output: { context: string[] }
  sessionID: string
  source: string
  id: string
  content: string
  priority?: BudgetPriority
  channel?: ContextChannel
  oncePerSession?: boolean
  estimatedTokens?: number
}

export function pushBudgetedContext(
  options: BudgetedContextPushOptions,
  arbiter: ContextViewAssembler = contextViewAssembler
): BudgetDecision {
  const decision = arbiter.decide({
    sessionID: options.sessionID,
    source: options.source,
    channel: options.channel ?? "session-prompt",
    id: options.id,
    priority: options.priority ?? "high",
    content: options.content,
    oncePerSession: options.oncePerSession,
    estimatedTokens: options.estimatedTokens,
  })

  if (decision.accepted) {
    options.output.context.push(decision.finalContent)
  }

  return decision
}

export interface BudgetedPromptInjectionOptions {
  output: { args: Record<string, unknown> }
  sessionID: string
  source: string
  id: string
  content: string
  priority?: BudgetPriority
  channel?: ContextChannel
  oncePerSession?: boolean
  estimatedTokens?: number
  position?: "prepend" | "append"
}

export function injectBudgetedPrompt(
  options: BudgetedPromptInjectionOptions,
  arbiter: ContextViewAssembler = contextViewAssembler
): BudgetDecision | null {
  const prompt = options.output.args.prompt
  if (typeof prompt !== "string") {
    return null
  }

  const decision = arbiter.decide({
    sessionID: options.sessionID,
    source: options.source,
    channel: options.channel ?? "delegate-prompt",
    id: options.id,
    priority: options.priority ?? "high",
    content: options.content,
    oncePerSession: options.oncePerSession,
    estimatedTokens: options.estimatedTokens,
  })

  if (decision.accepted) {
    options.output.args.prompt =
      options.position === "append"
        ? `${prompt}${decision.finalContent}`
        : `${decision.finalContent}${prompt}`
  }

  return decision
}

export const appendContextViewOutput = appendBudgetedOutput
export const pushContextView = pushBudgetedContext
export const injectContextViewPrompt = injectBudgetedPrompt
